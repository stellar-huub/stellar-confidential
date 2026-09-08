import {
  RecoveryError,
  verifyAgainstDigest,
  type ConfidentialEvent,
  type EncryptedAmount,
  type RangeDigest,
} from '@stellar-confidential/core';
import {
  DEFAULT_BALANCE_BOUND,
  decryptAmount,
  verifyAmount,
  type ViewingKey,
} from '@stellar-confidential/crypto';
import type { ReplayState } from './replay.js';

/**
 * State verification (milestone M2.3).
 *
 * Reconstructed state is checked against the chain, not against the archive that
 * served it. The archive is not trusted to be complete or honest (invariant 4),
 * so "the database said so" is never an answer.
 *
 * The point of this module is discrimination. Every failure mode gets its own
 * code, because they have different remedies:
 *
 *   WRONG_KEY       the chain balance will not decrypt at all → check the key
 *   MISSING_EVENTS  we hold less than the chain → the archive is incomplete
 *   BALANCE_MISMATCH we hold more than the chain → duplicated or forged events
 *   STALE_INDEX     the archive is behind the chain → wait and re-sync
 *   INTEGRITY_FAILURE the events do not match the digest → the archive misbehaved
 *
 * Returning a plausible balance for any of these instead would be the single
 * worst thing this project could do (invariant 3).
 */

export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerificationReport {
  readonly account: string;
  readonly verified: boolean;
  readonly checks: readonly VerificationCheck[];
  /** Set when verification failed; null when it passed. */
  readonly failure: {
    readonly code: RecoveryError['code'];
    readonly message: string;
    readonly context: Record<string, string | number | null>;
  } | null;
}

export interface VerificationInput {
  readonly state: ReplayState;
  readonly viewingKey: ViewingKey;
  /** The account's confidential balance as the chain holds it, or null if absent. */
  readonly chainBalance: EncryptedAmount | null;
  /** Tip of the network. */
  readonly chainLedger: number;
  /** Tip of the archive that served the events. */
  readonly archiveLedger: number;
  /** Ledgers of lag tolerated before the archive is called stale. */
  readonly maxAcceptableLag?: number;
  readonly maxAbsLimb?: number;
}

const DEFAULT_MAX_LAG = 10;

function fail(
  account: string,
  checks: VerificationCheck[],
  code: RecoveryError['code'],
  message: string,
  context: Record<string, string | number | null> = {},
): VerificationReport {
  return { account, verified: false, checks, failure: { code, message, context } };
}

/**
 * Verify replayed state against the chain.
 *
 * Pure: every input is passed in, so each failure mode is directly testable
 * without a network, a node, or a database.
 */
export function verifyState(input: VerificationInput): VerificationReport {
  const { state, viewingKey, chainBalance, chainLedger, archiveLedger } = input;
  const maxLag = input.maxAcceptableLag ?? DEFAULT_MAX_LAG;
  const maxAbsLimb = input.maxAbsLimb ?? DEFAULT_BALANCE_BOUND;
  const checks: VerificationCheck[] = [];

  const lag = chainLedger - archiveLedger;
  const lagOk = lag <= maxLag;
  checks.push({
    name: 'archive-freshness',
    passed: lagOk,
    detail: `archive is ${lag} ledger(s) behind the network (tolerance ${maxLag})`,
  });

  if (chainBalance === null) {
    // No confidential balance on chain. Consistent only with an empty history.
    const consistent = state.value === 0n && state.eventCount === 0;
    checks.push({
      name: 'chain-balance-present',
      passed: consistent,
      detail: consistent
        ? 'no confidential balance on chain, and no events replayed'
        : 'no confidential balance on chain, but events were replayed',
    });
    if (consistent) return { account: state.account, verified: true, checks, failure: null };
    return fail(
      state.account,
      checks,
      'BALANCE_MISMATCH',
      'replayed events for an account that holds no confidential balance on chain',
      { eventCount: state.eventCount, replayedValue: state.value.toString() },
    );
  }

  // Constant-work check: does the chain's ciphertext hold exactly the value we
  // computed? No discrete log needed, so this stays cheap on a phone and works
  // for balances far beyond any feasible search.
  const matches = verifyAmount(chainBalance, viewingKey, state.value);
  checks.push({
    name: 'balance-matches-chain',
    passed: matches,
    detail: matches
      ? 'reconstructed balance matches the on-chain ciphertext'
      : 'reconstructed balance does not match the on-chain ciphertext',
  });

  if (matches) {
    if (!lagOk) {
      // The balance is right for what we have, but the archive is behind, so
      // there may be newer activity we have not seen.
      return fail(
        state.account,
        checks,
        'STALE_INDEX',
        'reconstructed balance is self-consistent but the archive is behind the network',
        { archiveLedger, chainLedger, lag },
      );
    }
    return { account: state.account, verified: true, checks, failure: null };
  }

  // The value is wrong. Work out which direction, so the error is actionable.
  let chainValue: bigint | null = null;
  try {
    chainValue = decryptAmount(chainBalance, viewingKey, { maxAbsLimb });
  } catch {
    chainValue = null;
  }

  if (chainValue === null) {
    checks.push({
      name: 'chain-balance-decrypts',
      passed: false,
      detail: 'the on-chain balance does not decrypt under this viewing key',
    });
    return fail(
      state.account,
      checks,
      'WRONG_KEY',
      'the on-chain balance does not decrypt under this viewing key',
      { account: state.account },
    );
  }

  checks.push({
    name: 'chain-balance-decrypts',
    passed: true,
    detail: 'the on-chain balance decrypts, so the viewing key is correct',
  });

  const difference = chainValue - state.value;
  if (difference > 0n) {
    return fail(
      state.account,
      checks,
      lagOk ? 'MISSING_EVENTS' : 'STALE_INDEX',
      'the chain holds more than the replayed history accounts for: events are missing',
      {
        replayedValue: state.value.toString(),
        chainValue: chainValue.toString(),
        shortfall: difference.toString(),
        archiveLedger,
        chainLedger,
      },
    );
  }

  return fail(
    state.account,
    checks,
    'BALANCE_MISMATCH',
    'the replayed history accounts for more than the chain holds: events are duplicated or forged',
    {
      replayedValue: state.value.toString(),
      chainValue: chainValue.toString(),
      excess: (-difference).toString(),
    },
  );
}

/**
 * Check events against the digest the archive published for the same range.
 *
 * This is the check that catches a provider withholding, reordering or altering
 * history — before any of it reaches a balance.
 */
export function verifyEventIntegrity(
  events: readonly ConfidentialEvent[],
  digest: RangeDigest,
  sourceId: string,
): void {
  const problems = verifyAgainstDigest(events, digest);
  if (problems.length === 0) return;

  throw new RecoveryError('INTEGRITY_FAILURE', 'events do not match the digest the archive published', {
    source: sourceId,
    problems: problems.map((problem) => problem.kind).join(','),
    expectedCount: digest.eventCount,
    actualCount: events.length,
    expectedRoot: digest.merkleRoot,
  });
}
