import { hexToBytes } from '@noble/hashes/utils.js';
import { encodeCursor, type ConfidentialEvent, type EncryptedAmount } from '@stellar-confidential/core';
import {
  ZERO_AMOUNT,
  addAmounts,
  deriveKeyset,
  encryptAmount,
  seededRandomScalar,
  subtractAmounts,
  type ConfidentialKeyset,
} from '@stellar-confidential/crypto';

/**
 * Fixtures built with the real cryptography.
 *
 * Recovery tests use genuine ciphertexts rather than placeholders: the replay
 * engine's correctness is inseparable from the homomorphic arithmetic, and a
 * stubbed amount would test neither.
 */

export const ALICE = 'GALICE';
export const BOB = 'GBOB';
export const CONTRACT = 'CCONFIDENTIAL';

export const aliceKeys: ConfidentialKeyset = deriveKeyset(hexToBytes('a1'.repeat(32)));
export const bobKeys: ConfidentialKeyset = deriveKeyset(hexToBytes('b2'.repeat(32)));

export const rng = seededRandomScalar(987_654_321n);

export interface Movement {
  readonly delta: 'credit' | 'debit' | 'replace' | 'none';
  readonly value: bigint;
  readonly type?: ConfidentialEvent['type'];
}

export interface BuiltHistory {
  readonly events: readonly ConfidentialEvent[];
  /** The balance the chain would hold: the homomorphic sum of the same ciphertexts. */
  readonly chainBalance: EncryptedAmount;
  readonly expectedValue: bigint;
  readonly latestLedger: number;
}

/** Build an event history for `account`, encrypted to `keys`. */
export function buildHistory(
  account: string,
  keys: ConfidentialKeyset,
  movements: readonly Movement[],
  options: { startLedger?: number } = {},
): BuiltHistory {
  const startLedger = options.startLedger ?? 1;
  const events: ConfidentialEvent[] = [];
  let chainBalance: EncryptedAmount = ZERO_AMOUNT;
  let expectedValue = 0n;
  let ledger = startLedger;

  for (const movement of movements) {
    const amount =
      movement.delta === 'none' ? null : encryptAmount(movement.value, keys.viewing, rng);

    if (amount !== null) {
      if (movement.delta === 'credit') {
        chainBalance = addAmounts(chainBalance, amount);
        expectedValue += movement.value;
      } else if (movement.delta === 'debit') {
        chainBalance = subtractAmounts(chainBalance, amount);
        expectedValue -= movement.value;
      } else {
        chainBalance = amount;
        expectedValue = movement.value;
      }
    }

    const cursor = encodeCursor({ ledgerSequence: ledger, txIndex: 1, opIndex: 0, eventIndex: 0 });
    const defaultType: ConfidentialEvent['type'] =
      movement.delta === 'credit'
        ? 'deposit'
        : movement.delta === 'debit'
          ? 'transfer'
          : movement.delta === 'replace'
            ? 'rollover'
            : 'disclosure';

    events.push({
      id: cursor,
      cursor,
      type: movement.type ?? defaultType,
      contractId: CONTRACT,
      account,
      counterparty: movement.delta === 'debit' ? BOB : null,
      delta: movement.delta,
      amount,
      publicAmount: null,
      proof: {
        ledgerSequence: ledger,
        ledgerHash: `hash-${ledger}`,
        ledgerCloseTime: 1_700_000_000 + ledger * 5,
        txHash: `tx-${ledger}`,
        txIndex: 1,
        opIndex: 0,
        eventIndex: 0,
      },
      raw: null,
    });

    ledger += 1;
  }

  return { events, chainBalance, expectedValue, latestLedger: ledger - 1 };
}

/** A payroll-shaped history: many credits, occasional spends. */
export function payrollHistory(count: number): BuiltHistory {
  const movements: Movement[] = [];
  for (let i = 1; i <= count; i += 1) {
    movements.push({ delta: 'credit', value: BigInt(1_000 + (i % 7) * 137) });
    if (i % 5 === 0) movements.push({ delta: 'debit', value: 500n });
  }
  return buildHistory(ALICE, aliceKeys, movements);
}
