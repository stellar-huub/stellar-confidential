import { IndexerError, silentLogger, type JsonValue, type Logger } from '@stellar-confidential/core';
import {
  parseLedgerHeaderHistoryEntryPrefix,
  parseLedgerHeaderPrefix,
} from './ledger-header.js';

/**
 * Stellar RPC client.
 *
 * Deliberately narrow: this speaks only the four methods ingestion needs, and
 * returns plain shapes rather than SDK objects, so the pipeline never handles a
 * raw JSON-RPC envelope and never depends on an SDK release cadence.
 *
 * Everything unreliable about talking to a node lives here — retries, backoff,
 * rate limiting, and turning transport failures into typed errors.
 */

export interface RpcLedger {
  readonly sequence: number;
  readonly hash: string;
  readonly previousHash: string;
  readonly closeTime: number;
  readonly protocolVersion: number;
}

export interface RpcEvent {
  readonly id: string;
  readonly type: string;
  readonly ledger: number;
  readonly ledgerClosedAt: string;
  readonly contractId: string;
  readonly txHash: string;
  readonly topic: readonly string[];
  readonly value: string;
  readonly inSuccessfulContractCall: boolean;
}

export interface EventsPage {
  readonly events: readonly RpcEvent[];
  readonly latestLedger: number;
  readonly oldestLedger: number;
  readonly cursor: string | null;
}

export interface LedgerRange {
  readonly latestLedger: number;
  readonly oldestLedger: number;
}

/**
 * The RPC surface ingestion depends on.
 *
 * Declared separately from the concrete client so the pipeline can be driven by
 * a synthetic chain in tests — including reorg scenarios, which are impossible
 * to produce on demand against a real node.
 */
export interface StellarRpcLike {
  getLedgerRange(): Promise<LedgerRange>;
  getLedgers(startLedger: number, limit: number): Promise<readonly RpcLedger[]>;
  getEvents(request: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
    limit: number;
    contractIds?: readonly string[];
  }): Promise<EventsPage>;
}

export interface StellarRpcOptions {
  readonly url: string;
  readonly logger?: Logger;
  /** Attempts per call, including the first. */
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly requestTimeoutMs?: number;
  /** 0 disables client-side rate limiting. */
  readonly maxRequestsPerSecond?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IndexerError('RPC_PROTOCOL', `expected an object for ${context}`, { context });
  }
  return value as Record<string, unknown>;
}

/** RPC returns some numbers as strings; accept either rather than guessing. */
function asNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new IndexerError('RPC_PROTOCOL', `field ${field} is not a number`, { field });
  }
  return parsed;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new IndexerError('RPC_PROTOCOL', `field ${field} is not a string`, { field });
  }
  return value;
}

export class StellarRpc implements StellarRpcLike {
  private readonly url: string;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  private nextSlotAt = 0;
  private requestId = 0;

