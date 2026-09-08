import type { JsonValue } from './json.js';
import type { EventPosition } from './cursor.js';

/**
 * The canonical confidential event model.
 *
 * WORKING SPEC — see docs/events.md. The shape below is what the rest of this
 * project replays, stores and verifies. Mapping a specific Confidential Token
 * contract's on-chain events onto it is the job of a ContractAdapter, so that
 * contract revisions do not reach the pipeline, the storage schema or the
 * recovery engine.
 */

export const CONFIDENTIAL_EVENT_TYPES = [
  'deposit',
  'withdraw',
  'transfer',
  'rollover',
  'key_rotation',
  'disclosure',
] as const;

export type ConfidentialEventType = (typeof CONFIDENTIAL_EVENT_TYPES)[number];

/**
 * How the event moves the subject account's confidential balance.
 *
 * `replace` is used by rollover and key rotation, which do not change the value
 * of a balance but do change its ciphertext representation. Replay must assign
 * rather than accumulate for those, or the balance doubles.
 */
export type BalanceDelta = 'credit' | 'debit' | 'replace' | 'none';

/**
 * One limb of an encrypted amount: a twisted ElGamal ciphertext pair, both
 * points hex-encoded in compressed form.
 *
 * Amounts are carried limb-wise rather than as a single ciphertext because
 * decryption is a discrete-log search — narrow limbs keep that search cheap
 * enough to run per event on a phone. See @stellar-confidential/crypto.
 */
export interface EncryptedLimb {
  readonly commitment: string;
  readonly handle: string;
}

export interface EncryptedAmount {
  readonly limbs: readonly EncryptedLimb[];
}

/** Chain provenance for a single event. Every stored event carries this (M1.5). */
export interface LedgerProof {
  readonly ledgerSequence: number;
  readonly ledgerHash: string;
  readonly ledgerCloseTime: number;
  readonly txHash: string;
  readonly txIndex: number;
  readonly opIndex: number;
  readonly eventIndex: number;
}

export interface ConfidentialEvent {
  /** Equal to the cursor. Stable across re-ingestion — this is what makes ingest idempotent. */
  readonly id: string;
  readonly cursor: string;
  readonly type: ConfidentialEventType;
  readonly contractId: string;
  /** The account whose confidential state this event mutates. */
  readonly account: string;
  /** The other party, when there is one. */
  readonly counterparty: string | null;
  readonly delta: BalanceDelta;
  /** Encrypted to `account`'s viewing key. Null when the event carries no amount. */
  readonly amount: EncryptedAmount | null;
  /**
   * The public leg of a deposit or withdrawal, in stroops, as a decimal string.
   * Null for transfers — a transfer has no public amount, that is the point.
   */
  readonly publicAmount: string | null;
  readonly proof: LedgerProof;
  /** Adapter-preserved original payload. Never interpreted by the pipeline. */
  readonly raw: JsonValue;
}

export function positionOf(event: ConfidentialEvent): EventPosition {
  const { ledgerSequence, txIndex, opIndex, eventIndex } = event.proof;
  return { ledgerSequence, txIndex, opIndex, eventIndex };
}

export function isConfidentialEventType(value: string): value is ConfidentialEventType {
  return (CONFIDENTIAL_EVENT_TYPES as readonly string[]).includes(value);
}
