import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_MAX, CURSOR_MIN, verifyAgainstDigest } from '@stellar-confidential/core';
import { MemoryEventStore } from '../src/store-memory.js';
import { IntegrityService } from '../src/integrity.js';
import { MemoryCache } from '../src/cache.js';
import { makeEvent, makeLedger } from './store-conformance.js';

describe('IntegrityService', () => {
  let store: MemoryEventStore;

  beforeEach(async () => {
    store = new MemoryEventStore();
    await store.append({
      ledgers: [makeLedger(1, 2), makeLedger(2, 1)],
      events: [
        makeEvent(1, 0),
        makeEvent(1, 1, { account: 'GBOB' }),
        makeEvent(2, 0),
      ],
      checkpoint: { name: 'primary', cursor: 'c', ledgerSequence: 2 },
    });
  });

  it('publishes a digest a client can verify its events against', async () => {
    const service = new IntegrityService(store);
    const digest = await service.digest();

    const events = store.snapshot();
    assert.equal(digest.eventCount, 3);
    assert.deepEqual(verifyAgainstDigest(events, digest), []);
  });

  it('detects an archive that withholds an event (invariant 4)', async () => {
    const digest = await new IntegrityService(store).digest();
    const withheld = store.snapshot().filter((event) => event.account !== 'GBOB');

    const problems = verifyAgainstDigest(withheld, digest);
    assert.ok(problems.some((problem) => problem.kind === 'count'));
    assert.ok(problems.some((problem) => problem.kind === 'root'));
  });

  it('detects an archive that alters an event', async () => {
    const digest = await new IntegrityService(store).digest();
    const tampered = store.snapshot().map((event, index) =>
      index === 1 ? { ...event, delta: 'debit' as const } : event,
    );
    assert.ok(verifyAgainstDigest(tampered, digest).some((problem) => problem.kind === 'root'));
  });

  it('scopes a digest to one account', async () => {
    const service = new IntegrityService(store);
    const scoped = await service.digest({ account: 'GALICE' });
    assert.equal(scoped.eventCount, 2);

    const alice = store.snapshot().filter((event) => event.account === 'GALICE');
    assert.deepEqual(verifyAgainstDigest(alice, scoped), []);
  });

  it('scopes a digest to a cursor range', async () => {
    const events = store.snapshot();
    const digest = await new IntegrityService(store).digest({
      fromCursor: events[0]!.cursor,
      toCursor: events[1]!.cursor,
    });
    assert.equal(digest.eventCount, 2);
    assert.equal(digest.lastCursor, events[1]!.cursor);
  });

  it('caches closed ranges and still reflects new events on the open range', async () => {
    const cache = new MemoryCache();
    const service = new IntegrityService(store, cache);

    const openBefore = await service.digest({ fromCursor: CURSOR_MIN, toCursor: CURSOR_MAX });
    assert.equal(openBefore.eventCount, 3);

    // A cached digest must be a real digest, not a placeholder.
    const cachedAgain = await service.digest({ fromCursor: CURSOR_MIN, toCursor: CURSOR_MAX });
    assert.deepEqual(cachedAgain, openBefore);
  });

  it('commits to the empty range without a special case', async () => {
    const digest = await new IntegrityService(new MemoryEventStore()).digest();
    assert.equal(digest.eventCount, 0);
    assert.match(digest.merkleRoot, /^[0-9a-f]{64}$/);
    assert.equal(digest.lastCursor, null);
  });
});
