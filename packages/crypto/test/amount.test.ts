import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes } from '@noble/hashes/utils.js';
import { CryptoError } from '@stellar-confidential/core';
import { deriveKeyset } from '../src/keys.js';
import {
  DEFAULT_BALANCE_BOUND,
  MAX_AMOUNT,
  ZERO_AMOUNT,
  addAmounts,
  amountsEqual,
  decryptAmount,
  encryptAmount,
  isWellFormedAmount,
  joinLimbs,
  rolloverAmount,
  splitLimbs,
  subtractAmounts,
  verifyAmount,
} from '../src/amount.js';
import { seededRandomScalar } from '../src/elgamal.js';

const keyset = deriveKeyset(hexToBytes('33'.repeat(32)));
const viewing = keyset.viewing;
const rng = seededRandomScalar(1234n);

describe('limb layout', () => {
  it('round-trips through split and join', () => {
    for (const value of [0n, 1n, 65_535n, 65_536n, 4_294_967_296n, MAX_AMOUNT]) {
      assert.equal(joinLimbs(splitLimbs(value)), value, `failed for ${value}`);
    }
  });

  it('rejects values that do not fit 64 bits', () => {
    assert.throws(() => splitLimbs(-1n), CryptoError);
    assert.throws(() => splitLimbs(MAX_AMOUNT + 1n), CryptoError);
  });
});

describe('encrypt/decrypt', () => {
  it('round-trips across the range', () => {
    for (const value of [0n, 1n, 42n, 65_535n, 65_536n, 1_000_000_000n, MAX_AMOUNT]) {
      const ciphertext = encryptAmount(value, viewing, rng);
      assert.equal(decryptAmount(ciphertext, viewing), value, `failed for ${value}`);
    }
  });

  it('produces different ciphertexts for the same amount', () => {
    // Semantic security: repeated payroll amounts must not be linkable.
    const a = encryptAmount(1_000n, viewing, rng);
    const b = encryptAmount(1_000n, viewing, rng);
    assert.equal(amountsEqual(a, b), false);
    assert.equal(decryptAmount(a, viewing), decryptAmount(b, viewing));
  });

  it('encrypts to a public viewing key the holder can read', () => {
    const ciphertext = encryptAmount(777n, { kind: 'viewing-public', publicKey: viewing.publicKey }, rng);
    assert.equal(decryptAmount(ciphertext, viewing), 777n);
  });

  it('refuses to guess when the key is wrong', () => {
    const other = deriveKeyset(hexToBytes('44'.repeat(32))).viewing;
    const ciphertext = encryptAmount(500n, viewing, rng);
    // Invariant 3: an error, never a plausible wrong number.
    assert.throws(() => decryptAmount(ciphertext, other), (error: unknown) => {
      assert.ok(error instanceof CryptoError);
      assert.equal(error.code, 'DECRYPT_OUT_OF_RANGE');
      return true;
    });
  });

  it('rejects malformed ciphertexts', () => {
    assert.equal(isWellFormedAmount({ limbs: [{ commitment: 'zz', handle: 'zz' }] }), false);
    assert.equal(isWellFormedAmount(encryptAmount(1n, viewing, rng)), true);
  });
});

describe('homomorphic accumulation', () => {
  it('adds without a key', () => {
    const a = encryptAmount(300n, viewing, rng);
    const b = encryptAmount(45n, viewing, rng);
    assert.equal(decryptAmount(addAmounts(a, b), viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }), 345n);
  });

  it('subtracts without a key', () => {
    const a = encryptAmount(1_000n, viewing, rng);
    const b = encryptAmount(250n, viewing, rng);
    assert.equal(
      decryptAmount(subtractAmounts(a, b), viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }),
      750n,
    );
  });

  it('handles a borrow across limbs', () => {
    // 65536 - 1 drives limb 0 negative and limb 1 positive. The signed solver
    // must reassemble that into 65535 rather than fail.
    const a = encryptAmount(65_536n, viewing, rng);
    const b = encryptAmount(1n, viewing, rng);
    assert.equal(
      decryptAmount(subtractAmounts(a, b), viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }),
      65_535n,
    );
  });

  it('starts from an encrypted zero', () => {
    assert.equal(decryptAmount(ZERO_AMOUNT, viewing), 0n);
    const credited = addAmounts(ZERO_AMOUNT, encryptAmount(99n, viewing, rng));
    assert.equal(decryptAmount(credited, viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }), 99n);
  });

  it('accumulates a long run of payments correctly', () => {
    let balance = ZERO_AMOUNT;
    let expected = 0n;
    for (let i = 1; i <= 60; i += 1) {
      const value = BigInt(i * 1_000);
      balance = addAmounts(balance, encryptAmount(value, viewing, rng));
      expected += value;
    }
    assert.equal(decryptAmount(balance, viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }), expected);
  });
});

describe('verifyAmount', () => {
  it('confirms a known plaintext without a discrete-log search', () => {
    const ciphertext = encryptAmount(123_456_789n, viewing, rng);
    assert.equal(verifyAmount(ciphertext, viewing, 123_456_789n), true);
    assert.equal(verifyAmount(ciphertext, viewing, 123_456_788n), false);
    assert.equal(verifyAmount(ciphertext, viewing, -1n), false);
  });

  it('works past the discrete-log bound, where decryption cannot', () => {
    // A balance far beyond any feasible search still verifies in constant time.
    const huge = MAX_AMOUNT - 12n;
    const ciphertext = encryptAmount(huge, viewing, rng);
    assert.equal(verifyAmount(ciphertext, viewing, huge), true);
  });

  it('verifies an accumulated balance whose limbs carry no propagated carries', () => {
    // Adding ciphertexts adds limbs without carrying, so an accumulated balance
    // is not in canonical limb form. Verification must not depend on that form.
    let balance = ZERO_AMOUNT;
    let expected = 0n;
    for (let i = 0; i < 50; i += 1) {
      const value = 60_000n + BigInt(i);
      balance = addAmounts(balance, encryptAmount(value, viewing, rng));
      expected += value;
    }
    // Sanity: the accumulated form really is non-canonical.
    assert.equal(amountsEqual(balance, encryptAmount(expected, viewing, rng)), false);

    assert.equal(verifyAmount(balance, viewing, expected), true);
    assert.equal(verifyAmount(balance, viewing, expected + 1n), false);
  });

  it('verifies a balance left non-canonical by a debit', () => {
    const balance = subtractAmounts(
      encryptAmount(65_536n, viewing, rng),
      encryptAmount(1n, viewing, rng),
    );
    assert.equal(verifyAmount(balance, viewing, 65_535n), true);
  });

  it('rejects a ciphertext under the wrong key', () => {
    const other = deriveKeyset(hexToBytes('55'.repeat(32))).viewing;
    assert.equal(verifyAmount(encryptAmount(10n, viewing, rng), other, 10n), false);
  });
});

describe('rollover', () => {
  it('renormalises limbs without changing the value', () => {
    let balance = ZERO_AMOUNT;
    for (let i = 0; i < 40; i += 1) {
      balance = addAmounts(balance, encryptAmount(60_000n, viewing, rng));
    }
    const expected = 60_000n * 40n;
    const rolled = rolloverAmount(balance, viewing, rng);
    assert.equal(decryptAmount(rolled, viewing), expected);
    // After rollover the default (narrow) bound is enough again.
    assert.equal(verifyAmount(rolled, viewing, expected), true);
  });
});
