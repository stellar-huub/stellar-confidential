import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_MAX, CURSOR_MIN, encodeCursor, type ConfidentialEvent } from '@stellar-confidential/core';
import type { EventStore, LedgerRecord } from '../src/store.js';

/**
 * Shared conformance suite.
 *
 * Both stores are held to exactly this behaviour. Running the same assertions
 * against the in-memory store and PostgreSQL is what makes it safe for the rest
 * of the test suite to use the fast one.
 */

export function makeEvent(
  ledgerSequence: number,
  index: number,
  overrides: Partial<ConfidentialEvent> = {},
): ConfidentialEvent {
  const cursor = encodeCursor({ ledgerSequence, txIndex: 1, opIndex: 0, eventIndex: index });
  return {
    id: cursor,
    cursor,
    type: 'transfer',
    contractId: 'CONTRACT_A',
    account: 'GALICE',
    counterparty: 'GBOB',
    delta: 'credit',
    amount: { limbs: [{ commitment: 'aa'.repeat(32), handle: 'bb'.repeat(32) }] },
    publicAmount: null,
    proof: {
      ledgerSequence,
      ledgerHash: `hash${ledgerSequence}`,
      ledgerCloseTime: 1_700_000_000 + ledgerSequence,
      txHash: `tx${ledgerSequence}-${index}`,
      txIndex: 1,
      opIndex: 0,
      eventIndex: index,
    },
    raw: { note: 'conformance' },
    ...overrides,
  };
}

export function makeLedger(sequence: number, eventCount = 0): LedgerRecord {
  return {
    sequence,
    hash: `hash${sequence}`,
    previousHash: `hash${sequence - 1}`,
    closeTime: 1_700_000_000 + sequence,
    eventCount,
  };
}

async function collect(store: EventStore, from = CURSOR_MIN, to = CURSOR_MAX) {
  const out: ConfidentialEvent[] = [];
  for await (const event of store.streamRange(from, to)) out.push(event);
  return out;
}

