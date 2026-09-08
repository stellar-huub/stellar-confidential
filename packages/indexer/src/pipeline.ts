import {
  IndexerError,
  ledgerUpperBound,
  silentLogger,
  type ConfidentialEvent,
  type ContractAdapter,
  type Logger,
  type RawContractEvent,
} from '@stellar-confidential/core';
import type { EventStore, IngestBatch, LedgerRecord } from './store.js';
import type { RpcEvent, RpcLedger, StellarRpcLike } from './rpc.js';
import { decodeEventId } from './toid.js';
import { jsonScValCodec, type ScValCodec } from './scval.js';

/**
 * Ingestion pipeline (milestone M1.2).
 *
 * The pipeline advances a *ledger window* at a time and commits each window
 * atomically: every event in ledgers [start, end], the ledger headers, and the
 * checkpoint go in together or not at all.
 *
 * Committing whole ledgers rather than whole pages is what makes a restart
 * exact. There is no state in which half a ledger is durable, so the checkpoint
 * always describes a real boundary and re-running from it reproduces byte-
 * identical state — the property M1.2's acceptance criterion asks for.
 *
 * Reorgs are detected two ways:
 *   - writing a ledger we already hold under a different hash, and
 *   - a ledger whose recorded parent hash does not match the parent we stored.
 * Either one walks back to the fork point, deletes everything above it, and
 * rewinds the checkpoint.
 */

