import { CryptoError, type EncryptedAmount, type EncryptedLimb } from '@stellar-confidential/core';
import { G, IDENTITY, scalarMultiply } from './group.js';
import { solveDlog } from './dlog.js';
import {
  LIMB_IDENTITY,
  addLimbs,
  decodeLimb,
  defaultRandomScalar,
  encryptLimb,
  limbsEqual,
  subtractLimbs,
  unmaskLimb,
  type RandomScalar,
} from './elgamal.js';
import type { ViewingKey, ViewingPublicKey } from './keys.js';

/**
 * Amounts as limbed ciphertexts.
 *
 * A 64-bit amount is split into four 16-bit limbs, little-endian, and each limb
 * is encrypted separately:
 *
 *     m = l0 + l1·2^16 + l2·2^32 + l3·2^48
 *
 * Why limbs at all: decryption is a discrete-log search, and its cost grows with
 * the square root of the value range. Searching 2^64 is impossible; searching
 * 2^16 four times is microseconds. This is what lets a phone decrypt its history
 * event by event (milestone M6.1) rather than only on a server.
 *
 * Limbs stay aligned under homomorphic addition, and a limb is allowed to run
 * outside [0, 2^16) once balances accumulate — that is expected, and is why
 * decryption takes a wider bound than encryption and why the solver is signed.
 * A `rollover` event re-encrypts a balance back into canonical limbs.
 */

export const LIMB_BITS = 16;
export const LIMB_COUNT = 4;
export const LIMB_BASE = 1n << BigInt(LIMB_BITS);
export const MAX_AMOUNT = (1n << BigInt(LIMB_BITS * LIMB_COUNT)) - 1n;

/** Search bound for a single freshly encrypted limb. */
export const DEFAULT_LIMB_BOUND = Number(LIMB_BASE);
/**
 * Search bound for an accumulated balance limb. 2^24 tolerates ~256 full-width
 * limb additions before a rollover is required, and keeps a worst-case decrypt
 * in the low milliseconds.
 */
export const DEFAULT_BALANCE_BOUND = 1 << 24;

/** The encrypted zero. Replay starts every balance here. */
export const ZERO_AMOUNT: EncryptedAmount = {
  limbs: Array.from({ length: LIMB_COUNT }, () => LIMB_IDENTITY),
};

export function splitLimbs(value: bigint): bigint[] {
  if (value < 0n || value > MAX_AMOUNT) {
    throw new CryptoError('AMOUNT_OUT_OF_RANGE', 'amount does not fit in 64 bits', {
      value: value.toString(),
    });
  }
  const limbs: bigint[] = [];
  let remaining = value;
  for (let i = 0; i < LIMB_COUNT; i += 1) {
    limbs.push(remaining % LIMB_BASE);
    remaining /= LIMB_BASE;
  }
  return limbs;
}

export function joinLimbs(limbs: readonly bigint[]): bigint {
  let value = 0n;
  for (let i = limbs.length - 1; i >= 0; i -= 1) {
    value = value * LIMB_BASE + (limbs[i] as bigint);
  }
  return value;
}

function assertAligned(a: EncryptedAmount, b: EncryptedAmount): void {
  if (a.limbs.length !== b.limbs.length) {
    throw new CryptoError('LIMB_MISMATCH', 'ciphertexts have different limb counts', {
      left: a.limbs.length,
      right: b.limbs.length,
    });
  }
}

export function encryptAmount(
  value: bigint,
  recipient: ViewingKey | ViewingPublicKey,
  random: RandomScalar = defaultRandomScalar,
): EncryptedAmount {
  return { limbs: splitLimbs(value).map((limb) => encryptLimb(limb, recipient, random)) };
}

export function addAmounts(a: EncryptedAmount, b: EncryptedAmount): EncryptedAmount {
  assertAligned(a, b);
  return { limbs: a.limbs.map((limb, i) => addLimbs(limb, b.limbs[i] as EncryptedLimb)) };
}

export function subtractAmounts(a: EncryptedAmount, b: EncryptedAmount): EncryptedAmount {
  assertAligned(a, b);
  return { limbs: a.limbs.map((limb, i) => subtractLimbs(limb, b.limbs[i] as EncryptedLimb)) };
}

