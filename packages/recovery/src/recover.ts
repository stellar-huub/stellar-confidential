import {
  CURSOR_MAX,
  RecoveryError,
  silentLogger,
  type ConfidentialEvent,
  type EncryptedAmount,
  type Logger,
} from '@stellar-confidential/core';
import type { ViewingKey } from '@stellar-confidential/crypto';
import type { EventSource } from './source.js';
import { initialState, replay, type ReplayOptions, type ReplayState } from './replay.js';
import { fromCheckpoint, toCheckpoint, type ReplayCheckpoint } from './checkpoint.js';
import { verifyEventIntegrity, verifyState, type VerificationReport } from './verify.js';

/**
 * Recovery orchestration (milestone M2.4).
 *
 * Pulls an account's history from an archive, verifies it against the digest the
 * archive published, replays it into state, and checks the result against the
 * chain.
 *
 * Everything here runs on the client. The archive is asked for events; it is
 * never given a key, a decrypted amount, or a balance. That is not a convention
 * — `RecoverySession` has no path to send any of them, and a test asserts it
 * over the actual request traffic.
 */

/** Reads the account's confidential balance from the chain, for verification. */
export interface ChainBalanceSource {
  getConfidentialBalance(account: string): Promise<EncryptedAmount | null>;
  getLatestLedger(): Promise<number>;
}

export interface RecoverySessionOptions {
  readonly account: string;
  readonly viewingKey: ViewingKey;
  readonly source: EventSource;
  /** Omit to skip chain verification — sync still runs, but nothing is proven. */
  readonly chain?: ChainBalanceSource;
  readonly logger?: Logger;
  readonly pageSize?: number;
  readonly replayOptions?: ReplayOptions;
  /** Verify each page against the archive's digest. On by default; turn off only in trusted tests. */
  readonly verifyIntegrity?: boolean;
  readonly maxAttemptsPerPage?: number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  readonly maxAcceptableLag?: number;
}

