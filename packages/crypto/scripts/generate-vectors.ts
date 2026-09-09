/**
 * Regenerate packages/crypto/src/vectors.ts.
 *
 * Run with: node --import tsx packages/crypto/scripts/generate-vectors.ts
 *
 * Changing the output of this script is a breaking change to the wire format.
 * If a diff appears here that you did not intend, stop and work out why.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hexToBytes } from '@noble/hashes/utils.js';
import { deriveKeyset } from '../src/keys.js';
import { encryptAmount } from '../src/amount.js';
import { seededRandomScalar } from '../src/elgamal.js';

const CASES = [
  { name: 'zero', seed: '00'.repeat(32), amount: 0n, randomSeed: '1' },
  { name: 'one-stroop', seed: '01'.repeat(32), amount: 1n, randomSeed: '2' },
  { name: 'single-limb', seed: '02'.repeat(32), amount: 65_535n, randomSeed: '3' },
  { name: 'limb-boundary', seed: '03'.repeat(32), amount: 65_536n, randomSeed: '4' },
  { name: 'salary-100-xlm', seed: '04'.repeat(32), amount: 1_000_000_000n, randomSeed: '5' },
  { name: 'max-u64-minus-one', seed: '05'.repeat(32), amount: (1n << 64n) - 2n, randomSeed: '6' },
  {
    name: 'mixed-bytes',
    seed: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
    amount: 4_294_967_297n,
    randomSeed: '7',
  },
];

const vectors = CASES.map((testCase) => {
  const keyset = deriveKeyset(hexToBytes(testCase.seed));
  const ciphertext = encryptAmount(
    testCase.amount,
    keyset.viewing,
    seededRandomScalar(BigInt(testCase.randomSeed)),
  );
  return {
    name: testCase.name,
    seed: testCase.seed,
    spendPublicKey: keyset.spend.publicKey,
    viewingPublicKey: keyset.viewing.publicKey,
    amount: testCase.amount.toString(),
    randomSeed: testCase.randomSeed,
    ciphertext,
  };
});

const header = `import type { EncryptedAmount } from '@stellar-confidential/core';

/**
 * Frozen test vectors (milestone M2.1).
 *
 * GENERATED FILE — produced by scripts/generate-vectors.ts. Do not hand-edit.
 *
 * Their job is to catch a silent change in encoding, derivation or limb layout:
 * if a refactor alters any of these bytes, ciphertexts written by an older
 * version of this package stop decrypting, and existing wallets lose their
 * history. The vectors are the contract that prevents that.
 *
 * They are also the portability check — the same vectors must decrypt in a
 * browser and in a mobile WebView, not just in Node.
 */
export interface CryptoTestVector {
  readonly name: string;
  /** Hex-encoded 32-byte seed. */
  readonly seed: string;
  readonly spendPublicKey: string;
  readonly viewingPublicKey: string;
  readonly amount: string;
  /** Deterministic randomness used at encryption time. */
  readonly randomSeed: string;
  readonly ciphertext: EncryptedAmount;
}

export const TEST_VECTORS: readonly CryptoTestVector[] = ${JSON.stringify(vectors, null, 2)};
`;

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vectors.ts');
writeFileSync(target, header);
console.log(`wrote ${vectors.length} vectors to ${target}`);
