# Threat Model

Scope: the indexing and recovery infrastructure in this repository. Not the Confidential Token contract itself, and not the cryptography it defines.

Status: living document, started at Phase 1. It is deliberately explicit about what this infrastructure does **not** protect, because the gap between "encrypted" and "private" is where users get hurt.

---

## What we protect

| Asset | Against | How |
|-------|---------|-----|
| Confidential amounts | Anyone but the key holder | Amounts are only ever handled as ciphertext by this infrastructure. Nothing server-side can decrypt. |
| Spend authority | Everyone, including an auditor | Spend and viewing keys are derived independently through HKDF. A viewing grant is arithmetically incapable of spending. |
| History completeness | A dishonest or faulty archive | Merkle range digests, plus verification of the replayed balance against the chain. |
| Balance correctness | Silent corruption | Every failure mode raises a distinct typed error. A wrong balance is never returned in place of an error. |
| Key material | Accidental disclosure | Keys never enter a request, a log line, or the database. Enforced by tests over real request traffic, not by convention. |

---

## Actors

**The user.** Holds the seed. Can spend and can read.

**An auditor.** Holds a viewing key for a granted scope. Can read the amounts in scope. Cannot spend, cannot read outside the scope. (Scoping lands in Phase 5; today a viewing key reads everything for its account.)

**An archive operator.** Runs an indexer. Sees ciphertexts, account identifiers, timing and the transaction graph. Cannot see amounts.

**A network observer.** Sees the chain, which is public, plus whatever an archive's transport leaks.

---

## Threats and mitigations

### T1 — Archive withholds history

An archive omits events so a client reconstructs a balance that is too low.

*Mitigation.* Every page is checked against a digest over a range **the client chose**, not the range the archive returned. On the final page the range extends to the client's own upper bound, so a withheld tail is visible. Replayed balances are then checked against the chain, which catches shortfalls the digest cannot.

*Residual.* An archive that lies consistently — serving both a truncated history and a digest that agrees with it — is not caught by digests alone. It is caught by comparing providers (Phase 3) or by chain verification. **This is why chain verification is not optional in a real client.**

### T2 — Archive forges or alters events

*Mitigation.* Digests bind every replay-relevant field and full ledger provenance. A forged event fails digest verification before it reaches a balance. Even if accepted, the replayed balance would not match the chain.

### T3 — Archive operator learns amounts

*Mitigation.* The archive never receives a key. It stores and serves ciphertexts. There is no code path from an archive to a plaintext amount.

*Residual, and it is real.* The operator sees **who transacts with whom, when, and how often**. Confidential amounts are not confidential relationships. Transaction-graph and timing analysis remains open, and for payroll — regular payments, fixed intervals, a known employer — it is a genuine risk. Nothing in Phase 1 or 2 addresses it.

### T4 — Key material leaks server-side

*Mitigation.* The recovery API accepts an account and a cursor and rejects any other field, so a client cannot post a key even by accident. The logger drops fields whose names look like secrets and refuses bigints. An end-to-end test asserts over actual request traffic that neither spend key, viewing key, nor decrypted balance appears.

### T5 — Auditor escalates viewing to spending

*Mitigation.* The two keys are independent HKDF outputs with distinct labels. `sign` accepts only a `SpendKey`, and the exported viewing key carries no secret beyond its own scalar. Tested negatively: a signature does not verify against the viewing public key, and everything a disclosure exposes contains no spend material.

### T6 — Reorg leaves orphaned history

*Mitigation.* Ledger hash chains are verified on ingest and re-verified behind the tip. A divergence rolls back to the fork point and **clamps any checkpoint above it** — otherwise the next ingest resumes past a hole and produces a history that looks complete and is not.

### T7 — Wrong key produces a plausible balance

*Mitigation.* Decryption is a bounded search that fails rather than wrapping. A first event that will not decrypt is reported as `WRONG_KEY` specifically, because at that point the key is overwhelmingly the reason.

### T8 — Replay corrupted by malformed input

*Mitigation.* Replay validates account, ordering and uniqueness on every event, and refuses a negative balance — which means missing credits, not a negative balance. Each raises a distinct error.

### T9 — Denial of service against an archive

*Mitigation.* Per-client rate limiting, bounded page sizes, keyset pagination (constant cost at any depth), and a request body cap.

*Residual.* Digest computation over a wide range is O(events in range) and is only partly protected by caching. A deliberately-chosen wide range is a plausible amplification vector and is not yet bounded.

### T10 — Supply chain

*Mitigation.* Four runtime dependencies (`@noble/curves`, `@noble/hashes`, `pg`, `ws`), all widely used, with the crypto ones audited. Redis is spoken directly rather than through a client library, which removed a dependency from a service handling confidential data. CI audits dependencies.

---

## Explicitly out of scope, for now

These are **not** mitigated. Listing them is the point.

1. **Transaction graph and timing privacy** (T3 residual). The largest known gap.
2. **Scoped disclosure.** A viewing key today reads an account's whole history. Time- and amount-bounded scopes are Phase 5.
3. **Range proofs.** Whether the contract's proofs must be retained and re-verified by the indexer is open item #4 in `docs/events.md`.
4. **Client-side key storage.** Platform keystore integration is Phase 6.
5. **Archive authentication.** Any archive claiming to serve an account is trusted to the extent digests allow. Provider identity and reputation are Phase 3.
6. **Metadata in transport.** TLS is assumed and not configured here.
7. **Formal cryptographic review.** The scheme here is the classical construction these designs are built on, reconciled against the canonical contract as open items #1–#6 in `docs/events.md`. It has not had external review.

---

## Assumptions

- The Confidential Token contract and its cryptography are sound.
- The user's device is not compromised. Nothing here survives a compromised client.
- At least one honest archive is reachable, or the client verifies against the chain.
- Stellar consensus is not under a successful attack.
- Testnet only. **No production assets until independent review.**