export interface SyncResult {
  readonly state: ReplayState;
  /** Null when the account has no events at all. */
  readonly checkpoint: ReplayCheckpoint | null;
  /** Null when no chain source was configured. */
  readonly report: VerificationReport | null;
  readonly eventsApplied: number;
  readonly pagesFetched: number;
  readonly sourceId: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RecoverySession {
  private readonly logger: Logger;
  private readonly pageSize: number;
  private readonly verifyIntegrity: boolean;
  private readonly maxAttempts: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  /** Retained so an interrupted sync can resume without re-fetching. */
  private state: ReplayState;

  constructor(private readonly options: RecoverySessionOptions) {
    this.logger = (options.logger ?? silentLogger).child({
      component: 'recovery',
      account: options.account,
    });
    this.pageSize = options.pageSize ?? 200;
    this.verifyIntegrity = options.verifyIntegrity ?? true;
    this.maxAttempts = options.maxAttemptsPerPage ?? 4;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.state = initialState(options.account);
  }

  /** The state accumulated so far, including after a failed sync. */
  get current(): ReplayState {
    return this.state;
  }

  /**
   * Fetch and apply everything new.
   *
   * Pass the checkpoint from a previous run to sync incrementally; omit it to
   * rebuild from genesis. Progress is kept even if a later page fails, so a
   * dropped connection costs the remaining pages, not the whole sync.
   */
  async sync(
    options: { from?: ReplayCheckpoint | null; signal?: AbortSignal } = {},
  ): Promise<SyncResult> {
    if (options.from !== null && options.from !== undefined) {
      if (options.from.account !== this.options.account) {
        throw new RecoveryError('CHECKPOINT_MISMATCH', 'checkpoint belongs to another account', {
          expected: this.options.account,
          actual: options.from.account,
        });
      }
      this.state = fromCheckpoint(options.from);
    }

    const startedFrom = this.state.eventCount;
    let pagesFetched = 0;

    for (;;) {
      if (options.signal?.aborted === true) {
        throw new RecoveryError('SOURCE_UNAVAILABLE', 'sync aborted', {
          account: this.options.account,
          eventsApplied: this.state.eventCount - startedFrom,
        });
      }

      const after = this.state.lastCursor ?? undefined;
      const page = await this.fetchPage(after);
      pagesFetched += 1;

      // The digest range is chosen by the client, never derived from what came
      // back. Asking "commit to exactly what you just sent me" lets an archive
      // drop the tail of a history and produce a digest that agrees with the
      // truncation. Asking "commit to everything after my cursor, up to the
      // bound I asked for" does not.
      //
      // While more pages remain the range can only be bounded at the last cursor
      // received; on the final page the bound is the client's own upper bound,
      // which is what makes a withheld tail visible.
      const upperBound =
        page.hasMore && page.events.length > 0
          ? (page.events[page.events.length - 1] as ConfidentialEvent).cursor
          : CURSOR_MAX;

      if (this.verifyIntegrity) {
        const digest = await this.withRetry(() =>
          this.options.source.fetchDigest({
            account: this.options.account,
            ...(after === undefined ? {} : { afterCursor: after }),
            toCursor: upperBound,
          }),
        );
        // Verified before replay, never after: a forged event must not be able
        // to touch a balance even transiently.
        verifyEventIntegrity(page.events, digest, this.options.source.id);
      }

      if (page.events.length === 0) break;

      this.state = replay(
        this.state,
        page.events,
        this.options.viewingKey,
        this.options.replayOptions,
      );
      this.logger.debug('page applied', {
        events: page.events.length,
        cursor: this.state.lastCursor,
      });

      if (!page.hasMore) break;
    }

    const report = await this.verify();

    return {
      state: this.state,
      checkpoint: this.state.lastCursor === null ? null : toCheckpoint(this.state),
      report,
      eventsApplied: this.state.eventCount - startedFrom,
      pagesFetched,
      sourceId: this.options.source.id,
    };
  }

  private async fetchPage(afterCursor: string | undefined) {
    return this.withRetry(() =>
      this.options.source.fetchAccountEvents({
        account: this.options.account,
        ...(afterCursor === undefined ? {} : { afterCursor }),
        toCursor: CURSOR_MAX,
        limit: this.pageSize,
      }),
    );
  }

  /**
   * Retry transport failures, but never integrity failures.
   *
   * A flaky network deserves another attempt. An archive that served events not
   * matching its own digest does not — retrying would just ask a misbehaving
   * provider the same question again.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let backoff = 200;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (cause) {
        if (cause instanceof RecoveryError && cause.code !== 'SOURCE_UNAVAILABLE') throw cause;
        lastError = cause;
        this.logger.warn('archive request failed', { attempt, source: this.options.source.id });
        if (attempt < this.maxAttempts) {
          await this.sleepImpl(backoff);
          backoff *= 2;
        }
      }
    }

    throw lastError instanceof RecoveryError
      ? lastError
      : new RecoveryError('SOURCE_UNAVAILABLE', 'archive unreachable after retries', {
          source: this.options.source.id,
          attempts: this.maxAttempts,
        });
  }

  private async verify(): Promise<VerificationReport | null> {
    const chain = this.options.chain;
    if (chain === undefined) return null;

    const [chainBalance, chainLedger, status] = await Promise.all([
      chain.getConfidentialBalance(this.options.account),
      chain.getLatestLedger(),
      this.options.source.status(),
    ]);

    return verifyState({
      state: this.state,
      viewingKey: this.options.viewingKey,
      chainBalance,
      chainLedger,
      archiveLedger: status.latestLedger,
      ...(this.options.maxAcceptableLag === undefined
        ? {}
        : { maxAcceptableLag: this.options.maxAcceptableLag }),
      ...(this.options.replayOptions?.maxAbsLimb === undefined
        ? {}
        : { maxAbsLimb: this.options.replayOptions.maxAbsLimb }),
    });
  }
}
