import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { CryptoError } from '@stellar-confidential/core';
import { G, GROUP_ORDER, pointToHex, scalarMultiply } from './group.js';

/**
 * Key derivation, and the separation between viewing and spending (invariant 2).
 *
 * One seed derives two independent keys through HKDF with distinct info labels:
 *
 *   seed ──HKDF("…/spend/v1")──▶ ed25519 signing key   → authorises transactions
 *        └─HKDF("…/view/v1")──▶ ristretto scalar      → decrypts amounts
 *
 * Because HKDF is a one-way function and the labels differ, holding the viewing
 * key reveals nothing about the spend key. An auditor granted a viewing key can
 * read the amounts they were granted and cannot move funds — the separation is
 * arithmetic, not policy.
 *
 * The types below carry this in the type system too: `ViewingKey` has no path to
 * a signature, and `sign` accepts only a `SpendKey`.
 */

const SPEND_INFO = utf8ToBytes('stellar-confidential/spend/v1');
const VIEW_INFO = utf8ToBytes('stellar-confidential/view/v1');
const SALT = utf8ToBytes('stellar-confidential/hkdf-salt/v1');

export const SEED_LENGTH = 32;

/** Authorises spending. Never leaves the client. */
export interface SpendKey {
  readonly kind: 'spend';
  readonly secret: Uint8Array;
  /** ed25519 public key, hex. The on-chain account identity. */
  readonly publicKey: string;
}

/** Decrypts amounts. Safe to delegate to an auditor within a disclosure scope. */
export interface ViewingKey {
  readonly kind: 'viewing';
  /** Ristretto scalar. Secret, but grants reading only. */
  readonly scalar: bigint;
  /** Encryption target, hex-encoded ristretto point (scalar * G). */
  readonly publicKey: string;
}

/** The public half of a viewing key. Anyone may hold this; it encrypts, it cannot decrypt. */
export interface ViewingPublicKey {
  readonly kind: 'viewing-public';
  readonly publicKey: string;
}

export interface ConfidentialKeyset {
  readonly spend: SpendKey;
  readonly viewing: ViewingKey;
}

function assertSeed(seed: Uint8Array): void {
  if (seed.length !== SEED_LENGTH) {
    throw new CryptoError('INVALID_KEY_MATERIAL', `seed must be ${SEED_LENGTH} bytes`, {
      length: seed.length,
    });
  }
}

export function deriveSpendKey(seed: Uint8Array): SpendKey {
  assertSeed(seed);
  const secret = hkdf(sha512, seed, SALT, SPEND_INFO, 32);
  return {
    kind: 'spend',
    secret,
    publicKey: bytesToHex(ed25519.getPublicKey(secret)),
  };
}

export function deriveViewingKey(seed: Uint8Array): ViewingKey {
  assertSeed(seed);
  // 64 bytes reduced mod the group order: the modulo bias of taking 512 bits
  // into a 253-bit field is negligible, and this is the standard construction.
  const wide = hkdf(sha512, seed, SALT, VIEW_INFO, 64);
  let acc = 0n;
  for (const byte of wide) acc = (acc << 8n) | BigInt(byte);
  const scalar = acc % GROUP_ORDER;
  if (scalar === 0n) {
    throw new CryptoError('INVALID_KEY_MATERIAL', 'derived viewing scalar is zero');
  }
  return { kind: 'viewing', scalar, publicKey: pointToHex(scalarMultiply(G, scalar)) };
}

export function deriveKeyset(seed: Uint8Array): ConfidentialKeyset {
  return { spend: deriveSpendKey(seed), viewing: deriveViewingKey(seed) };
}

/** Strip a viewing key down to the half that only encrypts. */
export function publicViewingKey(key: ViewingKey | ViewingPublicKey): ViewingPublicKey {
  return { kind: 'viewing-public', publicKey: key.publicKey };
}

/**
 * Sign with the spend key.
 *
 * Deliberately the only signing entry point in this package, and deliberately
 * unable to accept a ViewingKey. If you find yourself wanting to widen this
 * signature, you are about to break invariant 2.
 */
export function sign(key: SpendKey, message: Uint8Array): string {
  return bytesToHex(ed25519.sign(message, key.secret));
}

export function verifySignature(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    return ed25519.verify(hexToBytes(signature), message, hexToBytes(publicKey));
  } catch {
    return false;
  }
}