export function runStoreConformance(name: string, create: () => Promise<EventStore>): void {
  describe(`${name} (store conformance)`, () => {
    let store: EventStore;

    before(async () => {
      store = await create();
      await store.migrate();
      await store.rollbackTo(0);
    });

    after(async () => {
      await store.close();
    });

    it('appends ledgers, events and a checkpoint atomically', async () => {
      const result = await store.append({
        ledgers: [makeLedger(10, 2), makeLedger(11, 1)],
        events: [makeEvent(10, 0), makeEvent(10, 1), makeEvent(11, 0)],
        checkpoint: { name: 'primary', cursor: 'c1', ledgerSequence: 11 },
      });
      assert.equal(result.eventsInserted, 3);
      assert.equal(result.eventsSkipped, 0);
      assert.equal(result.ledgersInserted, 2);

      const checkpoint = await store.getCheckpoint('primary');
      assert.equal(checkpoint?.ledgerSequence, 11);
    });

    it('is idempotent: re-appending inserts nothing', async () => {
      const result = await store.append({
        ledgers: [makeLedger(10, 2)],
        events: [makeEvent(10, 0), makeEvent(10, 1)],
        checkpoint: { name: 'primary', cursor: 'c1', ledgerSequence: 11 },
      });
      assert.equal(result.eventsInserted, 0);
      assert.equal(result.eventsSkipped, 2);
      assert.equal((await collect(store)).length, 3);
    });

    it('returns events in cursor order', async () => {
      const events = await collect(store);
      const cursors = events.map((event) => event.cursor);
      assert.deepEqual([...cursors].sort(), cursors);
    });

    it('preserves every field through a round trip', async () => {
      const [first] = await collect(store);
      assert.deepEqual(first, makeEvent(10, 0));
    });

    it('filters by account, contract and type', async () => {
      await store.append({
        ledgers: [makeLedger(12, 1)],
        events: [makeEvent(12, 0, { account: 'GCAROL', contractId: 'CONTRACT_B', type: 'deposit' })],
        checkpoint: { name: 'primary', cursor: 'c2', ledgerSequence: 12 },
      });

      assert.equal((await store.getEvents({ account: 'GCAROL', limit: 10 })).events.length, 1);
      assert.equal((await store.getEvents({ contractId: 'CONTRACT_B', limit: 10 })).events.length, 1);
      assert.equal((await store.getEvents({ types: ['deposit'], limit: 10 })).events.length, 1);
      assert.equal((await store.getEvents({ types: ['withdraw'], limit: 10 })).events.length, 0);
      assert.equal(await store.countEvents({ account: 'GALICE' }), 3);
    });

    it('pages with a cursor and reports whether more remain', async () => {
      const first = await store.getEvents({ limit: 2 });
      assert.equal(first.events.length, 2);
      assert.equal(first.hasMore, true);
      assert.ok(first.nextCursor);

      const second = await store.getEvents({ afterCursor: first.nextCursor as string, limit: 10 });
      assert.equal(second.hasMore, false);
      assert.equal(second.nextCursor, null);
      // No overlap and no gap between pages.
      const all = [...first.events, ...second.events].map((event) => event.cursor);
      assert.equal(new Set(all).size, all.length);
      assert.equal(all.length, 4);
    });

    it('honours inclusive range bounds', async () => {
      const events = await collect(store);
      const from = events[1]!.cursor;
      const to = events[2]!.cursor;
      const ranged = await collect(store, from, to);
      assert.deepEqual(ranged.map((event) => event.cursor), [from, to]);
    });

    it('summarises an account', async () => {
      const summary = await store.getAccountSummary('GALICE');
      assert.equal(summary.eventCount, 3);
      assert.equal(summary.lastLedgerSequence, 11);
      assert.ok(summary.firstCursor);
      assert.ok(summary.lastCursor);

      const empty = await store.getAccountSummary('GNOBODY');
      assert.equal(empty.eventCount, 0);
      assert.equal(empty.firstCursor, null);
      assert.equal(empty.lastLedgerSequence, null);
    });

    it('tracks ledgers', async () => {
      assert.equal((await store.getLedger(10))?.hash, 'hash10');
      assert.equal((await store.getLatestLedger())?.sequence, 12);
      assert.equal(await store.getLedger(999), null);
    });

    it('rolls back everything above a ledger', async () => {
      const removed = await store.rollbackTo(10);
      assert.equal(removed, 2);
      assert.equal((await collect(store)).length, 2);
      assert.equal(await store.getLedger(11), null);
      assert.equal((await store.getLatestLedger())?.sequence, 10);
    });

    it('clamps a checkpoint that would point above rolled-back history', async () => {
      await store.append({
        ledgers: [makeLedger(30, 1)],
        events: [makeEvent(30, 0)],
        checkpoint: { name: 'primary', cursor: 'c-30', ledgerSequence: 30 },
      });
      assert.equal((await store.getCheckpoint('primary'))?.ledgerSequence, 30);

      await store.rollbackTo(10);

      // Leaving the checkpoint at 30 would make the next ingest resume past a
      // hole and silently produce an incomplete history.
      const checkpoint = await store.getCheckpoint('primary');
      assert.equal(checkpoint?.ledgerSequence, 10);
      assert.equal(checkpoint?.cursor, '0000000010-99999-99999-99999');
    });

    it('leaves a checkpoint below the rollback point alone', async () => {
      await store.append({
        ledgers: [],
        events: [],
        checkpoint: { name: 'behind', cursor: 'c-5', ledgerSequence: 5 },
      });
      await store.rollbackTo(10);
      assert.equal((await store.getCheckpoint('behind'))?.ledgerSequence, 5);
    });

    it('prunes everything below a ledger', async () => {
      await store.append({
        ledgers: [makeLedger(20, 1)],
        events: [makeEvent(20, 0)],
        checkpoint: { name: 'primary', cursor: 'c3', ledgerSequence: 20 },
      });
      const removed = await store.prune(20);
      assert.equal(removed, 2);
      assert.equal((await collect(store)).length, 1);
      assert.equal(await store.getLedger(10), null);
    });
  });
}
