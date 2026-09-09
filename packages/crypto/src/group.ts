import { RistrettoPoint } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { CryptoError } from '@stellar-confidential/core';

/**
 * Group arithmetic used by the confidential amount scheme.
 *
 * Ristretto255 is chosen because it is a prime-order group: there is no cofactor
 * and no small-subgroup class of bugs, so a decoded point is always a valid
 * group element. Every ciphertext this package produces is a pair of compressed
 * ristretto points, hex encoded, which is what travels in ConfidentialEvent.
 */

export type Point = InstanceType<typeof RistrettoPoint>;

export const G: Point = RistrettoPoint.BASE;
export const IDENTITY: Point = RistrettoPoint.ZERO;
/** Order of the group; all scalars are reduced modulo this. */
export const GROUP_ORDER: bigint = RistrettoPoint.Fn.ORDER;

export function pointToHex(point: Point): string {
  return bytesToHex(point.toBytes());
}

export function pointFromHex(hex: string): Point {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new CryptoError('INVALID_POINT', 'point must be 32 hex-encoded bytes', {
      length: hex.length,
    });
  }
  try {
    return RistrettoPoint.fromBytes(hexToBytes(hex.toLowerCase()));
  } catch (cause) {
    throw new CryptoError('INVALID_POINT', 'not a canonical ristretto255 point', {
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** Reduce arbitrary integer input into the scalar field, rejecting zero. */
export function toScalar(value: bigint): bigint {
  const reduced = ((value % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
  if (reduced === 0n) {
    throw new CryptoError('INVALID_SCALAR', 'scalar reduced to zero');
  }
  return reduced;
}

/** Scalar multiplication that tolerates zero and negative exponents. */
export function scalarMultiply(point: Point, scalar: bigint): Point {
  const reduced = ((scalar % GROUP_ORDER) + GROUP_ORDER) % GROUP_ORDER;
  return reduced === 0n ? IDENTITY : point.multiply(reduced);
}
