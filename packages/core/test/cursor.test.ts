import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURSOR_MAX,
  CURSOR_MIN,
  compareCursors,
  decodeCursor,
  encodeCursor,
  isCursor,
  ledgerLowerBound,
  ledgerUpperBound,
} from '../src/cursor.js';
import { ValidationError } from '../src/errors.js';

describe('cursor', () => {
  it('round-trips a position', () => {
    const position = { ledgerSequence: 37265, txIndex: 3, opIndex: 1, eventIndex: 7 };
    assert.deepEqual(decodeCursor(encodeCursor(position)), position);
  });

  it('orders lexicographically the same way ledgers order numerically', () => {
    const positions = [
      { ledgerSequence: 9, txIndex: 0, opIndex: 0, eventIndex: 0 },
      { ledgerSequence: 10, txIndex: 0, opIndex: 0, eventIndex: 0 },
      { ledgerSequence: 10, txIndex: 0, opIndex: 0, eventIndex: 1 },
      { ledgerSequence: 10, txIndex: 0, opIndex: 2, eventIndex: 0 },
      { ledgerSequence: 10, txIndex: 1, opIndex: 0, eventIndex: 0 },
      { ledgerSequence: 100, txIndex: 0, opIndex: 0, eventIndex: 0 },
    ];
    const cursors = positions.map(encodeCursor);
    // This is the property PostgreSQL ordering and pagination both rely on.
    assert.deepEqual([...cursors].sort(), cursors);
  });

  it('places sentinels outside every real cursor', () => {
    const real = encodeCursor({ ledgerSequence: 1, txIndex: 0, opIndex: 0, eventIndex: 0 });
    assert.ok(compareCursors(CURSOR_MIN, real) < 0);
    assert.ok(compareCursors(CURSOR_MAX, real) > 0);
  });

  it('brackets a ledger with its bounds', () => {
    const inside = encodeCursor({ ledgerSequence: 50, txIndex: 4, opIndex: 2, eventIndex: 9 });
    assert.ok(ledgerLowerBound(50) <= inside);
    assert.ok(ledgerUpperBound(50) >= inside);
    assert.ok(ledgerUpperBound(50) < ledgerLowerBound(51));
  });

  it('rejects malformed and out-of-range input', () => {
    assert.throws(() => decodeCursor('nope'), ValidationError);
    assert.throws(() => decodeCursor('1-2-3-4'), ValidationError);
    assert.throws(
      () => encodeCursor({ ledgerSequence: -1, txIndex: 0, opIndex: 0, eventIndex: 0 }),
      ValidationError,
    );
    assert.throws(
      () => encodeCursor({ ledgerSequence: 1, txIndex: 100000, opIndex: 0, eventIndex: 0 }),
      ValidationError,
    );
    assert.equal(isCursor('0000000001-00000-00000-00000'), true);
    assert.equal(isCursor('1'), false);
  });
});
