/**
 * Schema migrations.
 *
 * Kept as TypeScript rather than loose .sql files so that a published package
 * carries its schema with it — no build step has to remember to copy assets, and
 * no deployment can end up with code and schema out of step.
 *
 * Migrations are append-only. Never edit one that has shipped; add another.
 */
export interface Migration {
  readonly version: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: '0001_initial',
    statements: [
      `CREATE TABLE IF NOT EXISTS ledgers (
        sequence       BIGINT PRIMARY KEY,
        hash           TEXT   NOT NULL,
        previous_hash  TEXT   NOT NULL,
        close_time     BIGINT NOT NULL,
        event_count    INTEGER NOT NULL DEFAULT 0
      )`,

      // Events cascade from ledgers, so a reorg rollback or a retention prune is
      // a single DELETE on ledgers and cannot leave orphaned events behind.
      `CREATE TABLE IF NOT EXISTS events (
        event_cursor      TEXT PRIMARY KEY,
        ledger_sequence   BIGINT  NOT NULL REFERENCES ledgers(sequence) ON DELETE CASCADE,
        tx_index          INTEGER NOT NULL,
        op_index          INTEGER NOT NULL,
        event_index       INTEGER NOT NULL,
        ledger_hash       TEXT    NOT NULL,
        ledger_close_time BIGINT  NOT NULL,
        tx_hash           TEXT    NOT NULL,
        contract_id       TEXT    NOT NULL,
        type              TEXT    NOT NULL,
        account           TEXT    NOT NULL,
        counterparty      TEXT,
        delta             TEXT    NOT NULL,
        amount            JSONB,
        public_amount     NUMERIC(20, 0),
        raw               JSONB   NOT NULL
      )`,

      // Account history is the hot path (M1.3): this index makes it an index-only
      // range scan in cursor order, which is also the order clients page in.
      `CREATE INDEX IF NOT EXISTS events_account_cursor_idx ON events (account, event_cursor)`,
      `CREATE INDEX IF NOT EXISTS events_contract_cursor_idx ON events (contract_id, event_cursor)`,
      `CREATE INDEX IF NOT EXISTS events_ledger_idx ON events (ledger_sequence)`,

      `CREATE TABLE IF NOT EXISTS checkpoints (
        name            TEXT PRIMARY KEY,
        event_cursor    TEXT   NOT NULL,
        ledger_sequence BIGINT NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    ],
  },
];
