# Confidential Event Model

The canonical event model every part of this project stores, serves, verifies and replays.

**Status: working spec.** The _shape_ below is settled and everything downstream is built on it. The mapping from a specific Confidential Token contract's on-chain events onto this shape is the job of a `ContractAdapter`, and reconciling that mapping with the canonical Stellar contract is the open item tracked at the end of this document.

---

## Why an adapter boundary exists

The contract's on-chain event surface is the one part of this system we do not control. Rather than let that uncertainty spread into ingestion, storage and recovery, it is confined to a single interface:

```text
Stellar RPC ──▶ ScValCodec ──▶ RawContractEvent ──▶ ContractAdapter ──▶ ConfidentialEvent
                                                    └── the only contract-aware code ──┘
```

Everything to the right of `decode` speaks `ConfidentialEvent` only. Supporting a contract revision, or a second contract entirely, means writing an adapter and changing nothing else.

---

## Ordering

Stellar orders events by `(ledger, transaction, operation, event)`. That tuple is encoded as a fixed-width, zero-padded **cursor**:

```text
0000037265-00001-00000-00003
└────────┘ └───┘ └───┘ └───┘
  ledger    tx    op    event
   (10)     (5)   (5)    (5)
```

Fixed width makes lexicographic order identical to ledger order — in PostgreSQL, in a sort, in a URL query — so paging, range digests and replay all share one comparison.

Widths are chosen to outlive the network: 10 digits of ledger is roughly 340 years at 5-second closes, and 5 digits each of transaction and operation exceed protocol limits.

The cursor is also the event's **primary key**. Re-ingesting a ledger inserts nothing new, which is what makes ingestion idempotent (invariant 6).

### Recovering the tuple

Stellar RPC identifies an event as `<toid>-<ordinal>`, where the TOID packs the position into 64 bits:

| bits  | field                         |
| ----- | ----------------------------- |
| 63–32 | ledger sequence               |
| 31–20 | transaction application order |
| 19–0  | operation index               |

`decodeEventId` in `@stellar-confidential/indexer` unpacks it. This is used rather than the RPC's separate index fields because older RPC releases do not return them.

---

## The event

```typescript
interface ConfidentialEvent {
  id: string; // equal to the cursor
  cursor: string;
  type: ConfidentialEventType;
  contractId: string;
  account: string; // whose confidential state this event mutates
  counterparty: string | null;
  delta: BalanceDelta;
  amount: EncryptedAmount | null; // encrypted to `account`'s viewing key
  publicAmount: string | null; // stroops, decimal string
  proof: LedgerProof;
  raw: JsonValue; // adapter-preserved original payload
}
```

### Types and deltas

| `type`         | `delta`            | Meaning                                                                          |
| -------------- | ------------------ | -------------------------------------------------------------------------------- |
| `deposit`      | `credit`           | Public balance moves into the confidential balance. `publicAmount` is set.       |
| `withdraw`     | `debit`            | Confidential balance moves out to the public balance. `publicAmount` is set.     |
| `transfer`     | `debit` / `credit` | Confidential value moves between accounts. No public amount — that is the point. |
| `rollover`     | `replace`          | Balance re-encrypted into canonical limbs. Value unchanged.                      |
| `key_rotation` | `replace`          | Balance re-encrypted under a new key. Value unchanged.                           |
| `disclosure`   | `none`             | A viewing grant was issued, changed or revoked.                                  |

`replace` exists because rollover and key rotation change a balance's _representation_ without changing its _value_. Replay must assign rather than accumulate for those — accumulating a rollover doubles the balance. This is the single most consequential field in the model and it is pinned by a test.

### Fan-out

One raw contract event may decode to several canonical events. A transfer becomes two: one for the sender, one for the recipient. Each side carries a ciphertext under **its own** viewing key, so each party can replay their own history without the other's cooperation and neither can read the other's copy.

Both need distinct cursors, so the adapter folds the party index into the event index:

```text
eventIndex = rawEventIndex * 10 + partyIndex
```

This reserves ten slots per raw event. The adapter rejects a raw event index above 9,999 or a fan-out above 10 rather than risking a cursor collision.

### Amounts

An amount is carried as four 16-bit limbs, little-endian, each a separate twisted ElGamal ciphertext:

```text
value = l0 + l1·2^16 + l2·2^32 + l3·2^48
```

Limbs exist because decryption is a bounded discrete-log search whose cost grows with the square root of the range. Searching 2^64 is impossible; searching 2^16 four times is microseconds. This is what lets a phone decrypt its own history event by event.

Each limb is a `{ commitment, handle }` pair of compressed ristretto255 points, hex encoded:

```text
commitment = value·G + r·P      handle = r·G      where P = viewingKey·G
```

Randomness is independent per limb. Sharing one `r` across the limbs of an amount would make limb _differences_ recoverable — `C_i − C_j = (m_i − m_j)·G` over a 16-bit range is trivially brute-forced — so it is not done.

Limbs are only canonical (`0 ≤ limb < 2^16`) when freshly encrypted. Homomorphic addition does not propagate carries, so an accumulated balance holds limbs outside that range, and subtraction can drive an individual limb negative while the total stays positive. Anything reading limbs must tolerate both. A `rollover` event returns a balance to canonical form.

### Provenance

