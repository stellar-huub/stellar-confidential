import { randomBytes } from '@noble/hashes/utils.js';
import { CryptoError, type EncryptedLimb } from '@stellar-confidential/core';
import { G, GROUP_ORDER, IDENTITY, type Point, pointFromHex, pointToHex, scalarMultiply } from './group.js';
import type { ViewingKey, ViewingPublicKey } from './keys.js';

/**
 * Twisted ElGamal over ristretto255.
 *
 *   encrypt(m, r) = ( C = m·G + r·P ,  D = r·G )     where P = sk·G
 *   decrypt(C, D) = C − sk·D = m·G
 *
 * The scheme is additively homomorphic in both components, which is what makes
 * confidential balances work at all: a balance is the sum of the ciphertexts of
 * every event that touched it, and summing never needs a key.
 *
 * NOTE (M1.1 / M2.1): this is the classical construction that Confidential Token
 * designs are built on, and it is what the rest of this project is tested
 * against. Reconciling parameters and encodings with the canonical Stellar
 * Confidential Token contract is tracked as an open item in docs/events.md.
 */

/** Source of encryption randomness. Injectable so tests can be deterministic. */
export type RandomScalar = () => bigint;

export const defaultRandomScalar: RandomScalar = () => {
  // Rejection-free: 64 bytes reduced mod the order has negligible bias.
  let acc = 0n;
  for (const byte of randomBytes(64)) acc = (acc << 8n) | BigInt(byte);
  const scalar = acc % GROUP_ORDER;
  return scalar === 0n ? 1n : scalar;
};

/** Deterministic randomness for tests and reproducible vectors. Never use in production. */
export function seededRandomScalar(seed: bigint): RandomScalar {
  let state = seed === 0n ? 1n : seed;
  return () => {
    // xorshift-style advance in the scalar field; deterministic and non-zero.
    state = (state * 6364136223846793005n + 1442695040888963407n) % GROUP_ORDER;
    return state === 0n ? 1n : state;
  };
}

export interface DecodedLimb {
  readonly commitment: Point;
  readonly handle: Point;
}

export function decodeLimb(limb: EncryptedLimb): DecodedLimb {
  return { commitment: pointFromHex(limb.commitment), handle: pointFromHex(limb.handle) };
}

export function encodeLimb(limb: DecodedLimb): EncryptedLimb {
  return { commitment: pointToHex(limb.commitment), handle: pointToHex(limb.handle) };
}

/** The ciphertext of zero with zero randomness. The identity for accumulation. */
export const LIMB_IDENTITY: EncryptedLimb = {
  commitment: pointToHex(IDENTITY),
  handle: pointToHex(IDENTITY),
};

export function encryptLimb(
  value: bigint,
  recipient: ViewingKey | ViewingPublicKey,
  random: RandomScalar = defaultRandomScalar,
): EncryptedLimb {
  if (value < 0n) {
    throw new CryptoError('AMOUNT_OUT_OF_RANGE', 'limb value must be non-negative', {
      value: value.toString(),
    });
  }
  const publicKey = pointFromHex(recipient.publicKey);
  const r = random();
  return encodeLimb({
    commitment: scalarMultiply(G, value).add(scalarMultiply(publicKey, r)),
    handle: scalarMultiply(G, r),
  });
}

/** Recover `m · G` without solving for m. O(1) — the basis of cheap verification. */
export function unmaskLimb(limb: EncryptedLimb, key: ViewingKey): Point {
  const { commitment, handle } = decodeLimb(limb);
  return commitment.subtract(scalarMultiply(handle, key.scalar));
}

export function addLimbs(a: EncryptedLimb, b: EncryptedLimb): EncryptedLimb {
  const x = decodeLimb(a);
  const y = decodeLimb(b);
  return encodeLimb({
    commitment: x.commitment.add(y.commitment),
    handle: x.handle.add(y.handle),
  });
}

export function subtractLimbs(a: EncryptedLimb, b: EncryptedLimb): EncryptedLimb {
  const x = decodeLimb(a);
  const y = decodeLimb(b);
  return encodeLimb({
    commitment: x.commitment.subtract(y.commitment),
    handle: x.handle.subtract(y.handle),
  });
}

export function limbsEqual(a: EncryptedLimb, b: EncryptedLimb): boolean {
  return a.commitment === b.commitment && a.handle === b.handle;
}
