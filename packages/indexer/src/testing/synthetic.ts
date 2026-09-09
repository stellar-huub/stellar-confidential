import { createHash } from 'node:crypto';
import type { EncryptedAmount, JsonValue } from '@stellar-confidential/core';
import type { EventsPage, LedgerRange, RpcEvent, RpcLedger, StellarRpcLike } from '../rpc.js';
import { encodeToid } from '../toid.js';
import { encodeJsonScVal } from '../scval.js';
import { REFERENCE_TOPIC } from '../adapters/reference.js';

/**
 * A synthetic Stellar chain that speaks the RPC surface ingestion depends on.
 *
 * This exists because two of the properties the indexer must have cannot be
 * tested against a real node on demand:
 *
 *   - reorg handling, which needs a chain that rewrites its own history, and
 *   - crash-restart determinism, which needs a chain that replays identically.
 *
 * It is shipped rather than kept in test/ because the reference demo and any
 * downstream adapter's conformance tests need it too.
 */

export interface SyntheticEventSpec {
  readonly type: 'deposit' | 'withdraw' | 'transfer' | 'rollover' | 'key_rotation' | 'disclosure';
  readonly account: string;
  readonly counterparty?: string;
  readonly amount?: EncryptedAmount;
  readonly counterpartyAmount?: EncryptedAmount;
  readonly balance?: EncryptedAmount;
  readonly publicAmount?: string;
  readonly contractId?: string;
  /** Set false to emit an event from a failed contract call. */
  readonly successful?: boolean;
}

export interface SyntheticLedger {
  readonly sequence: number;
  readonly hash: string;
  readonly previousHash: string;
  readonly closeTime: number;
  readonly events: readonly RpcEvent[];
}

export const DEFAULT_CONTRACT_ID = 'CSYNTHETIC00000000000000000000000000000000000000000000';

function hashFor(sequence: number, epoch: number, previousHash: string): string {
  return createHash('sha256').update(`${sequence}:${epoch}:${previousHash}`).digest('hex');
}

function bodyFor(spec: SyntheticEventSpec): JsonValue {
  switch (spec.type) {
    case 'deposit':
    case 'withdraw':
      return {
        account: spec.account,
        amount: (spec.amount ?? null) as unknown as JsonValue,
        publicAmount: spec.publicAmount ?? null,
      };
    case 'transfer':
      return {
        from: spec.account,
        to: spec.counterparty ?? '',
        fromAmount: (spec.amount ?? null) as unknown as JsonValue,
        toAmount: (spec.counterpartyAmount ?? spec.amount ?? null) as unknown as JsonValue,
      };
    case 'rollover':
    case 'key_rotation':
      return {
        account: spec.account,
        balance: (spec.balance ?? spec.amount ?? null) as unknown as JsonValue,
      };
    case 'disclosure':
      return { account: spec.account, auditor: spec.counterparty ?? null };
  }
}

export class SyntheticChain implements StellarRpcLike {
  private readonly ledgers: SyntheticLedger[] = [];
  /** Bumped on reorg so regenerated ledgers hash differently. */
  private epoch = 0;
  private readonly firstSequence: number;

  constructor(options: { firstSequence?: number; genesisHash?: string } = {}) {
    this.firstSequence = options.firstSequence ?? 1;
    this.genesisHash = options.genesisHash ?? '00'.repeat(32);
  }

  private readonly genesisHash: string;

  get tip(): number {
    const last = this.ledgers[this.ledgers.length - 1];
    return last?.sequence ?? this.firstSequence - 1;
  }

  get oldest(): number {
    return this.ledgers[0]?.sequence ?? this.firstSequence;
  }

