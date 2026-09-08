import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes } from '@noble/hashes/utils.js';
import { TEST_VECTORS } from '../src/vectors.js';
import { deriveKeyset } from '../src/keys.js';
import { decryptAmount, encryptAmount, verifyAmount } from '../src/amount.js';
import { seededRandomScalar } from '../src/elgamal.js';

describe('frozen test vectors', () => {
  it('has vectors to check', () => {
    assert.ok(TEST_VECTORS.length >= 7);
  });

  for (const vector of TEST_VECTORS) {
    describe(vector.name, () => {
      const keyset = deriveKeyset(hexToBytes(vector.seed));
      const expected = BigInt(vector.amount);

      it('derives the recorded public keys', () => {
        assert.equal(keyset.spend.publicKey, vector.spendPublicKey);
        assert.equal(keyset.viewing.publicKey, vector.viewingPublicKey);
      });

      it('verifies the recorded ciphertext against the recorded amount', () => {
        assert.equal(verifyAmount(vector.ciphertext, keyset.viewing, expected), true);
      });

      it('re-encrypts to exactly the recorded ciphertext', () => {
        // Catches any change to limb layout, point encoding or randomness derivation.
        const reencrypted = encryptAmount(
          expected,
          keyset.viewing,
          seededRandomScalar(BigInt(vector.randomSeed)),
        );
        assert.deepEqual(reencrypted, vector.ciphertext);
      });

      it('decrypts back to the recorded amount', () => {
        // A freshly encrypted amount always has limbs below 2^16, so the narrow
        // default bound is sufficient even for a near-max-u64 total.
        assert.equal(decryptAmount(vector.ciphertext, keyset.viewing), expected);
      });
    });
  }
});
