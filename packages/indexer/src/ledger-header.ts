import { IndexerError } from '@stellar-confidential/core';

/**
 * Minimal ledger header XDR parsing.
 *
 * Reorg detection rests entirely on reading a ledger's parent hash, so this
 * needs to be exactly right. Stellar RPC hands that field back inside two
 * different envelopes depending on the method:
 *
 *   getLatestLedger → LedgerHeader
 *       bytes  0..3   uint32 ledgerVersion
 *       bytes  4..35  Hash   previousLedgerHash
 *
 *   getLedgers      → LedgerHeaderHistoryEntry
 *       bytes  0..31  Hash   hash               (this ledger's own hash)
 *       bytes 32..35  uint32 ledgerVersion
 *       bytes 36..67  Hash   previousLedgerHash
 *
 * Both are parsed explicitly rather than sniffed. Reading the wrong envelope
 * yields a previousLedgerHash that never matches anything, which would silently
 * disable reorg detection instead of failing — so the entry parser also returns
 * the embedded hash, and the RPC client checks it against the hash the node
 * reported alongside it.
 *
 * Only these fixed-offset prefixes are read. Anything deeper in the header
 * belongs to an adapter, not here, and would need a real XDR codec.
 */

export interface LedgerHeaderPrefix {
  readonly protocolVersion: number;
  readonly previousLedgerHash: string;
}

export interface LedgerHeaderHistoryEntryPrefix extends LedgerHeaderPrefix {
  /** The ledger's own hash, as committed in the history entry. */
  readonly hash: string;
}

const HEADER_PREFIX_BYTES = 36;
const HISTORY_ENTRY_PREFIX_BYTES = 68;

function decode(base64: string, required: number): Buffer {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw new IndexerError('RPC_PROTOCOL', 'ledger header is not valid base64');
  }
  if (bytes.length < required) {
    throw new IndexerError('RPC_PROTOCOL', 'ledger header shorter than its fixed prefix', {
      length: bytes.length,
      required,
    });
  }
  return bytes;
}

/** For the bare LedgerHeader returned by getLatestLedger. */
export function parseLedgerHeaderPrefix(headerXdrBase64: string): LedgerHeaderPrefix {
  const bytes = decode(headerXdrBase64, HEADER_PREFIX_BYTES);
  return {
    protocolVersion: bytes.readUInt32BE(0),
    previousLedgerHash: bytes.subarray(4, 36).toString('hex'),
  };
}

/** For the LedgerHeaderHistoryEntry returned by getLedgers. */
export function parseLedgerHeaderHistoryEntryPrefix(
  headerXdrBase64: string,
): LedgerHeaderHistoryEntryPrefix {
  const bytes = decode(headerXdrBase64, HISTORY_ENTRY_PREFIX_BYTES);
  return {
    hash: bytes.subarray(0, 32).toString('hex'),
    protocolVersion: bytes.readUInt32BE(32),
    previousLedgerHash: bytes.subarray(36, 68).toString('hex'),
  };
}