  /** Close a ledger containing the given events. Returns its sequence. */
  appendLedger(specs: readonly SyntheticEventSpec[] = []): number {
    const sequence = this.tip + 1;
    const previousHash = this.ledgers[this.ledgers.length - 1]?.hash ?? this.genesisHash;
    const hash = hashFor(sequence, this.epoch, previousHash);
    const closeTime = 1_700_000_000 + sequence * 5;

    const events = specs.map((spec, index): RpcEvent => {
      // One operation per event keeps the TOID mapping obvious in test failures.
      const toid = encodeToid(sequence, 1, index);
      return {
        id: `${toid.toString()}-0`,
        type: 'contract',
        ledger: sequence,
        ledgerClosedAt: new Date(closeTime * 1000).toISOString(),
        contractId: spec.contractId ?? DEFAULT_CONTRACT_ID,
        txHash: createHash('sha256').update(`${sequence}:${index}:${this.epoch}`).digest('hex'),
        topic: [
          encodeJsonScVal(REFERENCE_TOPIC),
          encodeJsonScVal(spec.type),
          encodeJsonScVal(spec.account),
          encodeJsonScVal(spec.counterparty ?? ''),
        ],
        value: encodeJsonScVal(bodyFor(spec)),
        inSuccessfulContractCall: spec.successful !== false,
      };
    });

    this.ledgers.push({ sequence, hash, previousHash, closeTime, events });
    return sequence;
  }

  /**
   * Rewrite history from `sequence` onward, as a reorg does.
   *
   * Ledgers at and above the fork point are discarded and rebuilt with different
   * hashes, so an indexer that already committed them now disagrees with us.
   */
  reorgFrom(sequence: number, replacement: readonly (readonly SyntheticEventSpec[])[]): void {
    const keep = this.ledgers.filter((ledger) => ledger.sequence < sequence);
    this.ledgers.length = 0;
    this.ledgers.push(...keep);
    this.epoch += 1;
    for (const specs of replacement) this.appendLedger(specs);
  }

  /** Drop ledgers below `sequence`, as a node with limited retention does. */
  setOldestRetained(sequence: number): void {
    const keep = this.ledgers.filter((ledger) => ledger.sequence >= sequence);
    this.ledgers.length = 0;
    this.ledgers.push(...keep);
  }

  async getLedgerRange(): Promise<LedgerRange> {
    return { latestLedger: this.tip, oldestLedger: this.oldest };
  }

  async getLedgers(startLedger: number, limit: number): Promise<readonly RpcLedger[]> {
    return this.ledgers
      .filter((ledger) => ledger.sequence >= startLedger && ledger.sequence < startLedger + limit)
      .map((ledger) => ({
        sequence: ledger.sequence,
        hash: ledger.hash,
        previousHash: ledger.previousHash,
        closeTime: ledger.closeTime,
        protocolVersion: 23,
      }));
  }

  async getEvents(request: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
    limit: number;
    contractIds?: readonly string[];
  }): Promise<EventsPage> {
    const all = this.ledgers.flatMap((ledger) => ledger.events);
    const filtered = all.filter((event) => {
      if (request.contractIds && request.contractIds.length > 0) {
        if (!request.contractIds.includes(event.contractId)) return false;
      }
      if (request.cursor !== undefined) {
        if (event.id <= request.cursor) return false;
      } else if (request.startLedger !== undefined && event.ledger < request.startLedger) {
        return false;
      }
      if (request.endLedger !== undefined && event.ledger > request.endLedger) return false;
      return true;
    });

    // Event ids are TOID-derived, so string ordering matches ledger ordering
    // only when the numeric parts are the same width. Sort numerically instead.
    filtered.sort((a, b) => {
      const left = BigInt(a.id.split('-')[0] as string);
      const right = BigInt(b.id.split('-')[0] as string);
      return left < right ? -1 : left > right ? 1 : 0;
    });

    const page = filtered.slice(0, request.limit);
    const last = page[page.length - 1];
    return {
      events: page,
      latestLedger: this.tip,
      oldestLedger: this.oldest,
      cursor: last?.id ?? null,
    };
  }
}
