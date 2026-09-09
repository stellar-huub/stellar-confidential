/**
 * The whole stack in one script.
 *
 *   pnpm demo
 *
 * A company runs payroll confidentially, an employee's phone is wiped, and the
 * wallet rebuilds itself from the archive and proves the result against the
 * chain. Then an archive is caught lying.
 *
 * Everything here is real: real twisted ElGamal ciphertexts, the real ingestion
 * pipeline, the real HTTP archive API over a socket, and the real recovery
 * engine. Only the chain is synthetic, because a reorg has to happen on cue.
 */
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
  subtractAmounts,
  type ConfidentialKeyset,
} from '@stellar-confidential/crypto';
import {
  HttpEventSource,
  RecoverySession,
  type ChainBalanceSource,
  type EventSource,
} from '@stellar-confidential/recovery';
import { ApiServer } from '@stellar-confidential/service-indexer';
import type { EncryptedAmount } from '@stellar-confidential/core';

const EMPLOYEES = ['GAYODELE', 'GBEATRIZ', 'GCHIDI'] as const;
const PAYROLL_RUNS = 12;

const heading = (text: string): void => console.log(`\n\x1b[1m${text}\x1b[0m`);
const step = (text: string): void => console.log(`  ${text}`);
const money = (stroops: bigint): string => `${(Number(stroops) / 1e7).toFixed(4)} tokens`;

