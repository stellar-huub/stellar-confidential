import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils.js';
import {
  RecoveryError,
  eventLeafHash,
  type ConfidentialEvent,
  type EncryptedAmount,
} from '@stellar-confidential/core';
import {
  DEFAULT_BALANCE_BOUND,
  DEFAULT_LIMB_BOUND,
  ZERO_AMOUNT,
  addAmounts,
  decryptAmount,
  subtractAmounts,
  type ViewingKey,
} from '@stellar-confidential/crypto';

/**
 * The replay engine (milestone M2.2).
 *
 * Confidential state lives on the user's device and nowhere else. Replay is how
 * it comes back: fold the account's event history, in cursor order, into a
 * balance and a transaction history.
 *
 * Two balances are tracked deliberately:
 *
 *   - `balance`, the homomorphic sum of the event ciphertexts. This is what the
 *     chain holds, and comparing it is how we detect a divergence.
 *   - `value`, the plaintext, accumulated from each event's decrypted amount.
 *
 * Keeping both means verification never has to solve a discrete log over a large
 * accumulated balance: the plaintext is already known, so checking it against a
 * ciphertext is constant work (see verify.ts).
 *
 * The fold is pure and total. Given the same events it produces the same state,
 * bit for bit, on any machine — which is what makes checkpoints safe and what
 * M2.2's acceptance criterion pins down.
 */

export interface HistoryEntry {
  readonly cursor: string;
  readonly type: ConfidentialEvent['type'];
  readonly delta: ConfidentialEvent['delta'];
  /** Decrypted amount, or null for events that carry none. */
  readonly value: bigint | null;
  readonly counterparty: string | null;
  readonly ledgerSequence: number;
  readonly ledgerCloseTime: number;
  readonly txHash: string;
}

export interface ReplayState {
  readonly account: string;
  /** Homomorphic sum of every event ciphertext consumed so far. */
  readonly balance: EncryptedAmount;
  /** The plaintext balance. Never negative in a consistent history. */
  readonly value: bigint;
  readonly eventCount: number;
  readonly lastCursor: string | null;
  readonly lastLedgerSequence: number | null;
  /**
   * Rolling commitment to every event consumed, in order.
   *
   * Distinct from the archive's Merkle range digest: this one is incremental, so
   * a checkpoint carries it forward without holding the events it summarises.
   */
  readonly digest: string;
  readonly history: readonly HistoryEntry[];
}

export interface ReplayOptions {
  /**
   * Per-limb discrete-log bound.
   *
   * Defaults to the narrow single-event bound. Every amount attached to an event
   * is a fresh encryption, so its limbs are below 2^16 — only *accumulated*
   * balances need a wider search, and replay never decrypts one of those. A
   * limb that does not resolve in the narrow bound is retried once at
   * `fallbackMaxAbsLimb` before replay gives up, so the wide search costs
   * nothing on the path that always runs.
   */
  readonly maxAbsLimb?: number;
  /** Second-chance bound for an unusually wide limb. */
  readonly fallbackMaxAbsLimb?: number;
  /** Cap on retained history entries. The balance is unaffected. */
  readonly maxHistory?: number;
}

const GENESIS_DIGEST = '00'.repeat(32);

export function initialState(account: string): ReplayState {
  return {
    account,
    balance: ZERO_AMOUNT,
    value: 0n,
    eventCount: 0,
    lastCursor: null,
    lastLedgerSequence: null,
    digest: GENESIS_DIGEST,
    history: [],
  };
}

function advanceDigest(previous: string, event: ConfidentialEvent): string {
  return bytesToHex(sha256(concatBytes(hexToBytes(previous), eventLeafHash(event))));
}

function requireAmount(event: ConfidentialEvent): EncryptedAmount {
  if (event.amount === null) {
    throw new RecoveryError('UNSUPPORTED_EVENT', 'event changes a balance but carries no amount', {
      cursor: event.cursor,
      type: event.type,
      delta: event.delta,
    });
  }
  return event.amount;
}

