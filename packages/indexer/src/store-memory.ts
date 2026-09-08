import type { ConfidentialEvent } from '@stellar-confidential/core';
import { CURSOR_MAX, CURSOR_MIN, ledgerUpperBound } from '@stellar-confidential/core';
import type {
  AccountSummary,
  AppendResult,
  EventPage,
  EventQuery,
  EventStore,
  IngestBatch,
  IngestCheckpoint,
  LedgerRecord,
} from './store.js';

/**
 * In-memory event store.
 *
 * Not a toy: it implements the same contract as the PostgreSQL store and passes
 * the same conformance suite, so the pipeline, the API and the recovery engine
 * can all be tested end to end without a database. It is also what the reference
 * demo runs on.
 */
export class MemoryEventStore implements EventStore {
  private events = new Map<string, ConfidentialEvent>();
  private ledgers = new Map<number, LedgerRecord>();
  private checkpoints = new Map<string, IngestCheckpoint>();
  private orderedCache: ConfidentialEvent[] | null = null;

  async migrate(): Promise<void> {
    // Nothing to migrate; present so callers need not special-case this store.
  }

  private ordered(): ConfidentialEvent[] {
    if (this.orderedCache === null) {
      this.orderedCache = [...this.events.values()].sort((a, b) =>
        a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0,
      );
    }
    return this.orderedCache;
  }

  private invalidate(): void {
    this.orderedCache = null;
  }

  async append(batch: IngestBatch): Promise<AppendResult> {
    let eventsInserted = 0;
    let eventsSkipped = 0;
    let ledgersInserted = 0;

    for (const ledger of batch.ledgers) {
      if (!this.ledgers.has(ledger.sequence)) ledgersInserted += 1;
      this.ledgers.set(ledger.sequence, ledger);
    }
    for (const event of batch.events) {
      // Keyed by cursor: re-ingesting a ledger overwrites nothing and adds nothing.
      if (this.events.has(event.cursor)) eventsSkipped += 1;
      else {
        this.events.set(event.cursor, event);
        eventsInserted += 1;
      }
    }
    this.checkpoints.set(batch.checkpoint.name, {
      ...batch.checkpoint,
      updatedAt: new Date().toISOString(),
    });
    this.invalidate();
    return { eventsInserted, eventsSkipped, ledgersInserted };
  }

  private matches(event: ConfidentialEvent, query: Omit<EventQuery, 'limit'>): boolean {
    if (query.account !== undefined && event.account !== query.account) return false;
    if (query.contractId !== undefined && event.contractId !== query.contractId) return false;
    if (query.types !== undefined && !query.types.includes(event.type)) return false;
    if (query.afterCursor !== undefined) {
      if (event.cursor <= query.afterCursor) return false;
    } else if (query.fromCursor !== undefined && event.cursor < query.fromCursor) return false;
    if (query.toCursor !== undefined && event.cursor > query.toCursor) return false;
    return true;
  }

  async getEvents(query: EventQuery): Promise<EventPage> {
    const matched = this.ordered().filter((event) => this.matches(event, query));
    const page = matched.slice(0, query.limit);
    const hasMore = matched.length > query.limit;
    return {
      events: page,
      hasMore,
      nextCursor:
        hasMore && page.length > 0 ? (page[page.length - 1] as ConfidentialEvent).cursor : null,
    };
  }

  async *streamRange(
    fromCursor: string,
    toCursor: string,
    filter: { account?: string; contractId?: string } = {},
  ): AsyncIterable<ConfidentialEvent> {
    for (const event of this.ordered()) {
      if (event.cursor < fromCursor || event.cursor > toCursor) continue;
      if (filter.account !== undefined && event.account !== filter.account) continue;
      if (filter.contractId !== undefined && event.contractId !== filter.contractId) continue;
      yield event;
    }
  }

  async countEvents(query: Omit<EventQuery, 'limit'>): Promise<number> {
    return this.ordered().filter((event) => this.matches(event, query)).length;
  }

  async getLedger(sequence: number): Promise<LedgerRecord | null> {
    return this.ledgers.get(sequence) ?? null;
  }

  async getLatestLedger(): Promise<LedgerRecord | null> {
    let latest: LedgerRecord | null = null;
    for (const ledger of this.ledgers.values()) {
      if (latest === null || ledger.sequence > latest.sequence) latest = ledger;
    }
    return latest;
  }

  async rollbackTo(sequence: number): Promise<number> {
    let removed = 0;
    for (const [cursor, event] of this.events) {
      if (event.proof.ledgerSequence > sequence) {
        this.events.delete(cursor);
        removed += 1;
      }
    }
    for (const key of [...this.ledgers.keys()]) {
      if (key > sequence) this.ledgers.delete(key);
    }
    // Never leave a checkpoint pointing above the history that survives.
    for (const [name, checkpoint] of this.checkpoints) {
      if (checkpoint.ledgerSequence > sequence) {
        this.checkpoints.set(name, {
          ...checkpoint,
          cursor: ledgerUpperBound(sequence),
          ledgerSequence: sequence,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    this.invalidate();
    return removed;
  }

  async getCheckpoint(name: string): Promise<IngestCheckpoint | null> {
    return this.checkpoints.get(name) ?? null;
  }

  async getAccountSummary(account: string): Promise<AccountSummary> {
    const events = this.ordered().filter((event) => event.account === account);
    const first = events[0] ?? null;
    const last = events[events.length - 1] ?? null;
    return {
      account,
      eventCount: events.length,
      firstCursor: first?.cursor ?? null,
      lastCursor: last?.cursor ?? null,
      lastLedgerSequence: last?.proof.ledgerSequence ?? null,
    };
  }

  async prune(sequence: number): Promise<number> {
    let removed = 0;
    for (const [cursor, event] of this.events) {
      if (event.proof.ledgerSequence < sequence) {
        this.events.delete(cursor);
        removed += 1;
      }
    }
    for (const key of [...this.ledgers.keys()]) {
      if (key < sequence) this.ledgers.delete(key);
    }
    this.invalidate();
    return removed;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  /** Test helper: everything held, in cursor order. */
  snapshot(): readonly ConfidentialEvent[] {
    return [...this.ordered()];
  }

  static readonly FULL_RANGE = { from: CURSOR_MIN, to: CURSOR_MAX };
}
