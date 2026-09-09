import { ValidationError } from './errors.js';

/**
 * Total ordering key for confidential events.
 *
 * Stellar orders events by (ledger, transaction, operation, event). We encode
 * that tuple as a fixed-width, zero-padded string so that lexicographic ordering
 * — in PostgreSQL, in a sort, in a URL query — matches ledger ordering exactly.
 * Widths are chosen to outlive the network: 10 digits of ledger is ~340 years at
 * 5s close times, and 5 digits each of tx/op/event exceeds protocol limits.
 */
export interface EventPosition {
  readonly ledgerSequence: number;
  readonly txIndex: number;
  readonly opIndex: number;
  readonly eventIndex: number;
}

const LEDGER_WIDTH = 10;
const SUB_WIDTH = 5;
const MAX_SUB = 99_999;
const CURSOR_PATTERN = /^\d{10}-\d{5}-\d{5}-\d{5}$/;

/** Sorts before every real cursor. Used as the "from the beginning" bound. */
export const CURSOR_MIN = '0000000000-00000-00000-00000';
/** Sorts after every real cursor. Used as the open upper bound. */
export const CURSOR_MAX = '9999999999-99999-99999-99999';

export function encodeCursor(position: EventPosition): string {
  const { ledgerSequence, txIndex, opIndex, eventIndex } = position;
  for (const [name, value, max] of [
    ['ledgerSequence', ledgerSequence, 9_999_999_999],
    ['txIndex', txIndex, MAX_SUB],
    ['opIndex', opIndex, MAX_SUB],
    ['eventIndex', eventIndex, MAX_SUB],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new ValidationError('INVALID_REQUEST', `cursor component ${name} out of range`, {
        component: name,
        value,
        max,
      });
    }
  }
  return [
    String(ledgerSequence).padStart(LEDGER_WIDTH, '0'),
    String(txIndex).padStart(SUB_WIDTH, '0'),
    String(opIndex).padStart(SUB_WIDTH, '0'),
    String(eventIndex).padStart(SUB_WIDTH, '0'),
  ].join('-');
}

export function decodeCursor(cursor: string): EventPosition {
  if (!CURSOR_PATTERN.test(cursor)) {
    throw new ValidationError('INVALID_REQUEST', 'malformed cursor', { cursor });
  }
  const [ledger, tx, op, ev] = cursor.split('-') as [string, string, string, string];
  return {
    ledgerSequence: Number(ledger),
    txIndex: Number(tx),
    opIndex: Number(op),
    eventIndex: Number(ev),
  };
}

export function isCursor(value: string): boolean {
  return CURSOR_PATTERN.test(value);
}

/** Negative if a precedes b, positive if a follows b, zero if identical. */
export function compareCursors(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The lowest cursor that could belong to `ledgerSequence`. */
export function ledgerLowerBound(ledgerSequence: number): string {
  return encodeCursor({ ledgerSequence, txIndex: 0, opIndex: 0, eventIndex: 0 });
}

/** The highest cursor that could belong to `ledgerSequence`. */
export function ledgerUpperBound(ledgerSequence: number): string {
  return encodeCursor({
    ledgerSequence,
    txIndex: MAX_SUB,
    opIndex: MAX_SUB,
    eventIndex: MAX_SUB,
  });
}
