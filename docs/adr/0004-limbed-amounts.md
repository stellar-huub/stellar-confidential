# 0004 — Carry amounts as four 16-bit limbs

**Status:** Accepted · 2026-09-07

## Context

Twisted ElGamal decryption recovers `m·G`, not `m`. Recovering `m` means a discrete log, which is only tractable over a small range.

A 64-bit amount cannot be searched. A wallet must decrypt its own history, event by event, on a phone.

## Options

1. **One ciphertext per amount, wide search.** Simple, but 2^64 is not searchable.
2. **Cap amounts at a searchable size.** Loses range that real assets need.
3. **Split into limbs, one ciphertext each.** Search cost becomes per-limb.

## Decision

Option 3: four 16-bit limbs, little-endian, each independently encrypted.

Randomness is independent per limb. Sharing one `r` across limbs would let an observer compute `C_i − C_j = (m_i − m_j)·G` and brute-force the difference over a 16-bit range — a real leak, so it is not done, even though it would have made decryption four times cheaper.

## Consequences

- A 64-bit amount decrypts in four cheap searches instead of one impossible one.
- **Limbs are only canonical when freshly encrypted.** Homomorphic addition does not propagate carries, and subtraction can drive a limb negative while the total stays positive. Everything reading limbs must tolerate both: the solver searches signed, and `rollover` returns a balance to canonical form.
- This bit us. `verifyAmount` originally compared limb-by-limb against `splitLimbs(expected)`, which rejects correct accumulated balances — the end-to-end test reported a mismatch where both values read 275,612. It now recombines by weight, `sum 2^(16i)·unmask(limb_i) == expected·G`, which is invariant to how a value is distributed across limbs.
- Ciphertexts are four times the size of a single-ciphertext scheme. Acceptable; bandwidth is not the constraint, decryption time is.
