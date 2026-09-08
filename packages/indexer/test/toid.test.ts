import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerError } from '@stellar-confidential/core';
import { decodeEventId, encodeToid } from '../src/toid.js';

describe('TOID', () => {
  it('round-trips a position', () => {
    for (const [ledger, tx, op] of [
      [1, 1, 0],
      [37265, 4, 2],
      [999_999, 4095, 1_048_575],
    ] as const) {
      const id = `${encodeToid(ledger, tx, op).toString()}-7`;
      assert.deepEqual(decodeEventId(id), {
        ledgerSequence: ledger,
        txIndex: tx,
        opIndex: op,
        eventIndex: 7,
      });
    }
  });

  it('decodes a known Stellar event id', () => {
    // 3 << 32 = 12884901888: ledger 3, transaction 0, operation 0.
    assert.deepEqual(decodeEventId('12884901888-0000000000'), {
      ledgerSequence: 3,
      txIndex: 0,
      opIndex: 0,
      eventIndex: 0,
    });
    // The low 20 bits are the operation index, so +4096 is operation 4096 of
    // the same ledger, not a different ledger.
    assert.deepEqual(decodeEventId('12884905984-0000000000'), {
      ledgerSequence: 3,
      txIndex: 0,
      opIndex: 4096,
      eventIndex: 0,
    });
  });

  it('rejects malformed ids rather than guessing a position', () => {
    assert.throws(() => decodeEventId('nonsense'), IndexerError);
    assert.throws(() => decodeEventId('12-34-56'), IndexerError);
    assert.throws(() => decodeEventId('abc-0'), IndexerError);
  });
});