export function amountsEqual(a: EncryptedAmount, b: EncryptedAmount): boolean {
  if (a.limbs.length !== b.limbs.length) return false;
  return a.limbs.every((limb, i) => limbsEqual(limb, b.limbs[i] as EncryptedLimb));
}

export interface DecryptOptions {
  /** Per-limb search bound. Raise it for accumulated balances. */
  readonly maxAbsLimb?: number;
  /** Baby-step table size; see DEFAULT_TABLE_SIZE. */
  readonly tableSize?: number;
  /**
   * Allow negative limb values. Required for accumulated balances, unnecessary
   * for a freshly encrypted amount, and skipping it halves decryption cost.
   */
  readonly allowNegative?: boolean;
}

/**
 * Decrypt to a plaintext amount.
 *
 * Throws rather than guessing when a limb falls outside the search bound: a
 * wrong viewing key and an over-accumulated limb both land here, and returning
 * a plausible-looking number for either would violate invariant 3.
 */
export function decryptAmount(
  amount: EncryptedAmount,
  key: ViewingKey,
  options: DecryptOptions = {},
): bigint {
  const maxAbs = options.maxAbsLimb ?? DEFAULT_LIMB_BOUND;
  const limbs: bigint[] = [];
  for (let i = 0; i < amount.limbs.length; i += 1) {
    const point = unmaskLimb(amount.limbs[i] as EncryptedLimb, key);
    const solved = solveDlog(point, {
      maxAbs,
      ...(options.tableSize === undefined ? {} : { tableSize: options.tableSize }),
      ...(options.allowNegative === undefined ? {} : { allowNegative: options.allowNegative }),
    });
    if (solved === null) {
      throw new CryptoError(
        'DECRYPT_OUT_OF_RANGE',
        'limb did not decrypt within the search bound: wrong viewing key, or the balance needs a rollover',
        { limbIndex: i, maxAbs },
      );
    }
    limbs.push(solved);
  }
  return joinLimbs(limbs);
}

/**
 * Check a ciphertext against a known plaintext without solving any discrete log.
 *
 * Constant work regardless of magnitude, so this is the right tool for verifying
 * a reconstructed balance against the chain (milestone M2.3), where the expected
 * value is already known from replay.
 *
 * The check recombines the limbs by weight rather than comparing them one by
 * one:
 *
 *     sum_i 2^(16i) * unmask(limb_i)  ==  expected * G
 *
 * That distinction matters. Comparing limbs individually only works when the
 * ciphertext is in canonical form, and an accumulated balance is not: adding
 * ciphertexts adds limbs without propagating carries, so a balance of 275,612
 * can be held as limbs that no `splitLimbs(275612)` would ever produce. The
 * weighted sum is invariant to how the value is distributed across limbs, so it
 * verifies a freshly encrypted amount and a long-accumulated balance alike.
 */
export function verifyAmount(amount: EncryptedAmount, key: ViewingKey, expected: bigint): boolean {
  if (expected < 0n) return false;

  let combined = IDENTITY;
  let weight = 1n;
  for (const limb of amount.limbs) {
    combined = combined.add(scalarMultiply(unmaskLimb(limb, key), weight));
    weight *= LIMB_BASE;
  }
  return combined.equals(scalarMultiply(G, expected));
}

/**
 * Re-encrypt a balance into canonical limbs.
 *
 * This is what a `rollover` event does on chain: the value is unchanged, the
 * representation is renormalised so limbs return to [0, 2^16) and decryption
 * stays cheap.
 */
export function rolloverAmount(
  amount: EncryptedAmount,
  key: ViewingKey,
  random: RandomScalar = defaultRandomScalar,
): EncryptedAmount {
  const value = decryptAmount(amount, key, { maxAbsLimb: DEFAULT_BALANCE_BOUND });
  if (value < 0n) {
    throw new CryptoError('AMOUNT_OUT_OF_RANGE', 'cannot roll over a negative balance', {
      value: value.toString(),
    });
  }
  return encryptAmount(value, key, random);
}

/** True when every limb is a well-formed group element. */
export function isWellFormedAmount(amount: EncryptedAmount): boolean {
  try {
    amount.limbs.forEach((limb) => decodeLimb(limb));
    return amount.limbs.length === LIMB_COUNT;
  } catch {
    return false;
  }
}
