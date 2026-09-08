import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerError, merkleRoot, type EncryptedAmount } from '@stellar-confidential/core';
import { MemoryEventStore } from '../src/store-memory.js';
import { Ingestor } from '../src/pipeline.js';
import { ReferenceContractAdapter } from '../src/adapters/reference.js';
import { SyntheticChain, type SyntheticEventSpec } from '../src/testing/synthetic.js';
import type { EventsPage, StellarRpcLike } from '../src/rpc.js';

const ALICE = 'GALICE';
const BOB = 'GBOB';

function amount(tag: string): EncryptedAmount {
  return { limbs: [{ commitment: tag.padEnd(64, '0'), handle: tag.padEnd(64, '1') }] };
}

function makeIngestor(chain: StellarRpcLike, store: MemoryEventStore, windowSize = 5) {
  return new Ingestor({
    rpc: chain,
    store,
    adapter: new ReferenceContractAdapter(),
    windowSize,
    pageSize: 50,
    confirmationWindow: 5,
  });
}

/** A chain that starts failing part-way through, standing in for a killed process. */
function failAfter(chain: SyntheticChain, calls: number): StellarRpcLike {
  let seen = 0;
  return {
    getLedgerRange: () => chain.getLedgerRange(),
    getLedgers: (start, limit) => chain.getLedgers(start, limit),
    getEvents: (request): Promise<EventsPage> => {
      seen += 1;
      if (seen > calls) throw new Error('process killed');
      return chain.getEvents(request);
    },
  };
}

function buildChain(ledgers = 20): SyntheticChain {
  const chain = new SyntheticChain();
  for (let i = 1; i <= ledgers; i += 1) {
    const specs: SyntheticEventSpec[] = [];
    if (i % 2 === 0) {
      specs.push({
        type: 'transfer',
        account: ALICE,
        counterparty: BOB,
        amount: amount(`a${i}`),
        counterpartyAmount: amount(`b${i}`),
      });
    }
    if (i % 5 === 0) {
      specs.push({ type: 'deposit', account: ALICE, amount: amount(`d${i}`), publicAmount: '1000' });
    }
    chain.appendLedger(specs);
  }
  return chain;
}