export interface IngestorOptions {
  readonly rpc: StellarRpcLike;
  readonly store: EventStore;
  readonly adapter: ContractAdapter;
  readonly logger?: Logger;
  readonly decodeScVal?: ScValCodec;
  /** Names the checkpoint row; lets several pipelines share one database. */
  readonly checkpointName?: string;
  readonly contractIds?: readonly string[];
  /** Ledgers per atomic commit. */
  readonly windowSize?: number;
  /** Events requested per getEvents page. */
  readonly pageSize?: number;
  readonly pollIntervalMs?: number;
  /** Ledgers re-verified behind the tip on each follow pass, to catch reorgs. */
  readonly confirmationWindow?: number;
  /** Ledger to start from when there is no checkpoint. 0 means the oldest retained. */
  readonly startLedger?: number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

export interface IngestStats {
  readonly ledgersScanned: number;
  readonly eventsInserted: number;
  readonly eventsSkipped: number;
  readonly reorgsHandled: number;
  readonly lastLedger: number;
}

const EMPTY_STATS: IngestStats = {
  ledgersScanned: 0,
  eventsInserted: 0,
  eventsSkipped: 0,
  reorgsHandled: 0,
  lastLedger: 0,
};

function addStats(a: IngestStats, b: Partial<IngestStats>): IngestStats {
  return {
    ledgersScanned: a.ledgersScanned + (b.ledgersScanned ?? 0),
    eventsInserted: a.eventsInserted + (b.eventsInserted ?? 0),
    eventsSkipped: a.eventsSkipped + (b.eventsSkipped ?? 0),
    reorgsHandled: a.reorgsHandled + (b.reorgsHandled ?? 0),
    lastLedger: Math.max(a.lastLedger, b.lastLedger ?? 0),
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Ingestor {
  private readonly rpc: StellarRpcLike;
  private readonly store: EventStore;
  private readonly adapter: ContractAdapter;
  private readonly logger: Logger;
  private readonly decodeScVal: ScValCodec;
  private readonly checkpointName: string;
  private readonly contractIds: readonly string[];
  private readonly windowSize: number;
  private readonly pageSize: number;
  private readonly pollIntervalMs: number;
  private readonly confirmationWindow: number;
  private readonly startLedger: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: IngestorOptions) {
    this.rpc = options.rpc;
    this.store = options.store;
    this.adapter = options.adapter;
    this.logger = (options.logger ?? silentLogger).child({ component: 'ingestor' });
    this.decodeScVal = options.decodeScVal ?? jsonScValCodec;
    this.checkpointName = options.checkpointName ?? 'primary';
    this.contractIds = options.contractIds ?? [];
    this.windowSize = options.windowSize ?? 200;
    this.pageSize = options.pageSize ?? 200;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.confirmationWindow = options.confirmationWindow ?? 10;
    this.startLedger = options.startLedger ?? 0;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  /** The next ledger to ingest, from the durable checkpoint. */
  async resumeLedger(): Promise<number> {
    const checkpoint = await this.store.getCheckpoint(this.checkpointName);
    if (checkpoint !== null) return checkpoint.ledgerSequence + 1;
    if (this.startLedger > 0) return this.startLedger;
    const range = await this.rpc.getLedgerRange();
    return range.oldestLedger;
  }

  /**
   * Ingest everything currently available, then return.
   *
   * This is the backfill mode, and it is also one pass of follow mode.
   */
  async runOnce(): Promise<IngestStats> {
    const range = await this.rpc.getLedgerRange();
    let cursorLedger = await this.resumeLedger();
    let stats = EMPTY_STATS;

    if (cursorLedger < range.oldestLedger) {
      // The node has pruned history we never ingested. Say so loudly rather than
      // silently producing a history with a hole in it.
      throw new IndexerError(
        'RETENTION_EVICTED',
        'requested ledgers are older than the node retains',
        { requested: cursorLedger, oldestAvailable: range.oldestLedger },
      );
    }

    while (cursorLedger <= range.latestLedger) {
      const endLedger = Math.min(cursorLedger + this.windowSize - 1, range.latestLedger);
      const windowStats = await this.ingestWindow(cursorLedger, endLedger);
      stats = addStats(stats, windowStats);

      if (windowStats.reorgsHandled > 0) {
        // The window was rewound rather than applied. Re-read the checkpoint.
        cursorLedger = await this.resumeLedger();
        continue;
      }
      cursorLedger = endLedger + 1;
    }

    return stats;
  }

  /** Follow the network tip until the signal aborts. */
  async follow(signal?: AbortSignal): Promise<IngestStats> {
    let stats = EMPTY_STATS;
    // Read through a function so narrowing never caches the flag across an await.
    const aborted = (): boolean => signal?.aborted === true;

    while (!aborted()) {
      try {
        stats = addStats(stats, await this.runOnce());
        stats = addStats(stats, await this.verifyConfirmationWindow());
      } catch (error) {
        // A follow loop must survive a node restart or a transient outage.
        this.logger.error('ingest pass failed', { error });
      }
      if (aborted()) break;
      await this.sleepImpl(this.pollIntervalMs);
    }
    return stats;
  }

  /**
   * Re-check the most recent ledgers we hold against the node.
   *
   * A reorg rewrites ledgers we have already committed, so it is invisible to
   * forward-only ingestion. This is the pass that notices.
   */
  async verifyConfirmationWindow(): Promise<Partial<IngestStats>> {
    if (this.confirmationWindow <= 0) return {};
    const latest = await this.store.getLatestLedger();
    if (latest === null) return {};

    const from = Math.max(1, latest.sequence - this.confirmationWindow + 1);
    const fresh = await this.rpc.getLedgers(from, latest.sequence - from + 1);

    for (const ledger of fresh) {
      const stored = await this.store.getLedger(ledger.sequence);
      if (stored !== null && stored.hash !== ledger.hash) {
        const forkPoint = await this.findForkPoint(ledger.sequence);
        await this.rewindTo(forkPoint);
        return { reorgsHandled: 1 };
      }
    }
    return {};
  }

  private async ingestWindow(startLedger: number, endLedger: number): Promise<IngestStats> {
    const rpcEvents = await this.fetchWindowEvents(startLedger, endLedger);
    const touched = new Set<number>(rpcEvents.map((event) => event.ledger));

    // Header fetches are the expensive part of ingestion, so we only pull the
    // ledgers that actually carry events — plus the window's final ledger, which
    // anchors the checkpoint even when the window is empty.
    const headers = await this.fetchHeaders([...touched, endLedger]);

    const reorgAt = await this.detectReorg(headers);
    if (reorgAt !== null) {
      this.logger.warn('reorg detected', { atLedger: reorgAt });
      const forkPoint = await this.findForkPoint(reorgAt);
      await this.rewindTo(forkPoint);
      return { ...EMPTY_STATS, reorgsHandled: 1 };
    }

    const events = this.decodeEvents(rpcEvents, headers);
    const eventsByLedger = new Map<number, number>();
    for (const event of events) {
      eventsByLedger.set(
        event.proof.ledgerSequence,
        (eventsByLedger.get(event.proof.ledgerSequence) ?? 0) + 1,
      );
    }

    const ledgers: LedgerRecord[] = [...headers.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((header) => ({
        sequence: header.sequence,
        hash: header.hash,
        previousHash: header.previousHash,
        closeTime: header.closeTime,
        eventCount: eventsByLedger.get(header.sequence) ?? 0,
      }));

    const batch: IngestBatch = {
      ledgers,
      events,
      checkpoint: {
        name: this.checkpointName,
        // The window boundary, not the last event: the checkpoint must mean
        // "every ledger through here is fully ingested".
        cursor: ledgerUpperBound(endLedger),
        ledgerSequence: endLedger,
      },
    };

    const result = await this.store.append(batch);
    this.logger.debug('window committed', {
      startLedger,
      endLedger,
      events: result.eventsInserted,
      skipped: result.eventsSkipped,
    });

    return {
      ledgersScanned: endLedger - startLedger + 1,
      eventsInserted: result.eventsInserted,
      eventsSkipped: result.eventsSkipped,
      reorgsHandled: 0,
      lastLedger: endLedger,
    };
  }

  private async fetchWindowEvents(
    startLedger: number,
    endLedger: number,
  ): Promise<readonly RpcEvent[]> {
    const collected: RpcEvent[] = [];
    let cursor: string | undefined;

    for (;;) {
      const page = await this.rpc.getEvents({
        ...(cursor === undefined ? { startLedger } : { cursor }),
        endLedger,
        limit: this.pageSize,
        contractIds: this.contractIds,
      });
      // Failed contract calls still emit events over RPC; they did not happen as
      // far as state is concerned, so they must never enter a balance.
      collected.push(...page.events.filter((event) => event.inSuccessfulContractCall));

      if (page.events.length < this.pageSize || page.cursor === null) break;
      cursor = page.cursor;
    }

    return collected;
  }

  private async fetchHeaders(sequences: readonly number[]): Promise<Map<number, RpcLedger>> {
    const wanted = [...new Set(sequences)].sort((a, b) => a - b);
    const headers = new Map<number, RpcLedger>();
    if (wanted.length === 0) return headers;

    // Coalesce into contiguous runs so a dense window costs one call, not one
    // call per ledger.
    let runStart = wanted[0] as number;
    let previous = runStart;
    const flush = async (start: number, end: number): Promise<void> => {
      for (const ledger of await this.rpc.getLedgers(start, end - start + 1)) {
        headers.set(ledger.sequence, ledger);
      }
    };

    for (let i = 1; i < wanted.length; i += 1) {
      const current = wanted[i] as number;
      if (current !== previous + 1) {
        await flush(runStart, previous);
        runStart = current;
      }
      previous = current;
    }
    await flush(runStart, previous);

    return headers;
  }

  /** Returns the lowest ledger that disagrees with what we already stored. */
  private async detectReorg(headers: Map<number, RpcLedger>): Promise<number | null> {
    for (const header of [...headers.values()].sort((a, b) => a.sequence - b.sequence)) {
      const stored = await this.store.getLedger(header.sequence);
      if (stored !== null && stored.hash !== header.hash) return header.sequence;

      const parent = await this.store.getLedger(header.sequence - 1);
      if (parent !== null && parent.hash !== header.previousHash) return header.sequence - 1;
    }
    return null;
  }

  /** Walk back until stored history and the node agree. Returns the last good ledger. */
  private async findForkPoint(suspect: number): Promise<number> {
    let sequence = suspect;
    while (sequence > 0) {
      const stored = await this.store.getLedger(sequence);
      if (stored === null) {
        sequence -= 1;
        continue;
      }
      const [fresh] = await this.rpc.getLedgers(sequence, 1);
      if (fresh !== undefined && fresh.hash === stored.hash) return sequence;
      sequence -= 1;
    }
    return 0;
  }

  private async rewindTo(forkPoint: number): Promise<void> {
    const removed = await this.store.rollbackTo(forkPoint);
    // Rewriting the checkpoint through append() keeps the "checkpoint is always
    // a committed boundary" invariant intact.
    await this.store.append({
      ledgers: [],
      events: [],
      checkpoint: {
        name: this.checkpointName,
        cursor: ledgerUpperBound(forkPoint),
        ledgerSequence: forkPoint,
      },
    });
    this.logger.warn('rewound after reorg', { forkPoint, eventsRemoved: removed });
  }

  private decodeEvents(
    rpcEvents: readonly RpcEvent[],
    headers: Map<number, RpcLedger>,
  ): ConfidentialEvent[] {
    const decoded: ConfidentialEvent[] = [];

    for (const rpcEvent of rpcEvents) {
      const header = headers.get(rpcEvent.ledger);
      if (header === undefined) {
        throw new IndexerError('LEDGER_GAP', 'event references a ledger with no header', {
          ledger: rpcEvent.ledger,
          eventId: rpcEvent.id,
        });
      }

      const ordinal = decodeEventId(rpcEvent.id);
      const raw: RawContractEvent = {
        ledgerSequence: rpcEvent.ledger,
        ledgerHash: header.hash,
        ledgerCloseTime: header.closeTime,
        txHash: rpcEvent.txHash,
        txIndex: ordinal.txIndex,
        opIndex: ordinal.opIndex,
        eventIndex: ordinal.eventIndex,
        contractId: rpcEvent.contractId,
        topics: rpcEvent.topic.map((topic) => this.decodeScVal(topic)),
        value: this.decodeScVal(rpcEvent.value),
      };

      if (!this.adapter.recognises(raw)) continue;
      decoded.push(...this.adapter.decode(raw));
    }

    // Cursor order is the contract for everything downstream; establish it here
    // rather than trusting the node's page ordering.
    decoded.sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
    return decoded;
  }

  /** Apply the retention policy. Returns events removed. */
  async prune(retentionLedgers: number): Promise<number> {
    if (retentionLedgers <= 0) return 0;
    const latest = await this.store.getLatestLedger();
    if (latest === null) return 0;
    const cutoff = latest.sequence - retentionLedgers;
    if (cutoff <= 0) return 0;
    const removed = await this.store.prune(cutoff);
    this.logger.info('pruned history', { cutoff, eventsRemoved: removed });
    return removed;
  }
}
