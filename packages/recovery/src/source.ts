import {
  CURSOR_MAX,
  CURSOR_MIN,
  RecoveryError,
  computeRangeDigest,
  type ConfidentialEvent,
  type RangeDigest,
} from '@stellar-confidential/core';

/**
 * Where replay gets its events.
 *
 * An event source is an archive provider. Nothing here trusts one: everything a
 * source returns is verified against a digest before it reaches a balance
 * (invariant 4). Keeping the interface this narrow is also what makes the
 * multi-provider work in Phase 3 a matter of adding an implementation rather
 * than changing the recovery engine.
 */

export interface AccountEventsRequest {
  readonly account: string;
  /** Exclusive lower bound — the client's current cursor. */
  readonly afterCursor?: string;
  readonly toCursor?: string;
  readonly limit: number;
}

export interface AccountEventsPage {
  readonly events: readonly ConfidentialEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface SourceStatus {
  /** The highest ledger this archive has ingested. */
  readonly latestLedger: number;
}

/**
 * A commitment request.
 *
 * The lower bound is exclusive, matching `AccountEventsRequest.afterCursor`, so
 * a client resuming from a cursor asks about exactly the events it does not yet
 * have. An inclusive bound would force the client to re-supply the boundary
 * event it already applied — impossible after a checkpoint restore, where the
 * event object is long gone and only its cursor survives.
 */
export interface DigestRequest {
  readonly account: string;
  /** Exclusive. Omit to start from the beginning of history. */
  readonly afterCursor?: string;
  /** Inclusive. */
  readonly toCursor: string;
}

export interface EventSource {
  /** Identifies the provider in errors and reports. */
  readonly id: string;
  fetchAccountEvents(request: AccountEventsRequest): Promise<AccountEventsPage>;
  fetchDigest(request: DigestRequest): Promise<RangeDigest>;
  status(): Promise<SourceStatus>;
}

/** An event source backed by an in-memory list. Used by tests and the demo. */
export class MemoryEventSource implements EventSource {
  readonly id: string;

  constructor(
    private readonly events: readonly ConfidentialEvent[],
    options: { id?: string; latestLedger?: number } = {},
  ) {
    this.id = options.id ?? 'memory';
    this.latestLedger =
      options.latestLedger ??
      events.reduce((max, event) => Math.max(max, event.proof.ledgerSequence), 0);
  }

  private readonly latestLedger: number;

  private forAccount(account: string): readonly ConfidentialEvent[] {
    return this.events
      .filter((event) => event.account === account)
      .sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
  }

  async fetchAccountEvents(request: AccountEventsRequest): Promise<AccountEventsPage> {
    const matched = this.forAccount(request.account).filter((event) => {
      if (request.afterCursor !== undefined && event.cursor <= request.afterCursor) return false;
      if (request.toCursor !== undefined && event.cursor > request.toCursor) return false;
      return true;
    });
    const page = matched.slice(0, request.limit);
    const hasMore = matched.length > request.limit;
    return {
      events: page,
      hasMore,
      nextCursor: page.length > 0 ? (page[page.length - 1] as ConfidentialEvent).cursor : null,
    };
  }

  async fetchDigest(request: DigestRequest): Promise<RangeDigest> {
    const lower = request.afterCursor ?? CURSOR_MIN;
    const scoped = this.forAccount(request.account).filter(
      (event) =>
        (request.afterCursor === undefined ? event.cursor >= lower : event.cursor > lower) &&
        event.cursor <= request.toCursor,
    );
    return computeRangeDigest(lower, request.toCursor, scoped);
  }

  async status(): Promise<SourceStatus> {
    return { latestLedger: this.latestLedger };
  }
}

/**
 * An event source that talks to an indexer's REST API.
 *
 * Deliberately built on plain fetch rather than a client library: this is the
 * shape a wallet on a phone uses, and it must work anywhere fetch does.
 */
export class HttpEventSource implements EventSource {
  readonly id: string;

  constructor(
    private readonly baseUrl: string,
    private readonly options: {
      id?: string;
      fetchImpl?: typeof fetch;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ) {
    this.id = options.id ?? baseUrl;
  }

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', ...this.options.headers },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RecoveryError('SOURCE_UNAVAILABLE', `archive returned HTTP ${response.status}`, {
          source: this.id,
          status: response.status,
          path,
        });
      }
      return (await response.json()) as T;
    } catch (cause) {
      if (cause instanceof RecoveryError) throw cause;
      throw new RecoveryError('SOURCE_UNAVAILABLE', 'archive request failed', {
        source: this.id,
        path,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchAccountEvents(request: AccountEventsRequest): Promise<AccountEventsPage> {
    return this.get<AccountEventsPage>(`accounts/${encodeURIComponent(request.account)}/events`, {
      after: request.afterCursor,
      to: request.toCursor,
      limit: String(request.limit),
    });
  }

  async fetchDigest(request: DigestRequest): Promise<RangeDigest> {
    return this.get<RangeDigest>(`accounts/${encodeURIComponent(request.account)}/digest`, {
      after: request.afterCursor,
      to: request.toCursor,
    });
  }

  async status(): Promise<SourceStatus> {
    const health = await this.get<{ latestLedger: number }>('health', {});
    return { latestLedger: health.latestLedger };
  }
}

export const FULL_RANGE = { from: CURSOR_MIN, to: CURSOR_MAX } as const;
