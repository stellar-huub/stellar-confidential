import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { verifyAgainstDigest, type ConfidentialEvent, type RangeDigest } from '@stellar-confidential/core';
import {
  Ingestor,
  IntegrityService,
  MemoryEventStore,
  ReferenceContractAdapter,
  SyntheticChain,
  type SyntheticEventSpec,
} from '@stellar-confidential/indexer';
import { ApiServer } from '../src/server.js';

const ALICE = 'GALICE';
const BOB = 'GBOB';

function amount(tag: string) {
  return { limbs: [{ commitment: tag.padEnd(64, '0'), handle: tag.padEnd(64, '1') }] };
}

describe('archive API', () => {
  const store = new MemoryEventStore();
  const integrity = new IntegrityService(store);
  let server: ApiServer;
  let base: string;

  before(async () => {
    const chain = new SyntheticChain();
    for (let i = 1; i <= 12; i += 1) {
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
      if (i % 4 === 0) {
        specs.push({ type: 'deposit', account: ALICE, amount: amount(`d${i}`), publicAmount: '100' });
      }
      chain.appendLedger(specs);
    }
    await new Ingestor({ rpc: chain, store, adapter: new ReferenceContractAdapter() }).runOnce();

    server = new ApiServer({ store, integrity, adapterId: 'reference', version: '0.1.0' });
    const port = await server.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.close();
  });

  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('reports health', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    assert.equal(body['status'], 'healthy');
    assert.equal(body['latestLedger'], 12);
    assert.equal(body['adapter'], 'reference');
    assert.ok((body['eventCount'] as number) > 0);
  });

  it('serves an OpenAPI document', async () => {
    const { status, body } = await get('/openapi.json');
    assert.equal(status, 200);
    assert.equal(body['openapi'], '3.0.3');
    assert.ok((body['paths'] as Record<string, unknown>)['/accounts/{account}/events']);
  });

  it('pages events in cursor order', async () => {
    const first = await get('/events?limit=3');
    const events = first.body['events'] as ConfidentialEvent[];
    assert.equal(events.length, 3);
    assert.equal(first.body['hasMore'], true);

    const cursors = events.map((event) => event.cursor);
    assert.deepEqual([...cursors].sort(), cursors);

    const second = await get(`/events?limit=100&after=${first.body['nextCursor'] as string}`);
    const more = second.body['events'] as ConfidentialEvent[];
    // No overlap between pages.
    assert.equal(more.some((event) => cursors.includes(event.cursor)), false);
  });

  it('filters an account history', async () => {
    const { body } = await get(`/accounts/${ALICE}/events?limit=100`);
    const events = body['events'] as ConfidentialEvent[];
    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.account === ALICE));
  });

  it('summarises an account', async () => {
    const { body } = await get(`/accounts/${BOB}/summary`);
    assert.equal(body['account'], BOB);
    assert.ok((body['eventCount'] as number) > 0);
    assert.ok(body['firstCursor']);
  });

  it('publishes a digest a client can verify against (M1.5)', async () => {
    const { body: page } = await get(`/accounts/${ALICE}/events?limit=1000`);
    const events = page['events'] as ConfidentialEvent[];
    const { body } = await get(`/accounts/${ALICE}/digest`);
    const digest = body as unknown as RangeDigest;

    assert.equal(digest.eventCount, events.length);
    assert.deepEqual(verifyAgainstDigest(events, digest), []);

    // And the digest catches a client that was served less than it should be.
    assert.ok(verifyAgainstDigest(events.slice(0, -1), digest).length > 0);
  });

  it('rejects a malformed cursor rather than ignoring it', async () => {
    const { status, body } = await get('/events?after=not-a-cursor');
    assert.equal(status, 400);
    assert.equal(body['error'], 'INVALID_REQUEST');
  });

  it('rejects an unknown event type', async () => {
    const { status } = await get('/events?type=teleport');
    assert.equal(status, 400);
  });

  it('rejects an out-of-range limit', async () => {
    assert.equal((await get('/events?limit=0')).status, 400);
    assert.equal((await get('/events?limit=99999')).status, 400);
  });

  it('404s an unknown route', async () => {
    assert.equal((await get('/nope')).status, 404);
  });

  it('rejects a non-GET method', async () => {
    const response = await fetch(`${base}/events`, { method: 'POST' });
    assert.equal(response.status, 400);
  });

  it('streams new events over WebSocket', async () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws?account=${ALICE}`);
    const messages: Array<Record<string, unknown>> = [];

    // Attach the handler before waiting on open: the server acknowledges the
    // subscription immediately, so a listener added afterwards races it.
    socket.on('message', (data) => messages.push(JSON.parse(String(data)) as Record<string, unknown>));
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });

    const page = await get(`/accounts/${ALICE}/events?limit=2`);
    const sample = page.body['events'] as ConfidentialEvent[];
    server.broadcast([
      ...sample,
      { ...(sample[0] as ConfidentialEvent), account: BOB, cursor: 'zzz', id: 'zzz' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.close();

    assert.equal(messages[0]?.['type'], 'subscribed');
    const push = messages.find((message) => message['type'] === 'events');
    assert.ok(push, 'expected an events push');
    const pushed = push['events'] as ConfidentialEvent[];
    // Filtered to the subscribed account only.
    assert.equal(pushed.length, sample.length);
    assert.ok(pushed.every((event) => event.account === ALICE));
  });

  it('enforces a rate limit', async () => {
    const limited = new ApiServer({ store, integrity, ratePerMinute: 3 });
    const port = await limited.listen(0, '127.0.0.1');
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        statuses.push((await fetch(`http://127.0.0.1:${port}/health`)).status);
      }
      assert.ok(statuses.includes(429), `expected a 429, got ${statuses.join(',')}`);
    } finally {
      await limited.close();
    }
  });
});