describe('ingestion pipeline', () => {
  let store: MemoryEventStore;

  beforeEach(() => {
    store = new MemoryEventStore();
  });

  it('ingests a chain and decodes every event', async () => {
    const chain = buildChain();
    const stats = await makeIngestor(chain, store).runOnce();

    assert.equal(stats.ledgersScanned, 20);
    // 10 transfers, each fanning out to two parties, plus 4 deposits.
    assert.equal(stats.eventsInserted, 24);
    assert.equal(store.snapshot().length, 24);
  });

  it('fans a transfer out to both parties with opposing deltas', async () => {
    const chain = new SyntheticChain();
    chain.appendLedger([
      {
        type: 'transfer',
        account: ALICE,
        counterparty: BOB,
        amount: amount('aa'),
        counterpartyAmount: amount('bb'),
      },
    ]);
    await makeIngestor(chain, store).runOnce();

    const events = store.snapshot();
    assert.equal(events.length, 2);

    const sender = events.find((event) => event.account === ALICE);
    const recipient = events.find((event) => event.account === BOB);
    assert.equal(sender?.delta, 'debit');
    assert.equal(recipient?.delta, 'credit');
    assert.equal(sender?.counterparty, BOB);
    assert.equal(recipient?.counterparty, ALICE);
    // Each party holds a ciphertext under their own key, not a shared one.
    assert.notDeepEqual(sender?.amount, recipient?.amount);
    // Distinct cursors, so both survive the primary key.
    assert.notEqual(sender?.cursor, recipient?.cursor);
  });

  it('is idempotent: a second pass inserts nothing new', async () => {
    const chain = buildChain();
    const ingestor = makeIngestor(chain, store);
    await ingestor.runOnce();
    const first = merkleRoot(store.snapshot());

    const second = await ingestor.runOnce();
    assert.equal(second.eventsInserted, 0);
    assert.equal(merkleRoot(store.snapshot()), first);
  });

  it('re-ingesting from scratch over existing data changes nothing', async () => {
    const chain = buildChain();
    await makeIngestor(chain, store).runOnce();
    const before = merkleRoot(store.snapshot());

    // A fresh ingestor with no checkpoint knowledge, replaying the whole range.
    const replay = new Ingestor({
      rpc: chain,
      store,
      adapter: new ReferenceContractAdapter(),
      checkpointName: 'replay',
      windowSize: 3,
      startLedger: 1,
    });
    const stats = await replay.runOnce();

    assert.equal(stats.eventsInserted, 0);
    assert.equal(stats.eventsSkipped, 24);
    assert.equal(merkleRoot(store.snapshot()), before);
  });

  it('produces identical state after a crash and restart (M1.2)', async () => {
    // Uninterrupted reference run.
    const reference = new MemoryEventStore();
    await makeIngestor(buildChain(), reference).runOnce();
    const referenceRoot = merkleRoot(reference.snapshot());

    // A run that dies part-way through, then resumes from its checkpoint.
    const chain = buildChain();
    const interrupted = makeIngestor(failAfter(chain, 2), store);
    await assert.rejects(() => interrupted.runOnce());

    const partial = store.snapshot().length;
    assert.ok(partial > 0, 'expected the interrupted run to have committed something');
    assert.ok(partial < 24, 'expected the interrupted run to be incomplete');

    const resumed = await makeIngestor(chain, store).runOnce();
    assert.ok(resumed.eventsInserted > 0);

    assert.equal(store.snapshot().length, reference.snapshot().length);
    assert.equal(merkleRoot(store.snapshot()), referenceRoot);
    assert.deepEqual(store.snapshot(), reference.snapshot());
  });

  it('resumes from the checkpoint boundary, not mid-ledger', async () => {
    const chain = buildChain(10);
    const ingestor = makeIngestor(chain, store, 4);
    await ingestor.runOnce();

    const checkpoint = await store.getCheckpoint('primary');
    assert.equal(checkpoint?.ledgerSequence, 10);
    // The checkpoint cursor is the ledger's upper bound: every event in ledger
    // 10 is durable, so resuming skips it entirely.
    assert.equal(await ingestor.resumeLedger(), 11);
  });

  it('skips events from failed contract calls', async () => {
    const chain = new SyntheticChain();
    chain.appendLedger([
      { type: 'deposit', account: ALICE, amount: amount('ok'), publicAmount: '5' },
      { type: 'deposit', account: ALICE, amount: amount('no'), publicAmount: '9', successful: false },
    ]);
    await makeIngestor(chain, store).runOnce();

    // A reverted call must never move a balance.
    assert.equal(store.snapshot().length, 1);
    assert.equal(store.snapshot()[0]?.publicAmount, '5');
  });

  it('ignores contract events it does not recognise', async () => {
    const chain = new SyntheticChain();
    chain.appendLedger([{ type: 'deposit', account: ALICE, amount: amount('d1'), publicAmount: '1' }]);
    const unrecognised = {
      getLedgerRange: () => chain.getLedgerRange(),
      getLedgers: (start: number, limit: number) => chain.getLedgers(start, limit),
      getEvents: async (request: Parameters<StellarRpcLike['getEvents']>[0]) => {
        const page = await chain.getEvents(request);
        return {
          ...page,
          events: [
            ...page.events,
            {
              ...(page.events[0] as (typeof page.events)[number]),
              id: `${BigInt(page.events[0]!.id.split('-')[0] as string) + 1n}-0`,
              topic: [Buffer.from(JSON.stringify('some_other_protocol')).toString('base64')],
            },
          ],
        };
      },
    } satisfies StellarRpcLike;

    await makeIngestor(unrecognised, store).runOnce();
    assert.equal(store.snapshot().length, 1);
  });

  it('detects a reorg, rolls back, and re-ingests the replacement history', async () => {
    const chain = new SyntheticChain();
    for (let i = 1; i <= 6; i += 1) {
      chain.appendLedger([{ type: 'deposit', account: ALICE, amount: amount(`o${i}`), publicAmount: String(i) }]);
    }
    const ingestor = makeIngestor(chain, store, 10);
    await ingestor.runOnce();
    assert.equal(store.snapshot().length, 6);
    const originalLedger4 = await store.getLedger(4);

    // The network reorganises from ledger 4: different hashes, different events.
    chain.reorgFrom(4, [
      [{ type: 'deposit', account: BOB, amount: amount('n4'), publicAmount: '40' }],
      [{ type: 'deposit', account: BOB, amount: amount('n5'), publicAmount: '50' }],
      [{ type: 'deposit', account: BOB, amount: amount('n6'), publicAmount: '60' }],
      [{ type: 'deposit', account: BOB, amount: amount('n7'), publicAmount: '70' }],
    ]);

    const reorgStats = await ingestor.verifyConfirmationWindow();
    assert.equal(reorgStats.reorgsHandled, 1, 'expected the reorg to be handled');

    await ingestor.runOnce();

    const events = store.snapshot();
    // Orphaned events are gone: nothing from the abandoned branch survives.
    assert.equal(events.filter((event) => event.account === ALICE).length, 3);
    assert.equal(events.filter((event) => event.account === BOB).length, 4);
    assert.equal(events.length, 7);

    const newLedger4 = await store.getLedger(4);
    assert.notEqual(newLedger4?.hash, originalLedger4?.hash);
    assert.equal((await store.getLatestLedger())?.sequence, 7);
  });

  it('leaves history untouched when the confirmation window agrees', async () => {
    const chain = buildChain(8);
    const ingestor = makeIngestor(chain, store);
    await ingestor.runOnce();
    const before = merkleRoot(store.snapshot());

    const stats = await ingestor.verifyConfirmationWindow();
    assert.equal(stats.reorgsHandled ?? 0, 0);
    assert.equal(merkleRoot(store.snapshot()), before);
  });

  it('refuses to continue when the node has pruned history we never ingested', async () => {
    const chain = buildChain(10);
    await makeIngestor(chain, store).runOnce();
    // Node discards early history; our checkpoint is fine, so this is allowed.
    chain.setOldestRetained(5);
    await makeIngestor(chain, store).runOnce();

    // A fresh indexer starting from ledger 1 cannot: the data is simply gone,
    // and silently starting at 5 would create a history with a hole in it.
    const fresh = new Ingestor({
      rpc: chain,
      store: new MemoryEventStore(),
      adapter: new ReferenceContractAdapter(),
      startLedger: 1,
    });
    await assert.rejects(
      () => fresh.runOnce(),
      (error: unknown) => {
        assert.ok(error instanceof IndexerError);
        assert.equal(error.code, 'RETENTION_EVICTED');
        return true;
      },
    );
  });

  it('applies a retention policy', async () => {
    const chain = buildChain(20);
    const ingestor = makeIngestor(chain, store);
    await ingestor.runOnce();
    assert.equal(store.snapshot().length, 24);

    const removed = await ingestor.prune(5);
    assert.ok(removed > 0);
    for (const event of store.snapshot()) {
      assert.ok(event.proof.ledgerSequence >= 15);
    }
  });

  it('records full chain provenance on every event (M1.5)', async () => {
    const chain = buildChain(6);
    await makeIngestor(chain, store).runOnce();

    for (const event of store.snapshot()) {
      const ledger = await store.getLedger(event.proof.ledgerSequence);
      assert.equal(event.proof.ledgerHash, ledger?.hash);
      assert.ok(event.proof.txHash.length > 0);
      assert.ok(event.proof.ledgerCloseTime > 0);
    }
  });
});
