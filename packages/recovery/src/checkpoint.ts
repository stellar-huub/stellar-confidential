import { RecoveryError, type EncryptedAmount } from '@stellar-confidential/core';
import type { ReplayState } from './replay.js';

/**
 * Replay checkpoints (milestone M2.2).
 *
 * Resuming from a checkpoint must produce exactly the state a full replay would.
 * A checkpoint therefore carries the running digest as well as the balance: on
 * resume, continuing the digest chain from the recorded value means the final
 * digest matches a full replay's, and any divergence is detectable rather than
 * merely improbable.
 *
 * A checkpoint contains a ciphertext balance and a plaintext balance, so it is
 * as sensitive as the wallet itself. It is written to local storage on the
 * user's device, never to an archive.
 */

export const CHECKPOINT_VERSION = 1;

export interface ReplayCheckpoint {
  readonly version: number;
  readonly account: string;
  readonly cursor: string;
  readonly balance: EncryptedAmount;
  readonly value: string;
  readonly eventCount: number;
  readonly lastLedgerSequence: number | null;
  readonly digest: string;
}

export function toCheckpoint(state: ReplayState): ReplayCheckpoint {
  if (state.lastCursor === null) {
    throw new RecoveryError('CHECKPOINT_MISMATCH', 'cannot checkpoint a state with no events', {
      account: state.account,
    });
  }
  return {
    version: CHECKPOINT_VERSION,
    account: state.account,
    cursor: state.lastCursor,
    balance: state.balance,
    value: state.value.toString(),
    eventCount: state.eventCount,
    lastLedgerSequence: state.lastLedgerSequence,
    digest: state.digest,
  };
}

/**
 * Rebuild replay state from a checkpoint.
 *
 * History is not restored: a checkpoint commits to a balance, not to the entries
 * that produced it. Callers that need history re-fetch it, which is why
 * `history` comes back empty rather than as a plausible-looking partial list.
 */
export function fromCheckpoint(checkpoint: ReplayCheckpoint): ReplayState {
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new RecoveryError('CHECKPOINT_MISMATCH', 'unsupported checkpoint version', {
      found: checkpoint.version,
      supported: CHECKPOINT_VERSION,
    });
  }
  return {
    account: checkpoint.account,
    balance: checkpoint.balance,
    value: BigInt(checkpoint.value),
    eventCount: checkpoint.eventCount,
    lastCursor: checkpoint.cursor,
    lastLedgerSequence: checkpoint.lastLedgerSequence,
    digest: checkpoint.digest,
    history: [],
  };
}
