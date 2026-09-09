import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  Ingestor,
  MemoryEventStore,
  ReferenceContractAdapter,
  SyntheticChain,
} from '@stellar-confidential/indexer';
import { RecoveryServer } from '../src/server.js';

const ALICE = 'GALICE';

function amount(tag: string) {
  return { limbs: [{ commitment: tag.padEnd(64, '0'), handle: tag.padEnd(64, '1') }] };
}

describe('recovery coordination API', () => {
  const store = new MemoryEventStore();
  let server: RecoveryServer;
  let base: string;

  before(async () => {
    const chain = new SyntheticChain();
    for (let i = 1; i <= 8; i += 1) {
      chain.appendLedger([
        { type: 'deposit', account: ALICE, amount: amount(`d${i}`), publicAmount: String(i * 10) },
      ]);
    }
    await new Ingestor({ rpc: chain, store, adapter: new ReferenceContractAdapter() }).runOnce();

    server = new RecoveryServer({ store });
    const port = await server.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.close();
  });

  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('opens a session for an account', async () => {
    const { status, body } = await post('/recovery/session', { account: ALICE });
    assert.equal(status, 201);
    assert.equal(body['account'], ALICE);
    assert.equal(body['eventsExpected'], 8);
    assert.equal(body['status'], 'pending');
    assert.ok(body['id']);
  });

  it('reports progress as the client advances', async () => {
    const opened = await post('/recovery/session', { account: ALICE });
    const id = opened.body['id'] as string;

    const midway = await fetch(
      `${base}/recovery/status?session=${id}&cursor=0000000004-00001-00000-00000`,
    );
    const midwayBody = (await midway.json()) as Record<string, unknown>;
    assert.equal(midwayBody['status'], 'in-progress');
    assert.equal(midwayBody['eventsReported'], 4);

    const done = await fetch(
      `${base}/recovery/status?session=${id}&cursor=${opened.body['toCursor'] as string}`,
    );
    assert.equal(((await done.json()) as Record<string, unknown>)['status'], 'complete');
  });

  it('reports an account with no history as already complete', async () => {
    const { body } = await post('/recovery/session', { account: 'GNOBODY' });
    assert.equal(body['eventsExpected'], 0);
    assert.equal(body['status'], 'complete');
  });

  it('refuses any request carrying key material (invariant 1)', async () => {
    // A client should never be able to hand this service a key, even by mistake.
    for (const payload of [
      { account: ALICE, viewingKey: 'deadbeef' },
      { account: ALICE, seed: 'word word word' },
      { account: ALICE, spendKey: 'S123' },
      { account: ALICE, privateKey: 'x' },
    ]) {
      const { status, body } = await post('/recovery/session', payload);
      assert.equal(status, 400, `accepted ${Object.keys(payload).join(',')}`);
      assert.match(String(body['message']), /never key material/);
    }
  });

  it('validates its inputs', async () => {
    assert.equal((await post('/recovery/session', {})).status, 400);
    assert.equal((await post('/recovery/session', { account: '' })).status, 400);
    assert.equal(
      (await post('/recovery/session', { account: ALICE, fromCursor: 'nope' })).status,
      400,
    );
  });

  it('404s an unknown session', async () => {
    const response = await fetch(
      `${base}/recovery/status?session=00000000-0000-0000-0000-000000000000`,
    );
    assert.equal(response.status, 404);
  });

  it('requires a session id on status', async () => {
    assert.equal((await fetch(`${base}/recovery/status`)).status, 400);
  });

  it('reports health', async () => {
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body['status'], 'healthy');
    assert.equal(body['latestLedger'], 8);
  });
});
