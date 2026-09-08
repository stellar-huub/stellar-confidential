import type { ConfidentialEvent } from './events.js';
import type { JsonValue } from './json.js';

/**
 * Contract adapters (milestone M1.1).
 *
 * The Confidential Token contract's on-chain event surface is the one part of
 * this system we do not control and cannot pin down without the canonical
 * contract. Rather than let that uncertainty leak into the ingestion pipeline,
 * the storage schema and the recovery engine, it is confined here.
 *
 * Everything downstream of `decode` speaks ConfidentialEvent only. Supporting a
 * new contract revision, or a second contract entirely, means writing an adapter
 * and nothing else.
 */

/** A contract event as the Stellar RPC returns it, before interpretation. */
export interface RawContractEvent {
  readonly ledgerSequence: number;
  readonly ledgerHash: string;
  readonly ledgerCloseTime: number;
  readonly txHash: string;
  readonly txIndex: number;
  readonly opIndex: number;
  readonly eventIndex: number;
  readonly contractId: string;
  /** XDR-decoded topic values, adapter-defined. */
  readonly topics: readonly JsonValue[];
  /** XDR-decoded event body. */
  readonly value: JsonValue;
}

export interface ContractAdapter {
  /** Stable identifier recorded alongside every event this adapter produced. */
  readonly id: string;
  /** Bumped when decoding changes in a way that alters output for the same input. */
  readonly version: string;

  /** Cheap pre-filter. Events that are not recognised are skipped, not an error. */
  recognises(raw: RawContractEvent): boolean;

  /**
   * Decode one raw event into zero or more canonical events.
   *
   * Fan-out is expected: a transfer produces one event for the sender and one
   * for the recipient, so each party can replay their own history without
   * needing to interpret the other's.
   *
   * Must be pure and deterministic — the same raw event always decodes to the
   * same output, because re-ingestion depends on it (invariant 6).
   */
  decode(raw: RawContractEvent): readonly ConfidentialEvent[];
}
