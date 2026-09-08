import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryError, type EncryptedAmount } from '@stellar-confidential/core';
import { MemoryEventSource, HttpEventSource, type EventSource } from '../src/source.js';
import { RecoverySession, type ChainBalanceSource } from '../src/recover.js';
import { replayFromGenesis } from '../src/replay.js';
import { ALICE, aliceKeys, buildHistory, payrollHistory } from './fixtures.js';

function chainOf(balance: EncryptedAmount | null, ledger: number): ChainBalanceSource {
  return {
    getConfidentialBalance: async () => balance,
    getLatestLedger: async () => ledger,
  };
}

/** Wraps a source so the first `failures` calls fail as a dropped connection would. */
function flaky(inner: EventSource, failures: number): EventSource {
  let remaining = failures;
  return {
    id: inner.id,
    fetchAccountEvents: async (request) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new RecoveryError('SOURCE_UNAVAILABLE', 'connection reset', { source: inner.id });
      }
      return inner.fetchAccountEvents(request);
    },
    fetchDigest: (request) => inner.fetchDigest(request),
    status: () => inner.status(),
  };
}

describe('RecoverySession', () => {
  it('recovers a wiped wallet from an archive and verifies it against the chain', async () => {
    const history = payrollHistory(20);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(history.events),
      chain: chainOf(history.chainBalance, history.latestLedger),
    });

    const result = await session.sync();

    assert.equal(result.state.value, history.expectedValue);
    assert.equal(result.state.eventCount, history.events.length);
    assert.equal(result.report?.verified, true);
    assert.equal(result.checkpoint?.account, ALICE);
  });

  it('pages through a long history', async () => {
    const history = payrollHistory(15);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(history.events),
      pageSize: 4,
    });

    const result = await session.sync();
    assert.equal(result.state.eventCount, history.events.length);
    assert.ok(result.pagesFetched > 3, 'expected several pages');
  });

  it('syncs incrementally from a checkpoint (M2.4)', async () => {
    const history = payrollHistory(20);
    const firstHalf = history.events.slice(0, 10);

    const initial = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(firstHalf),
    });
    const firstRun = await initial.sync();
    assert.equal(firstRun.state.eventCount, 10);

    // Later, with the full history available, resume from the checkpoint.
    const resumed = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(history.events),
      chain: chainOf(history.chainBalance, history.latestLedger),
    });
    const secondRun = await resumed.sync({ from: firstRun.checkpoint });

    // Only the new events were fetched and applied.
    assert.equal(secondRun.eventsApplied, history.events.length - 10);
    assert.equal(secondRun.state.eventCount, history.events.length);
    assert.equal(secondRun.state.value, history.expectedValue);
    assert.equal(secondRun.report?.verified, true);

    // And it lands exactly where a full replay would.
    const full = replayFromGenesis(ALICE, history.events, aliceKeys.viewing);
    assert.equal(secondRun.state.digest, full.digest);
    assert.deepEqual(secondRun.state.balance, full.balance);
  });

  it('rejects a checkpoint from another account', async () => {
    const history = payrollHistory(3);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(history.events),
    });
    const result = await session.sync();
    await assert.rejects(
      () =>
        session.sync({
          from: { ...(result.checkpoint as NonNullable<typeof result.checkpoint>), account: 'GOTHER' },
        }),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'CHECKPOINT_MISMATCH');
        return true;
      },
    );
  });

  it('survives a dropped connection and completes', async () => {
    const history = payrollHistory(10);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: flaky(new MemoryEventSource(history.events), 2),
      chain: chainOf(history.chainBalance, history.latestLedger),
      sleepImpl: async () => {},
    });

    const result = await session.sync();
    assert.equal(result.state.value, history.expectedValue);
    assert.equal(result.report?.verified, true);
  });

  it('gives up with a typed error when the archive stays unreachable', async () => {
    const history = payrollHistory(3);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: flaky(new MemoryEventSource(history.events), 99),
      maxAttemptsPerPage: 3,
      sleepImpl: async () => {},
    });

    await assert.rejects(
      () => session.sync(),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'SOURCE_UNAVAILABLE');
        return true;
      },
    );
  });

  it('does not retry an archive that failed integrity', async () => {
    // Retrying a provider that served events not matching its own digest just
    // asks a misbehaving archive the same question again.
    const history = payrollHistory(6);
    let digestCalls = 0;
    const lying: EventSource = {
      id: 'lying-archive',
      fetchAccountEvents: (request) => new MemoryEventSource(history.events).fetchAccountEvents(request),
      fetchDigest: async (request) => {
        digestCalls += 1;
        // A digest for a different range than the events served.
        return new MemoryEventSource(history.events.slice(0, 2)).fetchDigest(request);
      },
      status: async () => ({ latestLedger: history.latestLedger }),
    };

    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: lying,
      sleepImpl: async () => {},
    });

    await assert.rejects(
      () => session.sync(),
      (error: unknown) => {
        assert.ok(error instanceof RecoveryError);
        assert.equal(error.code, 'INTEGRITY_FAILURE');
        return true;
      },
    );
    assert.equal(digestCalls, 1, 'integrity failures must not be retried');
  });

  it('keeps partial progress when a sync fails part-way', async () => {
    const history = payrollHistory(12);
    let calls = 0;
    const source = new MemoryEventSource(history.events);
    const failsLater: EventSource = {
      id: 'partial',
      fetchAccountEvents: async (request) => {
        calls += 1;
        if (calls > 2) throw new RecoveryError('SOURCE_UNAVAILABLE', 'gone', {});
        return source.fetchAccountEvents(request);
      },
      fetchDigest: (request) => source.fetchDigest(request),
      status: () => source.status(),
    };

    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: failsLater,
      pageSize: 4,
      maxAttemptsPerPage: 1,
      sleepImpl: async () => {},
    });

    await assert.rejects(() => session.sync());
    // Work already done is not thrown away.
    assert.equal(session.current.eventCount, 8);

    // A later sync against a healthy archive resumes from there.
    const healthy = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source,
      chain: chainOf(history.chainBalance, history.latestLedger),
    });
    const result = await healthy.sync({
      from: {
        version: 1,
        account: ALICE,
        cursor: session.current.lastCursor as string,
        balance: session.current.balance,
        value: session.current.value.toString(),
        eventCount: session.current.eventCount,
        lastLedgerSequence: session.current.lastLedgerSequence,
        digest: session.current.digest,
      },
    });
    assert.equal(result.state.value, history.expectedValue);
    assert.equal(result.report?.verified, true);
  });

  it('surfaces a stale archive rather than reporting a confident balance', async () => {
    const history = payrollHistory(8);
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource(history.events, { latestLedger: history.latestLedger }),
      chain: chainOf(history.chainBalance, history.latestLedger + 5_000),
      maxAcceptableLag: 5,
    });

    const result = await session.sync();
    assert.equal(result.report?.verified, false);
    assert.equal(result.report?.failure?.code, 'STALE_INDEX');
  });

  it('handles an account with no history at all', async () => {
    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new MemoryEventSource([], { latestLedger: 100 }),
      chain: chainOf(null, 100),
    });

    const result = await session.sync();
    assert.equal(result.state.value, 0n);
    assert.equal(result.checkpoint, null);
    assert.equal(result.report?.verified, true);
  });
});

