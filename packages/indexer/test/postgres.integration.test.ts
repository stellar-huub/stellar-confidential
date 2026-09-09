import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createPool } from '../src/db/pool.js';
import { PostgresEventStore } from '../src/db/postgres-store.js';
import { MemoryEventStore } from '../src/store-memory.js';
import { Ingestor } from '../src/pipeline.js';
import { ReferenceContractAdapter } from '../src/adapters/reference.js';
import { SyntheticChain } from '../src/testing/synthetic.js';
import {
  merkleRoot,
  CURSOR_MAX,
  CURSOR_MIN,
  type ConfidentialEvent,
} from '@stellar-confidential/core';
import { runStoreConformance } from './store-conformance.js';
import { DATABASE_URL, INTEGRATION_ENABLED, skipUnlessIntegration } from './integration-config.js';

if (INTEGRATION_ENABLED) {
  runStoreConformance('PostgresEventStore', async () => {
    const pool = createPool({ connectionString: DATABASE_URL });
    return new PostgresEventStore(pool);
  });
}

describe('PostgreSQL parity with the in-memory store', { skip: skipUnlessIntegration() }, () => {
  let pool: Pool;
  let store: PostgresEventStore;

  before(async () => {
    pool = createPool({ connectionString: DATABASE_URL });
    store = new PostgresEventStore(pool);
    await store.migrate();
    await store.rollbackTo(0);
  });

  after(async () => {
    await store.rollbackTo(0);
    await store.close();
  });

  function chain(): SyntheticChain {
    const built = new SyntheticChain();
    for (let i = 1; i <= 30; i += 1) {
      built.appendLedger(
        i % 3 === 0
          ? [
              {
                type: 'transfer',
                account: 'GALICE',
                counterparty: 'GBOB',
                amount: {
                  limbs: [{ commitment: `a${i}`.padEnd(64, '0'), handle: `a${i}`.padEnd(64, '1') }],
                },
                counterpartyAmount: {
                  limbs: [{ commitment: `b${i}`.padEnd(64, '0'), handle: `b${i}`.padEnd(64, '1') }],
                },
              },
            ]
          : [],
      );
    }
    return built;
  }

  async function drain(
    target: PostgresEventStore | MemoryEventStore,
  ): Promise<ConfidentialEvent[]> {
    const events: ConfidentialEvent[] = [];
    for await (const event of target.streamRange(CURSOR_MIN, CURSOR_MAX)) events.push(event);
    return events;
  }

  it('ingests to exactly the same state as the in-memory store', async () => {
    const memory = new MemoryEventStore();
    const options = {
      adapter: new ReferenceContractAdapter(),
      windowSize: 7,
      pageSize: 20,
      checkpointName: 'parity',
    };

    await new Ingestor({ ...options, rpc: chain(), store: memory }).runOnce();
    await new Ingestor({ ...options, rpc: chain(), store }).runOnce();

    const fromPostgres = await drain(store);
    const fromMemory = await drain(memory);

    assert.equal(fromPostgres.length, fromMemory.length);
    assert.equal(merkleRoot(fromPostgres), merkleRoot(fromMemory));
    assert.deepEqual(fromPostgres, fromMemory);
  });

  it('is idempotent across a restart against a real database', async () => {
    const before = merkleRoot(await drain(store));
    await new Ingestor({
      rpc: chain(),
      store,
      adapter: new ReferenceContractAdapter(),
      checkpointName: 'restart',
      startLedger: 1,
    }).runOnce();
    assert.equal(merkleRoot(await drain(store)), before);
  });

  it('cascades events when a ledger is rolled back', async () => {
    const removed = await store.rollbackTo(15);
    assert.ok(removed > 0);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS count FROM events WHERE ledger_sequence > 15',
    );
    assert.equal(rows[0]?.count, 0);
  });

  it('runs migrations idempotently', async () => {
    await store.migrate();
    await store.migrate();
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');
    assert.equal(rows[0]?.count, 1);
  });

  it('answers an account history query from the index at scale (M1.3)', async () => {
    // The planner is right to scan a tiny table, so the index only proves itself
    // once there is enough data for the choice to matter.
    const accounts = 40;
    const perAccount = 250;
    await pool.query(
      `INSERT INTO ledgers (sequence, hash, previous_hash, close_time, event_count)
       SELECT g, 'h' || g, 'h' || (g - 1), 1700000000 + g, 0
         FROM generate_series(100000, 100000 + $1) AS g
       ON CONFLICT (sequence) DO NOTHING`,
      [perAccount],
    );
    await pool.query(
      `INSERT INTO events (
         event_cursor, ledger_sequence, tx_index, op_index, event_index,
         ledger_hash, ledger_close_time, tx_hash, contract_id, type,
         account, counterparty, delta, amount, public_amount, raw
       )
       SELECT lpad((100000 + n)::text, 10, '0') || '-00001-00000-' || lpad(a::text, 5, '0'),
              100000 + n, 1, 0, a,
              'h' || (100000 + n), 1700000000 + n, 'tx', 'CONTRACT_A', 'transfer',
              'GBULK' || a, NULL, 'credit', NULL, NULL, '{}'::jsonb
         FROM generate_series(0, $1 - 1) AS n, generate_series(0, $2 - 1) AS a
       ON CONFLICT (event_cursor) DO NOTHING`,
      [perAccount, accounts],
    );
    await pool.query('ANALYZE events');

    const total = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM events');
    assert.ok(Number(total.rows[0]?.count) >= accounts * perAccount);

    const { rows } = await pool.query(
      'EXPLAIN SELECT * FROM events WHERE account = $1 ORDER BY event_cursor ASC LIMIT 50',
      ['GBULK7'],
    );
    const plan = rows.map((row) => String(row['QUERY PLAN'])).join('\n');
    // A sequential scan here is the difference between a p95 of 200ms and one of
    // many seconds once history is real.
    assert.match(plan, /events_account_cursor_idx/, `planner chose:\n${plan}`);

    const started = process.hrtime.bigint();
    const page = await store.getEvents({ account: 'GBULK7', limit: 50 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(page.events.length, 50);
    assert.ok(elapsedMs < 200, `account page took ${elapsedMs.toFixed(1)}ms`);
  });
});
