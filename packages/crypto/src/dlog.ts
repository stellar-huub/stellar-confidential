import { CryptoError } from '@stellar-confidential/core';
import { G, IDENTITY, type Point, pointToHex, scalarMultiply } from './group.js';

/**
 * Bounded discrete logarithm by baby-step giant-step.
 *
 * Decrypting a twisted ElGamal ciphertext recovers `m * G`, not `m`. Recovering
 * `m` means solving a discrete log, which is only tractable because confidential
 * amounts are carried in narrow limbs (see amount.ts). BSGS costs O(sqrt(bound))
 * time and O(sqrt(bound)) memory instead of O(bound).
 *
 * The search is symmetric around zero. Subtracting a debit from a balance can
 * drive an individual limb negative even when the total stays positive, so the
 * solver must be able to return a negative value rather than fail.
 *
 * Tables are cached by bound and shared across calls — building one is the
 * expensive part, and a process typically uses one or two bounds forever.
 */

/**
 * Baby-step table size.
 *
 * Textbook BSGS picks sqrt(bound) baby steps to minimise the work of a *single*
 * lookup. That is the wrong trade here: the table is built once and cached for
 * the life of the process, while giant steps are paid on every limb of every
 * event. Each giant step costs a point compression (a field inversion), which
 * dominates everything else, so the table is skewed deliberately large to make
 * lookups cheap.
 *
 * At 8192 entries a 16-bit limb — the size every freshly encrypted amount has —
 * resolves in at most 8 giant steps instead of 256.
 *
 * Measured on the reference desktop (scripts/benchmark.ts): a point compression
 * costs ~295us and a scalar multiplication ~5.8ms, so the table costs ~1.4s to
 * build once and each lookup ~2.4ms thereafter. That is the right balance from
 * roughly a hundred events upward, which is the case that matters; below that
 * the build dominates and a smaller table would win. Callers that know their
 * workload can override `tableSize`.
 *
 * The table costs roughly 800KB, affordable on a phone, and is shared by every
 * bound that reaches this size. Reducing the scalar-multiplication cost — the
 * larger term — is milestone M6.1 work and wants WebAssembly, not tuning.
 */
export const DEFAULT_TABLE_SIZE = 8_192;

const tableCache = new Map<number, Map<string, number>>();

function babyStepTable(babySteps: number): Map<string, number> {
  const cached = tableCache.get(babySteps);
  if (cached) return cached;

  const table = new Map<string, number>();
  let current: Point = IDENTITY;
  for (let j = 0; j < babySteps; j += 1) {
    table.set(pointToHex(current), j);
    current = current.add(G);
  }
  tableCache.set(babySteps, table);
  return table;
}

/** Drop cached tables. Exposed for memory-constrained hosts and for benchmarks. */
export function clearDlogCache(): void {
  tableCache.clear();
}

export interface DlogOptions {
  /** Search bound. */
  readonly maxAbs: number;
  /**
   * Baby-step table size. Larger means a costlier one-time build and cheaper
   * lookups thereafter.
   */
  readonly tableSize?: number;
  /**
   * Search negative values too. Accumulated balances need this — subtracting a
   * debit can drive an individual limb below zero — but a freshly encrypted
   * amount never can, and skipping it halves the work.
   */
  readonly allowNegative?: boolean;
}

/**
 * Solve `target = m * G` for m with |m| <= maxAbs.
 *
 * Returns null when no such m exists — the caller decides whether that means a
 * wrong key, an out-of-range amount, or a corrupt ciphertext, because from here
 * those are indistinguishable.
 */
export function solveDlog(target: Point, options: DlogOptions): bigint | null {
  const { maxAbs } = options;
  if (!Number.isInteger(maxAbs) || maxAbs < 1) {
    throw new CryptoError('DECRYPT_OUT_OF_RANGE', 'maxAbs must be a positive integer', { maxAbs });
  }

  if (target.is0()) return 0n;

  const allowNegative = options.allowNegative ?? true;
  const babySteps = Math.min(maxAbs + 1, options.tableSize ?? DEFAULT_TABLE_SIZE);
  const table = babyStepTable(babySteps);
  const stride = scalarMultiply(G, BigInt(babySteps)).negate();

  // Walk giant steps for +m and -m together: negating a candidate is nearly free
  // next to the point compression each lookup already costs.
  let positive: Point = target;
  let negative: Point | null = allowNegative ? target.negate() : null;

  const giantSteps = Math.ceil((maxAbs + 1) / babySteps);
  for (let i = 0; i <= giantSteps; i += 1) {
    const hit = table.get(pointToHex(positive));
    if (hit !== undefined) {
      const value = BigInt(i) * BigInt(babySteps) + BigInt(hit);
      if (value <= BigInt(maxAbs)) return value;
    }
    if (negative !== null) {
      const negativeHit = table.get(pointToHex(negative));
      if (negativeHit !== undefined) {
        const value = BigInt(i) * BigInt(babySteps) + BigInt(negativeHit);
        if (value <= BigInt(maxAbs)) return -value;
      }
      negative = negative.add(stride);
    }
    positive = positive.add(stride);
  }

  return null;
}