function decrypt(
  event: ConfidentialEvent,
  amount: EncryptedAmount,
  key: ViewingKey,
  maxAbsLimb: number,
  fallbackMaxAbsLimb: number,
  isFirst: boolean,
): bigint {
  try {
    // An event amount is always a fresh encryption, so its limbs are
    // non-negative and the negative half of the search can be skipped.
    return decryptAmount(amount, key, { maxAbsLimb, allowNegative: false });
  } catch {
    // Fall through to the wider search before blaming the key.
  }

  try {
    return decryptAmount(amount, key, { maxAbsLimb: fallbackMaxAbsLimb });
  } catch (cause) {
    // A wrong key and an out-of-range amount are indistinguishable inside the
    // solver, but not from here: if the very first event will not decrypt, the
    // key is overwhelmingly the reason, and telling the user to re-check their
    // key beats telling them their balance needs a rollover.
    throw new RecoveryError(
      isFirst ? 'WRONG_KEY' : 'UNSUPPORTED_EVENT',
      isFirst
        ? 'the first event did not decrypt: this viewing key does not belong to this account'
        : 'event amount did not decrypt within the search bound',
      {
        cursor: event.cursor,
        account: event.account,
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
}

/**
 * Fold events into state, continuing from `state`.
 *
 * Events must belong to `state.account`, be in strictly ascending cursor order,
 * and start after `state.lastCursor`. Each of those is checked: silently
 * accepting an out-of-order or duplicated event would corrupt a balance, and a
 * corrupt balance is worse than a refusal (invariant 3).
 */
export function replay(
  state: ReplayState,
  events: readonly ConfidentialEvent[],
  key: ViewingKey,
  options: ReplayOptions = {},
): ReplayState {
  const maxAbsLimb = options.maxAbsLimb ?? DEFAULT_LIMB_BOUND;
  const fallbackMaxAbsLimb = options.fallbackMaxAbsLimb ?? DEFAULT_BALANCE_BOUND;
  const maxHistory = options.maxHistory ?? Number.POSITIVE_INFINITY;

  let balance = state.balance;
  let value = state.value;
  let digest = state.digest;
  let lastCursor = state.lastCursor;
  let lastLedgerSequence = state.lastLedgerSequence;
  let eventCount = state.eventCount;
  const history = [...state.history];

  for (const event of events) {
    if (event.account !== state.account) {
      throw new RecoveryError('UNSUPPORTED_EVENT', 'event belongs to a different account', {
        cursor: event.cursor,
        expected: state.account,
        actual: event.account,
      });
    }
    if (lastCursor !== null && event.cursor <= lastCursor) {
      throw new RecoveryError('MISSING_EVENTS', 'events are out of order or duplicated', {
        cursor: event.cursor,
        previousCursor: lastCursor,
      });
    }

    const isFirst = eventCount === 0;
    let entryValue: bigint | null = null;

    switch (event.delta) {
      case 'credit': {
        const amount = requireAmount(event);
        entryValue = decrypt(event, amount, key, maxAbsLimb, fallbackMaxAbsLimb, isFirst);
        balance = addAmounts(balance, amount);
        value += entryValue;
        break;
      }
      case 'debit': {
        const amount = requireAmount(event);
        entryValue = decrypt(event, amount, key, maxAbsLimb, fallbackMaxAbsLimb, isFirst);
        balance = subtractAmounts(balance, amount);
        value -= entryValue;
        break;
      }
      case 'replace': {
        // Rollover and key rotation change the ciphertext, not the value.
        const amount = requireAmount(event);
        entryValue = decrypt(event, amount, key, maxAbsLimb, fallbackMaxAbsLimb, isFirst);
        balance = amount;
        value = entryValue;
        break;
      }
      case 'none':
        break;
    }

    if (value < 0n) {
      // A debit larger than everything credited so far means the history we were
      // given is incomplete — the credits that funded it are missing.
      throw new RecoveryError(
        'MISSING_EVENTS',
        'balance went negative during replay: earlier credits are missing from this history',
        { cursor: event.cursor, account: state.account, eventsSeen: eventCount + 1 },
      );
    }

    digest = advanceDigest(digest, event);
    lastCursor = event.cursor;
    lastLedgerSequence = event.proof.ledgerSequence;
    eventCount += 1;

    history.push({
      cursor: event.cursor,
      type: event.type,
      delta: event.delta,
      value: entryValue,
      counterparty: event.counterparty,
      ledgerSequence: event.proof.ledgerSequence,
      ledgerCloseTime: event.proof.ledgerCloseTime,
      txHash: event.proof.txHash,
    });
  }

  return {
    account: state.account,
    balance,
    value,
    eventCount,
    lastCursor,
    lastLedgerSequence,
    digest,
    history: Number.isFinite(maxHistory) ? history.slice(-maxHistory) : history,
  };
}

/** Replay from scratch. Equivalent to replaying onto a fresh state. */
export function replayFromGenesis(
  account: string,
  events: readonly ConfidentialEvent[],
  key: ViewingKey,
  options: ReplayOptions = {},
): ReplayState {
  return replay(initialState(account), events, key, options);
}