async function main(): Promise<void> {
  heading('1. Employees generate keys');

  // In a real wallet the seed comes from a recovery phrase held by the user.
  const keysets = new Map<string, ConfidentialKeyset>();
  for (const [index, employee] of EMPLOYEES.entries()) {
    const seed = Buffer.alloc(32, index + 1);
    keysets.set(employee, deriveKeyset(seed));
    step(`${employee}: spend ${keysets.get(employee)!.spend.publicKey.slice(0, 12)}…`);
  }
  step('Viewing keys are derived separately and cannot sign. Nothing is on chain yet.');

  heading('2. The company runs payroll, confidentially');

  const chain = new SyntheticChain();
  const expected = new Map<string, { balance: EncryptedAmount; value: bigint }>();
  for (const employee of EMPLOYEES) {
    expected.set(employee, { balance: ZERO_AMOUNT, value: 0n });
  }

  let publicTotal = 0n;
  for (let run = 1; run <= PAYROLL_RUNS; run += 1) {
    const specs: SyntheticEventSpec[] = [];

    for (const [index, employee] of EMPLOYEES.entries()) {
      const keys = keysets.get(employee)!;
      const salary = BigInt(25_000_000 + index * 7_000_000 + (run % 3) * 1_100_000);
      const cipher = encryptAmount(salary, keys.viewing, undefined);
      specs.push({
        type: 'deposit',
        account: employee,
        amount: cipher,
        publicAmount: salary.toString(),
      });

      const current = expected.get(employee)!;
      expected.set(employee, {
        balance: addAmounts(current.balance, cipher),
        value: current.value + salary,
      });
      publicTotal += salary;
    }

    // Every third run, one employee pays another. No public amount at all.
    if (run % 3 === 0) {
      const [from, to] = [EMPLOYEES[0], EMPLOYEES[1]] as const;
      const spend = 3_000_000n;
      const fromCipher = encryptAmount(spend, keysets.get(from)!.viewing, undefined);
      const toCipher = encryptAmount(spend, keysets.get(to)!.viewing, undefined);
      specs.push({
        type: 'transfer',
        account: from,
        counterparty: to,
        amount: fromCipher,
        counterpartyAmount: toCipher,
      });

      const sender = expected.get(from)!;
      expected.set(from, {
        balance: subtractAmounts(sender.balance, fromCipher),
        value: sender.value - spend,
      });
      const recipient = expected.get(to)!;
      expected.set(to, {
        balance: addAmounts(recipient.balance, toCipher),
        value: recipient.value + spend,
      });
    }

    chain.appendLedger(specs);
  }

  step(`${PAYROLL_RUNS} payroll runs closed across ${chain.tip} ledgers.`);
  step(`Deposits carry a public leg (${money(publicTotal)} total); transfers carry none.`);

  heading('3. An archive indexes the chain');

  const store = new MemoryEventStore();
  const adapter = new ReferenceContractAdapter();
  const stats = await new Ingestor({ rpc: chain, store, adapter, windowSize: 5 }).runOnce();
  step(`Ingested ${stats.eventsInserted} events from ${stats.ledgersScanned} ledgers.`);
  step('Each transfer became two events, one per party, each under its own key.');

  const integrity = new IntegrityService(store);
  const api = new ApiServer({ store, integrity, adapterId: adapter.id });
  const port = await api.listen(0, '127.0.0.1');
  const archiveUrl = `http://127.0.0.1:${port}/`;
  step(`Archive API listening on ${archiveUrl}`);

  heading('4. A phone is wiped. The wallet rebuilds itself.');

  const employee = EMPLOYEES[0];
  const truth = expected.get(employee)!;

  // All that survives a wipe is the recovery phrase. Keys are re-derived.
  const recovered = deriveKeyset(Buffer.alloc(32, 1));
  const chainSource: ChainBalanceSource = {
    getConfidentialBalance: async () => truth.balance,
    getLatestLedger: async () => chain.tip,
  };

  const source = new HttpEventSource(archiveUrl, { id: 'archive-a' });
  const startedAt = Date.now();
  const result = await new RecoverySession({
    account: employee,
    viewingKey: recovered.viewing,
    source,
    chain: chainSource,
    pageSize: 25,
  }).sync();
  const elapsed = Date.now() - startedAt;

  step(`Fetched ${result.state.eventCount} events over HTTP in ${result.pagesFetched} page(s).`);
  step(`Rebuilt balance: ${money(result.state.value)}`);
  step(`Expected:        ${money(truth.value)}`);
  step(`Verified against chain: ${result.report?.verified === true ? 'yes' : 'no'}`);
  step(`Took ${(elapsed / 1000).toFixed(2)}s`);

  if (result.state.value !== truth.value || result.report?.verified !== true) {
    throw new Error('recovery did not reproduce the expected balance');
  }

  heading('5. Each party sees only their own history');

  for (const other of EMPLOYEES) {
    const theirs = await new RecoverySession({
      account: other,
      viewingKey: keysets.get(other)!.viewing,
      source,
    }).sync();
    step(`${other}: ${theirs.state.eventCount} events, ${money(theirs.state.value)}`);
  }
  step("No account's viewing key decrypts another's amounts.");

  heading('6. An archive tries to hide a payment');

  const honest = new HttpEventSource(archiveUrl, { id: 'archive-a' });
  const withholding: EventSource = {
    id: 'archive-b',
    fetchAccountEvents: async (request) => {
      const page = await honest.fetchAccountEvents(request);
      return { ...page, events: page.events.slice(0, -1) };
    },
    fetchDigest: (request) => honest.fetchDigest(request),
    status: () => honest.status(),
  };

  try {
    await new RecoverySession({
      account: employee,
      viewingKey: recovered.viewing,
      source: withholding,
      maxAttemptsPerPage: 1,
    }).sync();
    throw new Error('the withheld event went undetected');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'INTEGRITY_FAILURE') throw error;
    step('Rejected with INTEGRITY_FAILURE before it could touch a balance.');
    step('The archive committed to a history it then refused to serve.');
  }

  heading('7. Recovery with the wrong key fails loudly');

  try {
    await new RecoverySession({
      account: employee,
      viewingKey: keysets.get(EMPLOYEES[2])!.viewing,
      source,
    }).sync();
    throw new Error('the wrong key was accepted');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'WRONG_KEY') throw error;
    step('Rejected with WRONG_KEY. Never a plausible-looking wrong balance.');
  }

  await api.close();
  console.log('\n\x1b[32mDemo complete.\x1b[0m\n');
}

main().catch((error: unknown) => {
  console.error('\nDemo failed:', error);
  process.exit(1);
});