```typescript
interface LedgerProof {
  ledgerSequence: number;
  ledgerHash: string;
  ledgerCloseTime: number;
  txHash: string;
  txIndex: number;
  opIndex: number;
  eventIndex: number;
}
```

Every stored event carries this. It is what lets a client tie a decrypted amount back to a specific ledger and transaction rather than trusting an archive's word.

---

## Integrity digests

An archive publishes a Merkle root over a cursor range so a client can detect omission, reordering or tampering without re-downloading the chain.

- **Leaves** are `SHA-256(0x00 ‖ canonicalEventBytes)`; **interior nodes** are `SHA-256(0x01 ‖ left ‖ right)`. Domain separation means no leaf can be reinterpreted as a node.
- An odd node is **promoted**, not duplicated. Duplicating the last leaf would let `[a,b,c]` and `[a,b,c,c]` hash identically (the CVE-2012-2459 shape).
- The empty range hashes to `SHA-256("")`, so "no events" is still a committed, comparable value.

The digest binds every field replay depends on plus full provenance. It deliberately **excludes** `raw`, which is adapter-specific and may legitimately differ in encoding between two archives holding the same logical event.

Digest requests take an **exclusive** lower bound (`afterCursor`), matching pagination. A client resuming from a cursor asks about exactly the events it does not yet have — an inclusive bound would force it to re-supply a boundary event it no longer holds after a checkpoint restore.

**What this does and does not prove.** A digest proves an archive served data consistent with its own commitment. It does not prove the commitment is honest: an archive that consistently lies about both is caught by comparing digests across providers (Phase 3) or by verifying the replayed balance against the chain (M2.3), not by the digest alone.

---

## Reference wire format

The encoding the reference adapter, the synthetic generator and the whole test suite use.

```text
topics = ["confidential_v1", <type>, <account>, <counterparty or "">]
value  = type-specific object
```

| `type`                     | `value` fields                         |
| -------------------------- | -------------------------------------- |
| `deposit`, `withdraw`      | `account`, `amount`, `publicAmount`    |
| `transfer`                 | `from`, `to`, `fromAmount`, `toAmount` |
| `rollover`, `key_rotation` | `account`, `balance`                   |
| `disclosure`               | `account`, `auditor`                   |

The reference codec is base64-encoded JSON (`jsonScValCodec`). It exercises the entire pipeline without an XDR dependency. A production adapter supplies an XDR codec instead — `scValToNative` from `@stellar/stellar-sdk` fits the `ScValCodec` signature directly, and that substitution is the only change required.

---

## Ingestion guarantees

**Atomicity.** The pipeline advances a _ledger window_ at a time. Every event in ledgers `[start, end]`, their headers, and the checkpoint commit together or not at all. There is no state in which half a ledger is durable, so a checkpoint always names a real boundary and re-running from it reproduces byte-identical state.

**Idempotency.** Cursor is the primary key and inserts are `ON CONFLICT DO NOTHING`. Re-ingesting a ledger is a no-op.

**Reverted calls.** Events from failed contract calls are emitted by RPC but never stored. They did not happen as far as state is concerned and must never enter a balance.

**Reorgs.** Detected two ways: writing a ledger already held under a different hash, or a ledger whose recorded parent hash does not match the stored parent. Either walks back to the fork point, deletes everything above it, and rewinds the checkpoint. A rollback also **clamps any checkpoint above the fork point** — a checkpoint pointing at deleted ledgers would make the next ingest resume past a hole and silently produce an incomplete history.

**Retention.** If the node has pruned ledgers we never ingested, ingestion refuses to continue rather than silently starting later and leaving a gap.

### Reading ledger headers

Reorg detection rests on reading a ledger's parent hash, and Stellar RPC returns it inside two different envelopes:

| Method            | Envelope                   | Layout                                                           |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| `getLatestLedger` | `LedgerHeader`             | `[0..3]` version, `[4..35]` previous hash                        |
| `getLedgers`      | `LedgerHeaderHistoryEntry` | `[0..31]` own hash, `[32..35]` version, `[36..67]` previous hash |

Both are parsed explicitly rather than sniffed, and the `getLedgers` parser also returns the embedded hash so the client can check it against the hash the node reported alongside it. Reading the wrong envelope yields a parent hash that never matches anything, which would disable reorg detection _silently_ — so it fails loudly instead. This was a real bug, caught by running against a live node.

---

## Open items

Resolve these against the canonical Confidential Token contract; each is confined to the adapter or the crypto package.

| #   | Item                                                                   | Confined to                    |
| --- | ---------------------------------------------------------------------- | ------------------------------ |
| 1   | Actual topic names and XDR layout of contract events                   | `adapters/*.ts`, `ScValCodec`  |
| 2   | Whether the contract emits one event per transfer or one per party     | `ContractAdapter.decode`       |
| 3   | Exact curve, encoding and limb layout of on-chain ciphertexts          | `@stellar-confidential/crypto` |
| 4   | How range proofs are carried, and whether the indexer must retain them | event model, `raw`             |
| 5   | Canonical `rollover` semantics and when the contract requires one      | `BalanceDelta`, replay         |
| 6   | Whether key rotation re-encrypts history or only the current balance   | replay, recovery               |

Until these are settled, the reference adapter is the specification. Every number in this document is exercised by the test suite, so a change to any of them fails loudly rather than silently altering a balance.
