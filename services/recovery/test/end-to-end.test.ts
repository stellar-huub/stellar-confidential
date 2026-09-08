import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryError, type EncryptedAmount } from '@stellar-confidential/core';
import {
  Ingestor,
  IntegrityService,
  MemoryEventStore,
  ReferenceContractAdapter,
  SyntheticChain,
  type SyntheticEventSpec,
} from '@stellar-confidential/indexer';
import {
  ZERO_AMOUNT,
  addAmounts,
  deriveKeyset,
  encryptAmount,
  seededRandomScalar,
  subtractAmounts,
} from '@stellar-confidential/crypto';
import { RecoverySession, type ChainBalanceSource } from '@stellar-confidential/recovery';
import { StoreEventSource } from '../src/store-source.js';

/**
 * The whole stack, end to end.
 *
 * Chain → indexer → archive API → recovery → verified balance, with real
 * cryptography throughout. This is the test that says the two phases actually
 * fit together, and it is where M2.4's acceptance criterion is measured.
 */

const ALICE = 'GALICE';
const BOB = 'GBOB';

/** Buffer is a Uint8Array, so this needs no crypto dependency in the service. */
const seed = (hex: string): Uint8Array => Buffer.from(hex, 'hex');

const aliceKeys = deriveKeyset(seed('e2'.repeat(32)));
const bobKeys = deriveKeyset(seed('e3'.repeat(32)));
const rng = seededRandomScalar(20_260_907n);

interface BuiltChain {
  readonly chain: SyntheticChain;
  readonly aliceBalance: EncryptedAmount;
  readonly aliceValue: bigint;
  readonly transactionCount: number;
}

/** A payroll-shaped chain: Alice is paid repeatedly and occasionally spends. */
function buildPayrollChain(payments: number): BuiltChain {
  const chain = new SyntheticChain();
  let aliceBalance: EncryptedAmount = ZERO_AMOUNT;
  let aliceValue = 0n;
  let transactionCount = 0;

  for (let i = 1; i <= payments; i += 1) {
    const specs: SyntheticEventSpec[] = [];

    const salary = BigInt(2_500 + (i % 11) * 97);
    const salaryCipher = encryptAmount(salary, aliceKeys.viewing, rng);
    specs.push({
      type: 'deposit',
      account: ALICE,
      amount: salaryCipher,
      publicAmount: salary.toString(),
    });
    aliceBalance = addAmounts(aliceBalance, salaryCipher);
    aliceValue += salary;
    transactionCount += 1;

    if (i % 4 === 0) {
      // Alice pays Bob. Each side is encrypted under its own viewing key.
      const spend = 900n;
      const aliceCipher = encryptAmount(spend, aliceKeys.viewing, rng);
      specs.push({
        type: 'transfer',
        account: ALICE,
        counterparty: BOB,
        amount: aliceCipher,
        counterpartyAmount: encryptAmount(spend, bobKeys.viewing, rng),
      });
      aliceBalance = subtractAmounts(aliceBalance, aliceCipher);
      aliceValue -= spend;
      transactionCount += 1;
    }

    chain.appendLedger(specs);
  }

  return { chain, aliceBalance, aliceValue, transactionCount };
}

async function indexed(chain: SyntheticChain): Promise<MemoryEventStore> {
  const store = new MemoryEventStore();
  await new Ingestor({
    rpc: chain,
    store,
    adapter: new ReferenceContractAdapter(),
    windowSize: 25,
    pageSize: 100,
  }).runOnce();
  return store;
}

function chainSource(balance: EncryptedAmount | null, ledger: number): ChainBalanceSource {
  return {
    getConfidentialBalance: async () => balance,
    getLatestLedger: async () => ledger,
  };
}

