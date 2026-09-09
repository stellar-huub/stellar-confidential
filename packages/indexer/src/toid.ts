import { IndexerError } from '@stellar-confidential/core';

/**
 * Stellar TOID decoding.
 *
 * Stellar RPC identifies an event as "<toid>-<eventOrdinal>", where the TOID
 * packs the event's position in the ledger into a single 64-bit integer:
 *
 *   bits 63..32  ledger sequence
 *   bits 31..20  transaction application order (1-based)
 *   bits 19..0   operation index within the transaction
 *
 * Decoding it is how we recover the (ledger, tx, op) triple that our cursor
 * ordering depends on, without asking the RPC for fields that older versions do
 * not return.
 */

const TX_MASK = 0xfffn;
const OP_MASK = 0xfffffn;

export interface EventOrdinal {
  readonly ledgerSequence: number;
  readonly txIndex: number;
  readonly opIndex: number;
  readonly eventIndex: number;
}

export function decodeEventId(id: string): EventOrdinal {
  const parts = id.split('-');
  if (parts.length !== 2) {
    throw new IndexerError('RPC_PROTOCOL', 'unrecognised event id format', { id });
  }
  const [toidPart, ordinalPart] = parts as [string, string];
  if (!/^\d+$/.test(toidPart) || !/^\d+$/.test(ordinalPart)) {
    throw new IndexerError('RPC_PROTOCOL', 'event id components are not numeric', { id });
  }

  const toid = BigInt(toidPart);
  return {
    ledgerSequence: Number(toid >> 32n),
    txIndex: Number((toid >> 20n) & TX_MASK),
    opIndex: Number(toid & OP_MASK),
    eventIndex: Number(ordinalPart),
  };
}

export function encodeToid(ledgerSequence: number, txIndex: number, opIndex: number): bigint {
  return (BigInt(ledgerSequence) << 32n) | (BigInt(txIndex) << 20n) | BigInt(opIndex);
}
