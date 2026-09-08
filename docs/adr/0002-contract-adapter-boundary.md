# 0002 — Confine contract knowledge to a ContractAdapter

**Status:** Accepted · 2026-09-07

## Context

M1.1 asks for a documented event surface for the Confidential Token contract. The canonical contract's exact topic names, XDR layout and event granularity are not settled (open items #1–#6 in `docs/events.md`).

Waiting would block Phases 1 and 2 entirely. Guessing and spreading the guess through ingestion, storage and replay would mean rewriting all of it when the real surface lands.

## Options

1. **Block** until the contract surface is known.
2. **Guess** an event surface and use it directly throughout.
3. **Define a canonical internal model** and confine the contract mapping to an adapter.

## Decision

Option 3.

`ContractAdapter` turns a `RawContractEvent` into zero or more `ConfidentialEvent`s. Everything downstream — pipeline, storage, API, replay, verification — speaks only the canonical model.

Separately, `ScValCodec` isolates XDR decoding, so the reference adapter can run on base64 JSON and exercise the whole pipeline without an XDR dependency.

## Consequences

- Phases 1 and 2 were built and tested in full against a working spec.
- Retargeting at the canonical contract means writing one adapter and one codec. `scValToNative` from the Stellar SDK already fits the `ScValCodec` signature.
- The reference encoding is documented in `docs/events.md` and must not be mistaken for the canonical one. Both the adapter and the doc say so at the top.
- Fan-out is part of the boundary: a transfer becoming one event per party is an adapter decision, so a contract that emits differently needs no downstream change.
- Risk: if the real contract needs data the canonical model has no field for — retained range proofs are the likely candidate — the model changes, not just the adapter. `raw` preserves the original payload so nothing is lost in the meantime.
