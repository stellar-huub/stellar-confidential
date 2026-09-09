# 0005 — Track ciphertext and plaintext balances together

**Status:** Accepted · 2026-09-07

## Context

Replay must produce a balance and then prove it against the chain (M2.3).

The chain holds a ciphertext. Verifying against it naively means decrypting an accumulated balance — but an accumulated balance's limbs grow beyond the narrow bound that makes decryption cheap, so that search is slow and can fail outright on a large balance.

## Options

1. **Track the ciphertext only**, decrypt on demand. Verification needs a wide, slow discrete-log search, and fails on balances beyond it.
2. **Track the plaintext only.** Cannot compare against the chain's ciphertext at all.
3. **Track both.** Accumulate the ciphertext homomorphically and the plaintext from each event's decrypted amount.

## Decision

Option 3.

Each event's amount is a _fresh_ encryption, so decrypting it is cheap and always in range. Summing those gives the plaintext for free during a fold we were doing anyway.

Verification then becomes constant work: `verifyAmount(chainBalance, key, knownPlaintext)` compares points and never searches. It also works for balances far beyond any feasible search.

## Consequences

- Verification is O(1) in the balance's magnitude. A balance near `2^64 − 1` verifies as fast as a balance of 10.
- The slow wide search survives only as a diagnostic: when verification _fails_, the chain balance is decrypted to say by how much and in which direction, which is what turns a failure into `MISSING_EVENTS` versus `BALANCE_MISMATCH`.
- The replayed ciphertext must equal the chain's bit for bit, since both are sums of the same event ciphertexts. Asserted directly in tests, and a stronger check than value equality alone.
- A checkpoint carries both, so it is as sensitive as the wallet. It belongs in device storage, never in an archive.
