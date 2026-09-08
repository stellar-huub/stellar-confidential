import {
  CURSOR_MAX,
  CURSOR_MIN,
  type ConfidentialEvent,
  type RangeDigest,
} from '@stellar-confidential/core';
import type { EventStore, IntegrityService } from '@stellar-confidential/indexer';
import type {
  AccountEventsPage,
  AccountEventsRequest,
  DigestRequest,
  EventSource,
  SourceStatus,
} from '@stellar-confidential/recovery';

/**
 * An event source backed directly by an indexer's store.
 *
 * Used when recovery runs in the same process as the archive — the reference
 * demo, the end-to-end tests, and any deployment that colocates them. It skips
 * the HTTP hop without skipping any of the verification: the digests it returns
 * are computed the same way, and the client still checks them.
 *
 * It lives here rather than in @stellar-confidential/recovery so that the
 * recovery package stays free of a dependency on the indexer, and therefore
 * usable in a browser or on a phone.
 */
export class StoreEventSource implements EventSource {
  readonly id: string;

  constructor(
    private readonly store: EventStore,
    private readonly integrity: IntegrityService,
    options: { id?: string } = {},
  ) {
    this.id = options.id ?? 'local-store';
  }

  async fetchAccountEvents(request: AccountEventsRequest): Promise<AccountEventsPage> {
    const page = await this.store.getEvents({
      account: request.account,
      afterCursor: request.afterCursor ?? CURSOR_MIN,
      toCursor: request.toCursor ?? CURSOR_MAX,
      limit: request.limit,
    });
    return {
      events: page.events as readonly ConfidentialEvent[],
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async fetchDigest(request: DigestRequest): Promise<RangeDigest> {
    return this.integrity.digest({
      account: request.account,
      ...(request.afterCursor === undefined ? {} : { afterCursor: request.afterCursor }),
      toCursor: request.toCursor,
    });
  }

  async status(): Promise<SourceStatus> {
    const latest = await this.store.getLatestLedger();
    return { latestLedger: latest?.sequence ?? 0 };
  }
}