describe('the archive never receives key material (invariant 1)', () => {
  it('sends no secret in any request during a full sync', async () => {
    const history = buildHistory(ALICE, aliceKeys, [
      { delta: 'credit', value: 5_000n },
      { delta: 'debit', value: 1_200n },
    ]);
    const backing = new MemoryEventSource(history.events);

    const traffic: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      traffic.push(url.toString());
      if (init?.body !== undefined && init.body !== null) traffic.push(String(init.body));
      for (const [key, value] of Object.entries(init?.headers ?? {})) traffic.push(`${key}: ${value}`);

      if (url.pathname.endsWith('/health')) {
        return new Response(JSON.stringify({ latestLedger: history.latestLedger }), { status: 200 });
      }
      if (url.pathname.endsWith('/digest')) {
        const digest = await backing.fetchDigest({
          account: ALICE,
          fromCursor: url.searchParams.get('from') as string,
          toCursor: url.searchParams.get('to') as string,
        });
        return new Response(JSON.stringify(digest), { status: 200 });
      }
      const after = url.searchParams.get('after');
      const page = await backing.fetchAccountEvents({
        account: ALICE,
        ...(after === null ? {} : { afterCursor: after }),
        limit: Number(url.searchParams.get('limit') ?? 100),
      });
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;

    const session = new RecoverySession({
      account: ALICE,
      viewingKey: aliceKeys.viewing,
      source: new HttpEventSource('http://archive.test/', { fetchImpl }),
      chain: chainOf(history.chainBalance, history.latestLedger),
    });

    const result = await session.sync();
    assert.equal(result.state.value, 3_800n);
    assert.ok(traffic.length > 0, 'expected the session to have talked to the archive');

    const wire = traffic.join('\n');
    const spendSecret = Buffer.from(aliceKeys.spend.secret).toString('hex');
    const viewingScalar = aliceKeys.viewing.scalar.toString(16);

    assert.equal(wire.includes(spendSecret), false, 'spend key reached the archive');
    assert.equal(wire.includes(viewingScalar), false, 'viewing key reached the archive');
    assert.equal(wire.includes('3800'), false, 'a decrypted balance reached the archive');
    // The account identifier is public and is expected to appear.
    assert.ok(wire.includes(ALICE));
  });
});
