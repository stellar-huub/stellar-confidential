import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes, concatBytes } from '@noble/hashes/utils.js';
import type { ConfidentialEvent } from './events.js';
import { canonicalJson } from './json.js';
import type { JsonValue } from './json.js';

/**
 * Integrity digests (milestone M1.5).
 *
 * An archive provider is not trusted (invariant 4). A client must be able to
 * detect an omitted, reordered or altered event without re-downloading the whole
 * chain. So the indexer publishes a Merkle root over a cursor range, and the
 * client recomputes it from the events it received.
 *
 * What the digest binds:
 *   - every field replay depends on (type, account, delta, amounts)
 *   - full chain provenance (ledger, hash, close time, tx, indices)
 *
 * What it deliberately does not bind:
 *   - `raw`, which is adapter-specific and may legitimately differ in encoding
 *     between two providers holding the same logical event.
 *
 * Domain separation: leaves are hashed with a 0x00 prefix and interior nodes
 * with 0x01, so no leaf can be reinterpreted as an interior node.
 */

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

/** The exact bytes a digest is computed over. Stable across versions of this package. */
export function canonicalEventBytes(event: ConfidentialEvent): Uint8Array {
  const canonical: JsonValue = {
    cursor: event.cursor,
    type: event.type,
    contractId: event.contractId,
    account: event.account,
    counterparty: event.counterparty,
    delta: event.delta,
    publicAmount: event.publicAmount,
    amount: event.amount
      ? { limbs: event.amount.limbs.map((l) => ({ commitment: l.commitment, handle: l.handle })) }
      : null,
    proof: {
      ledgerSequence: event.proof.ledgerSequence,
      ledgerHash: event.proof.ledgerHash,
      ledgerCloseTime: event.proof.ledgerCloseTime,
      txHash: event.proof.txHash,
      txIndex: event.proof.txIndex,
      opIndex: event.proof.opIndex,
      eventIndex: event.proof.eventIndex,
    },
  };
  return utf8ToBytes(canonicalJson(canonical));
}

export function eventLeafHash(event: ConfidentialEvent): Uint8Array {
  return sha256(concatBytes(LEAF_PREFIX, canonicalEventBytes(event)));
}

/**
 * Merkle root over events in cursor order.
 *
 * An odd node is promoted unchanged rather than duplicated: duplicating the last
 * leaf lets an attacker append a repeat of it without changing the root (the
 * CVE-2012-2459 shape). Promotion has no such ambiguity.
 *
 * The empty range hashes to SHA-256 of the empty string, so "no events" is still
 * a committed, comparable value rather than a special case callers must handle.
 */
export function merkleRoot(events: readonly ConfidentialEvent[]): string {
  if (events.length === 0) return bytesToHex(sha256(new Uint8Array(0)));
  let level = events.map(eventLeafHash);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Uint8Array;
      const right = level[i + 1];
      next.push(right === undefined ? left : sha256(concatBytes(NODE_PREFIX, left, right)));
    }
    level = next;
  }
  return bytesToHex(level[0] as Uint8Array);
}

export interface RangeDigest {
  readonly fromCursor: string;
  readonly toCursor: string;
  readonly eventCount: number;
  readonly merkleRoot: string;
  /** Cursor of the last event actually included, or null for an empty range. */
  readonly lastCursor: string | null;
}

export function computeRangeDigest(
  fromCursor: string,
  toCursor: string,
  events: readonly ConfidentialEvent[],
): RangeDigest {
  return {
    fromCursor,
    toCursor,
    eventCount: events.length,
    merkleRoot: merkleRoot(events),
    lastCursor: events.length > 0 ? (events[events.length - 1] as ConfidentialEvent).cursor : null,
  };
}

export type DigestMismatch =
  | { readonly kind: 'count'; readonly expected: number; readonly actual: number }
  | { readonly kind: 'root'; readonly expected: string; readonly actual: string }
  | { readonly kind: 'ordering'; readonly atIndex: number; readonly cursor: string }
  | { readonly kind: 'duplicate'; readonly atIndex: number; readonly cursor: string }
  | { readonly kind: 'range'; readonly atIndex: number; readonly cursor: string };

/**
 * Verify a set of events against a digest published by a provider.
 *
 * Returns every mismatch found rather than the first, so a caller reporting a
 * misbehaving provider can say what was wrong, not just that something was.
 */
export function verifyAgainstDigest(
  events: readonly ConfidentialEvent[],
  digest: RangeDigest,
): readonly DigestMismatch[] {
  const problems: DigestMismatch[] = [];

  let previous: string | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const cursor = (events[i] as ConfidentialEvent).cursor;
    if (cursor < digest.fromCursor || cursor > digest.toCursor) {
      problems.push({ kind: 'range', atIndex: i, cursor });
    }
    if (previous !== null) {
      if (cursor === previous) problems.push({ kind: 'duplicate', atIndex: i, cursor });
      else if (cursor < previous) problems.push({ kind: 'ordering', atIndex: i, cursor });
    }
    previous = cursor;
  }

  if (events.length !== digest.eventCount) {
    problems.push({ kind: 'count', expected: digest.eventCount, actual: events.length });
  }

  const actualRoot = merkleRoot(events);
  if (actualRoot !== digest.merkleRoot) {
    problems.push({ kind: 'root', expected: digest.merkleRoot, actual: actualRoot });
  }

  return problems;
}