  constructor(options: StellarRpcOptions) {
    this.url = options.url;
    this.logger = (options.logger ?? silentLogger).child({ component: 'rpc' });
    this.maxAttempts = options.maxAttempts ?? 5;
    this.initialBackoffMs = options.initialBackoffMs ?? 250;
    this.maxBackoffMs = options.maxBackoffMs ?? 10_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    const rps = options.maxRequestsPerSecond ?? 25;
    this.minIntervalMs = rps > 0 ? 1000 / rps : 0;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /** Space requests out so a backfill cannot hammer a shared public node. */
  private async throttle(): Promise<void> {
    if (this.minIntervalMs === 0) return;
    const now = Date.now();
    const waitFor = this.nextSlotAt - now;
    if (waitFor > 0) await this.sleepImpl(waitFor);
    this.nextSlotAt = Math.max(now, this.nextSlotAt) + this.minIntervalMs;
  }

  private async call(method: string, params: JsonValue): Promise<unknown> {
    let attempt = 0;
    let backoff = this.initialBackoffMs;
    let lastError: IndexerError | null = null;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      await this.throttle();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      this.requestId += 1;

      try {
        const response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: this.requestId, method, params }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryable = RETRYABLE_HTTP.has(response.status);
          lastError = new IndexerError('RPC_UNAVAILABLE', `RPC returned HTTP ${response.status}`, {
            method,
            status: response.status,
            attempt,
          });
          if (!retryable) throw lastError;
        } else {
          const body = (await response.json()) as JsonRpcResponse;
          if (body.error) {
            // A JSON-RPC error is the node answering, not failing. Retrying will
            // produce the same answer, so surface it immediately.
            throw new IndexerError('RPC_PROTOCOL', body.error.message ?? 'RPC error', {
              method,
              code: body.error.code ?? null,
            });
          }
          return body.result;
        }
      } catch (cause) {
        if (cause instanceof IndexerError && cause.code === 'RPC_PROTOCOL') throw cause;
        if (cause instanceof IndexerError && !RETRYABLE_HTTP.has(Number(cause.context['status']))) {
          throw cause;
        }
        lastError =
          cause instanceof IndexerError
            ? cause
            : new IndexerError('RPC_UNAVAILABLE', 'RPC request failed', {
                method,
                attempt,
                reason: cause instanceof Error ? cause.message : String(cause),
              });
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxAttempts) {
        // Full jitter: retries from many workers must not re-converge on the
        // same instant and re-create the spike that caused the failure.
        const delay = Math.floor(Math.random() * Math.min(backoff, this.maxBackoffMs));
        this.logger.warn('rpc retry', { method, attempt, delay });
        await this.sleepImpl(delay);
        backoff = Math.min(backoff * 2, this.maxBackoffMs);
      }
    }

    throw lastError ?? new IndexerError('RPC_UNAVAILABLE', 'RPC exhausted retries', { method });
  }

  async getHealth(): Promise<{ status: string; latestLedger: number; oldestLedger: number }> {
    const result = asRecord(await this.call('getHealth', {}), 'getHealth');
    return {
      status: asString(result['status'], 'status'),
      latestLedger: asNumber(result['latestLedger'], 'latestLedger'),
      oldestLedger: asNumber(result['oldestLedger'], 'oldestLedger'),
    };
  }

  async getLatestLedger(): Promise<{
    sequence: number;
    hash: string;
    protocolVersion: number;
    previousHash: string | null;
  }> {
    const result = asRecord(await this.call('getLatestLedger', {}), 'getLatestLedger');
    const headerXdr = result['headerXdr'];
    // getLatestLedger returns a bare LedgerHeader, unlike getLedgers.
    const header =
      typeof headerXdr === 'string' ? parseLedgerHeaderPrefix(headerXdr) : null;
    return {
      sequence: asNumber(result['sequence'], 'sequence'),
      hash: asString(result['id'], 'id'),
      protocolVersion: asNumber(result['protocolVersion'], 'protocolVersion'),
      previousHash: header?.previousLedgerHash ?? null,
    };
  }

  /** Ledger headers for [startLedger, startLedger + limit). */
  async getLedgers(startLedger: number, limit: number): Promise<readonly RpcLedger[]> {
    const result = asRecord(
      await this.call('getLedgers', { startLedger, pagination: { limit } }),
      'getLedgers',
    );
    const ledgers = result['ledgers'];
    if (!Array.isArray(ledgers)) {
      throw new IndexerError('RPC_PROTOCOL', 'getLedgers did not return a ledger array');
    }
    return ledgers.map((entry) => {
      const ledger = asRecord(entry, 'ledger');
      const hash = asString(ledger['hash'], 'hash');
      const prefix = parseLedgerHeaderHistoryEntryPrefix(
        asString(ledger['headerXdr'], 'headerXdr'),
      );

      // Self-check: the entry commits to its own hash, and the node reports the
      // same hash beside it. If these ever disagree, the envelope layout has
      // changed and every previousHash we derive is garbage — which would
      // disable reorg detection silently. Fail loudly instead.
      if (prefix.hash !== hash) {
        throw new IndexerError(
          'RPC_PROTOCOL',
          'ledger header does not commit to the reported ledger hash',
          { sequence: asNumber(ledger['sequence'], 'sequence'), reported: hash, embedded: prefix.hash },
        );
      }

      return {
        sequence: asNumber(ledger['sequence'], 'sequence'),
        hash,
        previousHash: prefix.previousLedgerHash,
        closeTime: asNumber(ledger['ledgerCloseTime'], 'ledgerCloseTime'),
        protocolVersion: prefix.protocolVersion,
      };
    });
  }

  async getEvents(request: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
    limit: number;
    contractIds?: readonly string[];
  }): Promise<EventsPage> {
    const filter: Record<string, JsonValue> = { type: 'contract' };
    if (request.contractIds && request.contractIds.length > 0) {
      filter['contractIds'] = [...request.contractIds];
    }

    const pagination: Record<string, JsonValue> = { limit: request.limit };
    const params: Record<string, JsonValue> = { filters: [filter], pagination };
    // startLedger and cursor are mutually exclusive in the RPC API.
    if (request.cursor) pagination['cursor'] = request.cursor;
    else if (request.startLedger !== undefined) params['startLedger'] = request.startLedger;
    if (request.endLedger !== undefined) params['endLedger'] = request.endLedger;

    const result = asRecord(await this.call('getEvents', params), 'getEvents');
    const rawEvents = result['events'];
    if (!Array.isArray(rawEvents)) {
      throw new IndexerError('RPC_PROTOCOL', 'getEvents did not return an event array');
    }

    const events = rawEvents.map((entry): RpcEvent => {
      const event = asRecord(entry, 'event');
      const topic = event['topic'];
      const value = event['value'];
      return {
        id: asString(event['id'], 'id'),
        type: asString(event['type'], 'type'),
        ledger: asNumber(event['ledger'], 'ledger'),
        ledgerClosedAt: asString(event['ledgerClosedAt'], 'ledgerClosedAt'),
        contractId: asString(event['contractId'], 'contractId'),
        txHash: typeof event['txHash'] === 'string' ? event['txHash'] : '',
        topic: Array.isArray(topic) ? topic.map((t) => asString(t, 'topic entry')) : [],
        // Older RPC releases wrapped the body as { xdr }. Accept both.
        value:
          typeof value === 'string'
            ? value
            : asString(asRecord(value, 'value')['xdr'], 'value.xdr'),
        inSuccessfulContractCall: event['inSuccessfulContractCall'] !== false,
      };
    });

    const cursor = result['cursor'];
    return {
      events,
      latestLedger: asNumber(result['latestLedger'], 'latestLedger'),
      oldestLedger: asNumber(result['oldestLedger'], 'oldestLedger'),
      cursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null,
    };
  }

  async getLedgerRange(): Promise<LedgerRange> {
    const health = await this.getHealth();
    return { latestLedger: health.latestLedger, oldestLedger: health.oldestLedger };
  }
}
