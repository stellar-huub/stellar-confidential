# Operations Runbook

Running the indexer and recovery services. Milestone M1.6.

---

## Services

| Service             | Purpose                                                      | Default port |
| ------------------- | ------------------------------------------------------------ | ------------ |
| `services/indexer`  | Ingests Confidential Token events and serves the archive API | 4000         |
| `services/recovery` | Recovery session coordination                                | 4010         |

The indexer runs ingestion and the API in one process. The API only reads what ingestion has committed, so keeping them together removes a class of "which one is behind" questions. Splitting them for a larger deployment needs no code change — both sides talk only to the store.

---

## Starting up

```bash
cp .env.example .env
docker compose up -d postgres redis stellar
pnpm install && pnpm build
pnpm dev                          # indexer: ingestion + archive API
node --import tsx services/recovery/src/main.ts
```

Verify:

```bash
curl -s localhost:4000/health | jq
curl -s localhost:4000/openapi.json | jq '.info'
```

`DATABASE_URL` unset means an in-memory store and nothing durable. The service warns loudly at start; do not run a deployment that way.

---

## What to watch

| Signal                  | Where                                    | Healthy              | Act when                                |
| ----------------------- | ---------------------------------------- | -------------------- | --------------------------------------- |
| **Ledger lag**          | `/health` `latestLedger` vs the node's   | within ~5 ledgers    | sustained above 20                      |
| **Checkpoint progress** | `/health` `checkpointLedger`             | advancing every poll | flat for more than a minute             |
| **Ingest errors**       | `ingest pass failed` log lines           | none                 | any repeated code                       |
| **Reorg rate**          | `reorg detected` / `rewound after reorg` | rare                 | more than a few per hour                |
| **Event count**         | `/health` `eventCount`                   | monotonic            | any decrease not explained by pruning   |
| **RPC retries**         | `rpc retry` log lines                    | occasional           | sustained, means the node is struggling |

Ledger lag is the primary indicator. M1.6's acceptance criterion is staying within 5 ledgers of the tip for 7 consecutive days.

Logs are structured JSON on stdout. Key material, seed phrases and decrypted amounts are dropped by the logger before serialisation, and bigints are refused outright because that is the type a decrypted balance arrives as.

---

## Common situations

### Ingestion is not advancing

1. Is the node healthy? `curl -s $STELLAR_RPC_URL -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -H 'content-type: application/json'`
2. Is the checkpoint moving? `SELECT * FROM checkpoints;`
3. Look for `RPC_UNAVAILABLE` (transport, will retry) versus `RPC_PROTOCOL` (the node answered and disagreed — will not retry, and usually means a version mismatch).

### `RETENTION_EVICTED` at start

The node has pruned ledgers this indexer never ingested. Continuing would leave a hole in history, so it refuses.

Either point at an archive node with deeper retention, or accept the gap explicitly by setting `INGEST_START_LEDGER` to the node's oldest ledger — and record that the archive's history begins there.

### Repeated reorg handling

Each reorg deletes events above the fork point and rewinds the checkpoint; the next pass re-ingests. This is normal and self-correcting. Persistent reorgs usually mean the node is not yet caught up to consensus — check the node before the indexer.

### A client reports `INTEGRITY_FAILURE`

The archive served events inconsistent with its own digest. This is a data-integrity problem, not a transport one, and clients deliberately do not retry it.

1. Recompute the digest: `curl "localhost:4000/accounts/$ACCOUNT/digest"`
2. Compare event counts against the store directly.
3. If they disagree, the store was written by something other than this pipeline, or a rollback ran mid-serve.

### A client reports `STALE_INDEX`

The archive is behind the network. Check ledger lag; this is an ingestion problem, and clients are expected to wait and re-sync.

---

## Migrations

Applied automatically at start, idempotently, under an advisory lock so two instances starting together cannot race. To run them alone:

```bash
pnpm migrate
```

Migrations are append-only. Never edit one that has shipped.

---

## Retention

`RETENTION_LEDGERS=0` keeps everything. A non-zero value prunes ledgers older than that many behind the tip.

Pruning is irreversible and it removes history clients may still need to recover from genesis. A client whose checkpoint predates the cutoff cannot rebuild from this archive alone. Multi-provider archives (Phase 3) are the intended answer; until then, prefer keeping full history.

---

## Backups

Back up the `events`, `ledgers` and `checkpoints` tables together — a checkpoint restored ahead of the events it refers to would make ingestion resume past a hole.

The database holds only ciphertexts and public chain data. It holds no key material and cannot be used to decrypt anything, so a backup is not itself a disclosure of confidential amounts. It does reveal transaction graph and timing metadata, so treat it as sensitive.

Restore is a plain PostgreSQL restore. If the checkpoint is ahead of the restored events, roll it back:

```sql
UPDATE checkpoints SET ledger_sequence = (SELECT max(sequence) FROM ledgers),
                       event_cursor = lpad((SELECT max(sequence) FROM ledgers)::text, 10, '0')
                                      || '-99999-99999-99999';
```

---

## Scaling

- **Read load**: run several API instances against one database. They hold no state beyond the cache.
- **Cache**: set `REDIS_URL` so instances share it; without it each keeps its own in-process cache.
- **Ingestion**: run exactly one ingester per `checkpointName`. Two ingesters on one checkpoint will fight — the writes stay correct, because appends are atomic and idempotent, but they will duplicate work.
- **Rate limiting**: `RATE_LIMIT_PER_MINUTE` is per instance and per client address. Behind a proxy, enable `trustProxy` so the real client is limited rather than the proxy.
