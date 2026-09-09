import {
  CURSOR_MAX,
  CURSOR_MIN,
  computeRangeDigest,
  type ConfidentialEvent,
  type RangeDigest,
} from '@stellar-confidential/core';
import type { EventStore } from './store.js';
import type { Cache } from './cache.js';

/**
 * Integrity service (milestone M1.5).
 *
 * Publishes a Merkle commitment over a cursor range so a client can prove the
 * events it was served are the events this archive holds — and, combined with
 * digests from a second provider, that two archives agree.
 *
 * The digest is deterministic for a fixed range, so it caches cleanly. Ranges
 * that end at the open upper bound move as new events arrive, so those get a
 * short TTL; closed ranges are immutable once their ledgers are final.
 */

const CLOSED_RANGE_TTL_SECONDS = 3_600;
const OPEN_RANGE_TTL_SECONDS = 5;

export interface DigestRequest {
  /** Inclusive lower bound. */
  readonly fromCursor?: string;
  /**
   * Exclusive lower bound. Takes precedence over `fromCursor`.
   *
   * Mirrors the pagination parameter clients already use, so a client can ask
   * "commit to everything after the cursor I have" without an off-by-one at the
   * boundary event it already holds.
   */
  readonly afterCursor?: string;
  readonly toCursor?: string;
  readonly account?: string;
  readonly contractId?: string;
}

export class IntegrityService {
  constructor(
    private readonly store: EventStore,
    private readonly cache?: Cache,
  ) {}

  private cacheKey(from: string, to: string, exclusive: boolean, request: DigestRequest): string {
    return [
      'digest',
      exclusive ? 'x' : 'i',
      from,
      to,
      request.account ?? '*',
      request.contractId ?? '*',
    ].join(':');
  }

  async digest(request: DigestRequest = {}): Promise<RangeDigest> {
    const exclusive = request.afterCursor !== undefined;
    const from = request.afterCursor ?? request.fromCursor ?? CURSOR_MIN;
    const to = request.toCursor ?? CURSOR_MAX;
    const key = this.cacheKey(from, to, exclusive, request);

    const cached = await this.cache?.get(key);
    if (cached !== null && cached !== undefined) {
      return JSON.parse(cached) as RangeDigest;
    }

    const events: ConfidentialEvent[] = [];
    const filter: { account?: string; contractId?: string } = {};
    if (request.account !== undefined) filter.account = request.account;
    if (request.contractId !== undefined) filter.contractId = request.contractId;

    for await (const event of this.store.streamRange(from, to, filter)) {
      if (exclusive && event.cursor === from) continue;
      events.push(event);
    }

    const digest = computeRangeDigest(from, to, events);
    await this.cache?.set(
      key,
      JSON.stringify(digest),
      to === CURSOR_MAX ? OPEN_RANGE_TTL_SECONDS : CLOSED_RANGE_TTL_SECONDS,
    );
    return digest;
  }
}