describe('chain → indexer → archive → recovery', () => {
  it('recovers a wiped wallet across 100+ transactions and verifies it (M2.4)', async () => {
    const built = buildPayrollChain(100);
    assert.ok(
      built.transactionCount >= 100,
      `expected 100+ transactions, got ${built.transactionCount}`,
    );

    const store = await indexed(built.chain);
    const source = new StoreEventSource(store, new IntegrityService(store));

    // The wallet is wiped. All that survives is the seed, from which the keys
    // are re-derived — nothing else is carried over from before.
    const recoveredKeys = deriveKeyset(seed('e2'.repeat(32)));
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: recoveredKeys.viewing,
      source,
      chain: chainSource(built.aliceBalance, built.chain.tip),
      pageSize: 100,
    });

    const startedAt = Date.now();
    const result = await session.sync();
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.state.value, built.aliceValue);
    assert.equal(result.report?.verified, true, JSON.stringify(result.report?.failure));
    assert.deepEqual(result.state.balance, built.aliceBalance);
    assert.equal(result.state.eventCount, built.transactionCount);

    // M2.4: under 30 seconds for 100+ transactions.
    assert.ok(elapsedMs < 30_000, `recovery took ${(elapsedMs / 1000).toFixed(1)}s, budget is 30s`);
    console.log(
      `      recovered ${result.state.eventCount} events in ${(elapsedMs / 1000).toFixed(2)}s ` +
        `(${(elapsedMs / result.state.eventCount).toFixed(1)}ms/event)`,
    );
  });

  it('gives each party their own history and nothing of the other', async () => {
    const built = buildPayrollChain(20);
    const store = await indexed(built.chain);
    const source = new StoreEventSource(store, new IntegrityService(store));

    const bob = await new RecoverySession({
      account: BOB,
      viewingKey: bobKeys.viewing,
      source,
    }).sync();

    // Bob sees only the transfers he received, never Alice's salary.
    assert.equal(bob.state.eventCount, 5);
    assert.equal(bob.state.value, 900n * 5n);
    assert.ok(bob.state.history.every((entry) => entry.delta === 'credit'));
  });

  it('refuses to decrypt another account with the wrong key', async () => {
    const built = buildPayrollChain(10);
    const store = await indexed(built.chain);
    const source = new StoreEventSource(store, new IntegrityService(store));

    // Bob's key against Alice's history: an error, never a plausible balance.
    await assert.rejects(
      () => new RecoverySession({ account: ALICE, viewingKey: bobKeys.viewing, source }).sync(),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'WRONG_KEY');
        return true;
      },
    );
  });

  it('resumes incrementally when new payments arrive', async () => {
    const built = buildPayrollChain(30);
    const store = await indexed(built.chain);
    const source = new StoreEventSource(store, new IntegrityService(store));

    const first = await new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source,
    }).sync();

    // More payroll runs, indexed on top of the same store.
    const extra = encryptAmount(5_000n, aliceKeys.viewing, rng);
    built.chain.appendLedger([
      { type: 'deposit', account: ALICE, amount: extra, publicAmount: '5000' },
    ]);
    await new Ingestor({
      rpc: built.chain,
      store,
      adapter: new ReferenceContractAdapter(),
    }).runOnce();

    const second = await new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source,
      chain: chainSource(addAmounts(built.aliceBalance, extra), built.chain.tip),
    }).sync({ from: first.checkpoint });

    // Only the new event was fetched, and the balance is right.
    assert.equal(second.eventsApplied, 1);
    assert.equal(second.state.value, built.aliceValue + 5_000n);
    assert.equal(second.report?.verified, true);
  });

  it('detects an archive that withholds history before it reaches a balance', async () => {
    const built = buildPayrollChain(15);
    const store = await indexed(built.chain);
    const honest = new StoreEventSource(store, new IntegrityService(store));

    // An archive that serves a truthful digest but withholds an event.
    const dishonest = {
      id: 'withholding-archive',
      fetchAccountEvents: async (request: Parameters<typeof honest.fetchAccountEvents>[0]) => {
        const page = await honest.fetchAccountEvents(request);
        return { ...page, events: page.events.slice(0, -1) };
      },
      fetchDigest: (request: Parameters<typeof honest.fetchDigest>[0]) =>
        honest.fetchDigest(request),
      status: () => honest.status(),
    };

    await assert.rejects(
      () =>
        new RecoverySession({
          account: ALICE,
          viewingKey: aliceKeys.viewing,
          source: dishonest,
          maxAttemptsPerPage: 1,
          sleepImpl: async () => {},
        }).sync(),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'INTEGRITY_FAILURE');
        return true;
      },
    );
  });

  it('survives a reorg between two recoveries', async () => {
    const built = buildPayrollChain(12);
    const store = await indexed(built.chain);
    const ingestor = new Ingestor({
      rpc: built.chain,
      store,
      adapter: new ReferenceContractAdapter(),
      confirmationWindow: 20,
    });

    // The last three ledgers are reorganised away and replaced.
    const replacement = encryptAmount(7_777n, aliceKeys.viewing, rng);
    built.chain.reorgFrom(10, [
      [{ type: 'deposit', account: ALICE, amount: replacement, publicAmount: '7777' }],
    ]);
    const reorg = await ingestor.verifyConfirmationWindow();
    assert.equal(reorg.reorgsHandled, 1);
    await ingestor.runOnce();

    const source = new StoreEventSource(store, new IntegrityService(store));
    const result = await new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source,
    }).sync();

    // Orphaned events are gone from the recovered history.
    assert.equal(
      store.snapshot().every((event) => event.proof.ledgerSequence <= 10),
      true,
    );
    assert.ok(result.state.history.some((entry) => entry.value === 7_777n));
  });
});
