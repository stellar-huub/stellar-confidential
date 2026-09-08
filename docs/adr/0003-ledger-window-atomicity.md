# 0003 — Commit ingestion a ledger window at a time

**Status:** Accepted · 2026-09-07

## Context

M1.2 requires that an indexer killed mid-run and restarted produces byte-identical state to an uninterrupted run.

That requires the checkpoint to always describe a boundary that is genuinely durable.

## Options

1. **Commit per RPC page.** Simple, but a page can end mid-ledger, so a checkpoint can name a position with half a ledger's events stored.
2. **Commit per event.** Maximum granularity, worst throughput, same mid-ledger problem.
3. **Commit per ledger window.** All events in ledgers `[start, end]`, their headers and the checkpoint in one transaction.

## Decision

Option 3, with a configurable window (default 200 ledgers).

There is no state in which half a ledger is durable. The checkpoint therefore always means "every ledger through here is fully ingested", and resuming re-requests whole ledgers.

Idempotency does the rest: cursor is the primary key and inserts are `ON CONFLICT DO NOTHING`, so re-ingesting the boundary window inserts nothing.

## Consequences

- Restart correctness is a property of the schema, not of careful sequencing.
- Memory is bounded by the events in one window. A very dense window on a busy network could grow; the window size is configurable, and splitting a window would require reintroducing mid-ledger boundaries, so it is deliberately not automatic.
- Reorg rewind reuses the same path: roll back above the fork point, then write the rewound checkpoint through the same atomic append.
- A related invariant fell out of this and was missing at first: `rollbackTo` must also clamp checkpoints above the rollback point. A checkpoint pointing at deleted ledgers makes the next ingest resume past a hole. Both stores now do this, and the conformance suite pins it.
