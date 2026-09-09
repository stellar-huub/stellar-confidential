import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndexerError } from '@stellar-confidential/core';
import {
  parseLedgerHeaderHistoryEntryPrefix,
  parseLedgerHeaderPrefix,
} from '../src/ledger-header.js';

function bareHeader(protocolVersion: number, previousHash: string, trailing = 64): string {
  const bytes = Buffer.alloc(36 + trailing);
  bytes.writeUInt32BE(protocolVersion, 0);
  Buffer.from(previousHash, 'hex').copy(bytes, 4);
  return bytes.toString('base64');
}

function historyEntry(
  hash: string,
  protocolVersion: number,
  previousHash: string,
  trailing = 64,
): string {
  const bytes = Buffer.alloc(68 + trailing);
  Buffer.from(hash, 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(protocolVersion, 32);
  Buffer.from(previousHash, 'hex').copy(bytes, 36);
  return bytes.toString('base64');
}

describe('bare LedgerHeader (getLatestLedger)', () => {
  it('reads the protocol version and previous hash', () => {
    const previous = 'ab'.repeat(32);
    const parsed = parseLedgerHeaderPrefix(bareHeader(28, previous));
    assert.equal(parsed.protocolVersion, 28);
    assert.equal(parsed.previousLedgerHash, previous);
  });

  it('rejects a header shorter than its fixed prefix', () => {
    assert.throws(() => parseLedgerHeaderPrefix(Buffer.alloc(20).toString('base64')), IndexerError);
  });
});

describe('LedgerHeaderHistoryEntry (getLedgers)', () => {
  it('reads the embedded hash, version and previous hash', () => {
    const hash = '11'.repeat(32);
    const previous = '22'.repeat(32);
    const parsed = parseLedgerHeaderHistoryEntryPrefix(historyEntry(hash, 28, previous));
    assert.equal(parsed.hash, hash);
    assert.equal(parsed.protocolVersion, 28);
    assert.equal(parsed.previousLedgerHash, previous);
  });

  it('is not interchangeable with the bare header parser', () => {
    // Reading the wrong envelope must produce visibly wrong values, never a
    // plausible one — this is the mistake that would silently break reorg
    // detection, so it is pinned by a test.
    const entry = historyEntry('11'.repeat(32), 28, '22'.repeat(32));
    const misread = parseLedgerHeaderPrefix(entry);
    assert.notEqual(misread.previousLedgerHash, '22'.repeat(32));
    assert.notEqual(misread.protocolVersion, 28);
  });

  it('rejects a truncated entry', () => {
    assert.throws(
      () => parseLedgerHeaderHistoryEntryPrefix(Buffer.alloc(40).toString('base64')),
      IndexerError,
    );
  });
});
