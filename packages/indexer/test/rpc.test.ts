import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerError } from '@stellar-confidential/core';
import { StellarRpc } from '../src/rpc.js';

interface Call {
  readonly method: string;
  readonly params: unknown;
}

/** A fetch stand-in that replays scripted responses and records what was asked. */
function scriptedFetch(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  let index = 0;
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push({ method: body.method, params: (body as { params: unknown }).params });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return next!();
  }) as unknown as typeof fetch;
  return { impl, calls, attempts: () => index };
}

const ok = (result: unknown) => () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
const httpError = (status: number) => () => new Response('boom', { status });
const rpcError = (message: string) => () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message } }), {
    status: 200,
  });

function client(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new StellarRpc({
    url: 'http://rpc.test/rpc',
    fetchImpl,
    sleepImpl: async () => {}, // no real waiting in tests
    maxRequestsPerSecond: 0,
    ...overrides,
  });
}

describe('StellarRpc', () => {
  it('parses getHealth', async () => {
    const { impl } = scriptedFetch([ok({ status: 'healthy', latestLedger: 100, oldestLedger: 7 })]);
    const health = await client(impl).getHealth();
    assert.deepEqual(health, { status: 'healthy', latestLedger: 100, oldestLedger: 7 });
  });

  it('accepts numeric fields that arrive as strings', async () => {
    // Stellar RPC returns closeTime and sequence as strings in places.
    // getLedgers returns a LedgerHeaderHistoryEntry: own hash, version, parent.
    const ownHash = 'ef'.repeat(32);
    const header = Buffer.alloc(72);
    Buffer.from(ownHash, 'hex').copy(header, 0);
    header.writeUInt32BE(23, 32);
    Buffer.from('cd'.repeat(32), 'hex').copy(header, 36);
    const { impl } = scriptedFetch([
      ok({
        ledgers: [
          {
            sequence: '55',
            hash: ownHash,
            ledgerCloseTime: '1700000000',
            headerXdr: header.toString('base64'),
          },
        ],
      }),
    ]);
    const [ledger] = await client(impl).getLedgers(55, 1);
    assert.equal(ledger?.sequence, 55);
    assert.equal(ledger?.hash, ownHash);
    assert.equal(ledger?.closeTime, 1_700_000_000);
    assert.equal(ledger?.previousHash, 'cd'.repeat(32));
    assert.equal(ledger?.protocolVersion, 23);
  });

  it('retries a retryable HTTP status and then succeeds', async () => {
    const script = scriptedFetch([
      httpError(503),
      httpError(429),
      ok({ status: 'healthy', latestLedger: 1, oldestLedger: 1 }),
    ]);
    const health = await client(script.impl).getHealth();
    assert.equal(health.status, 'healthy');
    assert.equal(script.attempts(), 3);
  });

  it('gives up after the attempt budget', async () => {
    const script = scriptedFetch([httpError(503)]);
    await assert.rejects(
      () => client(script.impl, { maxAttempts: 3 }).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof IndexerError);
        assert.equal(error.code, 'RPC_UNAVAILABLE');
        return true;
      },
    );
    assert.equal(script.attempts(), 3);
  });

  it('does not retry a client error', async () => {
    const script = scriptedFetch([httpError(400)]);
    await assert.rejects(() => client(script.impl).getHealth());
    assert.equal(script.attempts(), 1, 'a 400 will not become a 200 on retry');
  });

  it('does not retry a JSON-RPC error, which is the node answering', async () => {
    const script = scriptedFetch([rpcError('invalid startLedger')]);
    await assert.rejects(
      () => client(script.impl).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof IndexerError);
        assert.equal(error.code, 'RPC_PROTOCOL');
        assert.match(error.message, /invalid startLedger/);
        return true;
      },
    );
    assert.equal(script.attempts(), 1);
  });

  it('rejects a malformed payload rather than inventing fields', async () => {
    const { impl } = scriptedFetch([ok({ status: 'healthy' })]);
    await assert.rejects(() => client(impl).getHealth(), IndexerError);
  });

  it('sends startLedger or cursor, never both', async () => {
    const page = { events: [], latestLedger: 10, oldestLedger: 1, cursor: '' };
    const script = scriptedFetch([ok(page)]);
    const rpc = client(script.impl);

    await rpc.getEvents({ startLedger: 5, limit: 10 });
    const first = script.calls[0]?.params as Record<string, unknown>;
    assert.equal(first['startLedger'], 5);
    assert.equal((first['pagination'] as Record<string, unknown>)['cursor'], undefined);

    await rpc.getEvents({ startLedger: 5, cursor: 'abc-0', limit: 10 });
    const second = script.calls[1]?.params as Record<string, unknown>;
    assert.equal(second['startLedger'], undefined);
    assert.equal((second['pagination'] as Record<string, unknown>)['cursor'], 'abc-0');
  });

  it('accepts both the modern and legacy event value encodings', async () => {
    const base = {
      id: '12884901888-0',
      type: 'contract',
      ledger: 3,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'C1',
      txHash: 'tx',
      topic: ['dG9waWM='],
      inSuccessfulContractCall: true,
    };
    const { impl } = scriptedFetch([
      ok({
        events: [
          { ...base, value: 'dmFsdWU=' },
          { ...base, id: '12884901889-0', value: { xdr: 'bGVnYWN5' } },
        ],
        latestLedger: 3,
        oldestLedger: 1,
        cursor: '',
      }),
    ]);
    const page = await client(impl).getEvents({ startLedger: 1, limit: 10 });
    assert.equal(page.events[0]?.value, 'dmFsdWU=');
    assert.equal(page.events[1]?.value, 'bGVnYWN5');
  });

  it('rate limits requests when configured', async () => {
    const waits: number[] = [];
    const script = scriptedFetch([ok({ status: 'healthy', latestLedger: 1, oldestLedger: 1 })]);
    const rpc = new StellarRpc({
      url: 'http://rpc.test/rpc',
      fetchImpl: script.impl,
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      maxRequestsPerSecond: 10, // one request per 100ms
    });
    await rpc.getHealth();
    await rpc.getHealth();
    assert.ok(
      waits.some((wait) => wait > 0),
      'expected the second call to be spaced out',
    );
  });

  it('rejects a ledger whose header does not commit to the reported hash', async () => {
    const header = Buffer.alloc(72);
    Buffer.from('11'.repeat(32), 'hex').copy(header, 0);
    header.writeUInt32BE(23, 32);
    const { impl } = scriptedFetch([
      ok({
        ledgers: [
          {
            sequence: 55,
            hash: '99'.repeat(32),
            ledgerCloseTime: 1,
            headerXdr: header.toString('base64'),
          },
        ],
      }),
    ]);
    await assert.rejects(
      () => client(impl).getLedgers(55, 1),
      (error: unknown) => {
        assert.ok(error instanceof IndexerError);
        assert.equal(error.code, 'RPC_PROTOCOL');
        return true;
      },
    );
  });
});
