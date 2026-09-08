import type { ConfidentialEvent, ConfidentialEventType } from '@stellar-confidential/core';

/**
 * Storage contract.
 *
 * Two implementations exist: PostgreSQL for real deployments, and an in-memory
 * store used by tests and by the reference demo. They are held to the same
 * conformance suite (test/store-conformance.ts) so the pipeline behaves
 * identically on either — which is what lets almost every test run without a
 * database while still exercising the real code paths.
 */

export interface LedgerRecord {
  readonly sequence: number;
  readonly hash: string;
  readonly previousHash: string;
  readonly closeTime: number;
  readonly eventCount: number;
}

export interface IngestCheckpoint {
  readonly name: string;
  readonly cursor: string;
  readonly ledgerSequence: number;
  readonly updatedAt: string;
}

/**
 * One atomically applied unit of ingestion.
 *
 * Ledgers, their events and the advanced checkpoint commit together or not at
 * all. That is the whole basis of crash safety (invariant 6): a process killed
 * mid-batch either applied the batch or did not, and on restart the checkpoint
 * describes exactly what is durable.
 */
export interface IngestBatch {
  readonly ledgers: readonly LedgerRecord[];
  readonly events: readonly ConfidentialEvent[];
  readonly checkpoint: { readonly name: string; readonly cursor: string; readonly ledgerSequence: number };
}

export interface AppendResult {
  readonly eventsInserted: number;
  /** Events already present, skipped. Non-zero after a replay — this is normal. */
  readonly eventsSkipped: number;
  readonly ledgersInserted: number;
}

export interface EventQuery {
  readonly account?: string;
  readonly contractId?: string;
  readonly types?: readonly ConfidentialEventType[];
  /** Inclusive lower bound. */
  readonly fromCursor?: string;
  /** Exclusive lower bound. Takes precedence over fromCursor; this is what pagination uses. */
  readonly afterCursor?: string;
  /** Inclusive upper bound. */
  readonly toCursor?: string;
  readonly limit: number;
}

export interface EventPage {
  readonly events: readonly ConfidentialEvent[];
  /** Pass back as `afterCursor` to continue. Null when the page is the last one. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface AccountSummary {
  readonly account: string;
  readonly eventCount: number;
  readonly firstCursor: string | null;
  readonly lastCursor: string | null;
  readonly lastLedgerSequence: number | null;
}

export interface EventStore {
  /** Idempotent. Safe to call on every start. */
  migrate(): Promise<void>;
  append(batch: IngestBatch): Promise<AppendResult>;
  getEvents(query: EventQuery): Promise<EventPage>;
  /** Every event in the range, in cursor order. Used for digests and replay. */
  streamRange(
    fromCursor: string,
    toCursor: string,
    filter?: { account?: string; contractId?: string },
  ): AsyncIterable<ConfidentialEvent>;
  countEvents(query: Omit<EventQuery, 'limit'>): Promise<number>;
  getLedger(sequence: number): Promise<LedgerRecord | null>;
  getLatestLedger(): Promise<LedgerRecord | null>;
  /**
   * Delete every ledger and event above `sequence`. Returns events removed.
   *
   * Also clamps any checkpoint that sits above `sequence` back down to it. A
   * checkpoint pointing at deleted ledgers would make the next ingest resume
   * past a hole and silently produce an incomplete history, so the two must move
   * together atomically.
   */
  rollbackTo(sequence: number): Promise<number>;
  getCheckpoint(name: string): Promise<IngestCheckpoint | null>;
  getAccountSummary(account: string): Promise<AccountSummary>;
  /** Delete events and ledgers strictly below `sequence`. Returns events removed. */
  prune(sequence: number): Promise<number>;
  close(): Promise<void>;
}
