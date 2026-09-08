import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { CryptoError } from '@stellar-confidential/core';
import {
  deriveKeyset,
  deriveSpendKey,
  deriveViewingKey,
  publicViewingKey,
  sign,
  verifySignature,
} from '../src/keys.js';
import { encryptAmount, decryptAmount } from '../src/amount.js';
import { seededRandomScalar } from '../src/elgamal.js';

const seed = hexToBytes('11'.repeat(32));

describe('key derivation', () => {
  it('is deterministic', () => {
    const a = deriveKeyset(seed);
    const b = deriveKeyset(seed);
    assert.equal(a.spend.publicKey, b.spend.publicKey);
    assert.equal(a.viewing.publicKey, b.viewing.publicKey);
    assert.equal(a.viewing.scalar, b.viewing.scalar);
  });

  it('gives different seeds different keys', () => {
    const other = deriveKeyset(hexToBytes('22'.repeat(32)));
    assert.notEqual(deriveKeyset(seed).viewing.publicKey, other.viewing.publicKey);
  });

  it('rejects a seed of the wrong length', () => {
    assert.throws(() => deriveSpendKey(new Uint8Array(16)), CryptoError);
    assert.throws(() => deriveViewingKey(new Uint8Array(64)), CryptoError);
  });
});

describe('viewing/spending separation (invariant 2)', () => {
  const keyset = deriveKeyset(seed);

  it('derives spend and viewing material that share no bytes', () => {
    const viewingBytes = keyset.viewing.scalar.toString(16).padStart(64, '0');
    const spendBytes = Buffer.from(keyset.spend.secret).toString('hex');
    assert.notEqual(viewingBytes, spendBytes);
    // The public halves are different curves' encodings of unrelated secrets.
    assert.notEqual(keyset.viewing.publicKey, keyset.spend.publicKey);
  });

  it('lets a viewing key read amounts', () => {
    const ciphertext = encryptAmount(4_200n, keyset.viewing, seededRandomScalar(9n));
    assert.equal(decryptAmount(ciphertext, keyset.viewing), 4_200n);
  });

  it('offers no way to sign with a viewing key', () => {
    // The type system already forbids this; assert it at runtime too, because a
    // future `as any` in calling code must not find a working path here.
    const asUnknown = keyset.viewing as unknown as Record<string, unknown>;
    assert.equal(asUnknown['secret'], undefined);
    assert.equal(asUnknown['sign'], undefined);
    // The exported public viewing key carries no secret at all.
    const shared = publicViewingKey(keyset.viewing);
    assert.deepEqual(Object.keys(shared).sort(), ['kind', 'publicKey']);
    assert.equal((shared as unknown as Record<string, unknown>)['scalar'], undefined);
  });

  it('produces signatures only from the spend key, and they verify', () => {
    const message = utf8ToBytes('authorise this transfer');
    const signature = sign(keyset.spend, message);
    assert.equal(verifySignature(keyset.spend.publicKey, message, signature), true);
    // A signature does not verify against the viewing public key.
    assert.equal(verifySignature(keyset.viewing.publicKey, message, signature), false);
    assert.equal(verifySignature(keyset.spend.publicKey, utf8ToBytes('other'), signature), false);
  });

  it('cannot recover a spend key from everything a viewing grant exposes', () => {
    // Everything an auditor could receive under a disclosure.
    const disclosed = JSON.stringify({
      viewing: { scalar: keyset.viewing.scalar.toString(16), publicKey: keyset.viewing.publicKey },
      account: keyset.spend.publicKey,
    });
    const spendSecret = Buffer.from(keyset.spend.secret).toString('hex');
    assert.equal(disclosed.includes(spendSecret), false);
  });
});
