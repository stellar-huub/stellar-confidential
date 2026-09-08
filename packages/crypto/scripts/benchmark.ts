/**
 * Cryptographic cost baseline.
 *
 * Run with: node --import tsx packages/crypto/scripts/benchmark.ts
 *
 * Decryption cost is what decides whether a wallet can replay its own history on
 * a phone, so it needs a number attached to it rather than an intuition. This
 * establishes the desktop baseline that milestone M6.1 optimises against.
 */
import { hexToBytes } from '@noble/hashes/utils.js';
import { G, pointToHex, scalarMultiply } from '../src/group.js';
import { deriveKeyset } from '../src/keys.js';
import { DEFAULT_BALANCE_BOUND, DEFAULT_LIMB_BOUND, decryptAmount, encryptAmount, verifyAmount } from '../src/amount.js';
import { seededRandomScalar } from '../src/elgamal.js';
import { clearDlogCache } from '../src/dlog.js';

function bench(name: string, iterations: number, fn: (i: number) => unknown): void {
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn(i);
  const perOpUs = Number(process.hrtime.bigint() - started) / 1000 / iterations;
  const label = perOpUs > 1000 ? `${(perOpUs / 1000).toFixed(2)} ms` : `${perOpUs.toFixed(1)} us`;
  console.log(`${name.padEnd(38)} ${label.padStart(12)}   (n=${iterations})`);
}

const keys = deriveKeyset(hexToBytes('7f'.repeat(32)));
const rng = seededRandomScalar(42n);
const point = G.multiply(12_345n);
const other = G.multiply(99n);

console.log('\ngroup primitives');
bench('point add', 100_000, () => point.add(other));
bench('point compress (toHex)', 20_000, () => pointToHex(point));
bench('scalar multiply', 2_000, () => scalarMultiply(point, 98_765_432_198_765n));

console.log('\namount operations (4 limbs, 64-bit amount)');
const ciphertext = encryptAmount(1_234_567n, keys.viewing, rng);
bench('encrypt', 500, () => encryptAmount(1_234_567n, keys.viewing, rng));
bench('verify against known plaintext', 2_000, () => verifyAmount(ciphertext, keys.viewing, 1_234_567n));

clearDlogCache();
const cold = process.hrtime.bigint();
decryptAmount(ciphertext, keys.viewing, { allowNegative: false });
console.log(
  `${'decrypt (cold: builds table)'.padEnd(38)} ${`${(Number(process.hrtime.bigint() - cold) / 1e6).toFixed(2)} ms`.padStart(12)}   (n=1)`,
);

bench('decrypt (warm, event amount)', 200, () =>
  decryptAmount(ciphertext, keys.viewing, { maxAbsLimb: DEFAULT_LIMB_BOUND, allowNegative: false }),
);
bench('decrypt (warm, signed search)', 100, () =>
  decryptAmount(ciphertext, keys.viewing, { maxAbsLimb: DEFAULT_LIMB_BOUND }),
);
bench('decrypt (warm, balance bound)', 20, () =>
  decryptAmount(ciphertext, keys.viewing, { maxAbsLimb: DEFAULT_BALANCE_BOUND }),
);
console.log('');
