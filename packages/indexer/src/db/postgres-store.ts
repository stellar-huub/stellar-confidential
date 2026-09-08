import type { Pool, PoolClient } from 'pg';
import {
  IndexerError,
  ledgerUpperBound,
  type ConfidentialEvent,
  type EncryptedAmount,
  type JsonValue,
  isConfidentialEventType,
} from '@stellar-confidential/core';
import type {
  AccountSummary,
  AppendResult,
  EventPage,
  EventQuery,
  EventStore,
  IngestBatch,
  IngestCheckpoint,
  LedgerRecord,
} from '../store.js';
import { MIGRATIONS } from './migrations.js';

interface EventRow {
  event_cursor: string;
  ledger_sequence: string;
  tx_index: number;
  op_index: number;
  event_index: number;
  ledger_hash: string;
  ledger_close_time: string;
  tx_hash: string;
  contract_id: string;
  type: string;
  account: string;
  counterparty: string | null;
  delta: string;
  amount: EncryptedAmount | null;
  public_amount: string | null;
  raw: JsonValue;
}

function toEvent(row: EventRow): ConfidentialEvent {
  if (!isConfidentialEventType(row.type)) {
    throw new IndexerError('STORAGE_FAILURE', 'stored event has an unknown type', {
      type: row.type,
      cursor: row.event_cursor,
    });
  }
  return {
    id: row.event_cursor,
    cursor: row.event_cursor,
    type: row.type,
    contractId: row.contract_id,
    account: row.account,
    counterparty: row.counterparty,
    delta: row.delta as ConfidentialEvent['delta'],
    amount: row.amount,
    publicAmount: row.public_amount,
    proof: {
      ledgerSequence: Number(row.ledger_sequence),
      ledgerHash: row.ledger_hash,
      ledgerCloseTime: Number(row.ledger_close_time),
      txHash: row.tx_hash,
      txIndex: row.tx_index,
      opIndex: row.op_index,
      eventIndex: row.event_index,
    },
    raw: row.raw,
  };
}

/** Build the shared WHERE clause for both paging and counting. */
function buildFilter(
  query: Omit<EventQuery, 'limit'>,
  params: unknown[],
): string {
  const clauses: string[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };

  if (query.account !== undefined) add('account = ?', query.account);
  if (query.contractId !== undefined) add('contract_id = ?', query.contractId);
  if (query.types !== undefined) add('type = ANY(?)', [...query.types]);
  if (query.afterCursor !== undefined) add('event_cursor > ?', query.afterCursor);
  else if (query.fromCursor !== undefined) add('event_cursor >= ?', query.fromCursor);
  if (query.toCursor !== undefined) add('event_cursor <= ?', query.toCursor);

  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      for (const migration of MIGRATIONS) {
        // Advisory lock: two service instances starting at once must not both
        // try to apply the same migration.
        await client.query('BEGIN');
        try {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sc-migrations']);
          const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
            migration.version,
          ]);
          if (applied.rowCount === 0) {
            for (const statement of migration.statements) await client.query(statement);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
              migration.version,
            ]);
          }
          await client.query('COMMIT');
        } catch (cause) {
          await client.query('ROLLBACK');
          throw new IndexerError('STORAGE_FAILURE', 'migration failed', {
            version: migration.version,
            reason: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    } finally {
      client.release();
    }
  }

  async append(batch: IngestBatch): Promise<AppendResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.appendInTransaction(client, batch);
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof IndexerError) throw cause;
      throw new IndexerError('STORAGE_FAILURE', 'failed to append batch', {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      client.release();
    }
  }

  private async appendInTransaction(
    client: PoolClient,
    batch: IngestBatch,
  ): Promise<AppendResult> {
    let ledgersInserted = 0;
    for (const ledger of batch.ledgers) {
      const inserted = await client.query(
        `INSERT INTO ledgers (sequence, hash, previous_hash, close_time, event_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sequence) DO UPDATE SET event_count = ledgers.event_count + EXCLUDED.event_count
         RETURNING (xmax = 0) AS inserted`,
        [ledger.sequence, ledger.hash, ledger.previousHash, ledger.closeTime, ledger.eventCount],
      );
      if (inserted.rows[0]?.inserted === true) ledgersInserted += 1;
    }

    let eventsInserted = 0;
    for (const event of batch.events) {
      // ON CONFLICT DO NOTHING on the cursor primary key is what makes
      // re-ingesting a ledger a no-op (invariant 6).
      const inserted = await client.query(
        `INSERT INTO events (
           event_cursor, ledger_sequence, tx_index, op_index, event_index,
           ledger_hash, ledger_close_time, tx_hash, contract_id, type,
           account, counterparty, delta, amount, public_amount, raw
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (event_cursor) DO NOTHING`,
        [
          event.cursor,
          event.proof.ledgerSequence,
          event.proof.txIndex,
          event.proof.opIndex,
          event.proof.eventIndex,
          event.proof.ledgerHash,
          event.proof.ledgerCloseTime,
          event.proof.txHash,
          event.contractId,
          event.type,
          event.account,
          event.counterparty,
          event.delta,
          event.amount === null ? null : JSON.stringify(event.amount),
          event.publicAmount,
          JSON.stringify(event.raw),
        ],
      );
      eventsInserted += inserted.rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO checkpoints (name, event_cursor, ledger_sequence, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (name) DO UPDATE
         SET event_cursor = EXCLUDED.event_cursor,
             ledger_sequence = EXCLUDED.ledger_sequence,
             updated_at = now()`,
      [batch.checkpoint.name, batch.checkpoint.cursor, batch.checkpoint.ledgerSequence],
    );

    return {
      eventsInserted,
      eventsSkipped: batch.events.length - eventsInserted,
      ledgersInserted,
    };
  }

  async getEvents(query: EventQuery): Promise<EventPage> {
    const params: unknown[] = [];
    const where = buildFilter(query, params);
    params.push(query.limit + 1); // one extra row tells us whether more exist
    const { rows } = await this.pool.query<EventRow>(
      `SELECT * FROM events ${where} ORDER BY event_cursor ASC LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > query.limit;
    const page = (hasMore ? rows.slice(0, query.limit) : rows).map(toEvent);
    return {
      events: page,
      hasMore,
      nextCursor: hasMore && page.length > 0 ? (page[page.length - 1] as ConfidentialEvent).cursor : null,
    };
  }

  async *streamRange(
    fromCursor: string,
    toCursor: string,
    filter: { account?: string; contractId?: string } = {},
  ): AsyncIterable<ConfidentialEvent> {
    // Keyset pagination rather than OFFSET: constant cost per page regardless of
    // how deep into the history we are.
    const pageSize = 500;
    let after: string | undefined;
    for (;;) {
      const page = await this.getEvents({
        ...filter,
        fromCursor: after === undefined ? fromCursor : undefined,
        afterCursor: after,
        toCursor,
        limit: pageSize,
      });
      for (const event of page.events) yield event;
      if (!page.hasMore || page.events.length === 0) return;
      after = (page.events[page.events.length - 1] as ConfidentialEvent).cursor;
    }
  }

  async countEvents(query: Omit<EventQuery, 'limit'>): Promise<number> {
    const params: unknown[] = [];
    const where = buildFilter(query, params);
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM events ${where}`,
      params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getLedger(sequence: number): Promise<LedgerRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT sequence, hash, previous_hash, close_time, event_count FROM ledgers WHERE sequence = $1',
      [sequence],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sequence: Number(row.sequence),
      hash: row.hash,
      previousHash: row.previous_hash,
      closeTime: Number(row.close_time),
      eventCount: row.event_count,
    };
  }

  async getLatestLedger(): Promise<LedgerRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT sequence, hash, previous_hash, close_time, event_count FROM ledgers ORDER BY sequence DESC LIMIT 1',
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sequence: Number(row.sequence),
      hash: row.hash,
      previousHash: row.previous_hash,
      closeTime: Number(row.close_time),
      eventCount: row.event_count,
    };
  }

  async rollbackTo(sequence: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query('DELETE FROM events WHERE ledger_sequence > $1', [sequence]);
      await client.query('DELETE FROM ledgers WHERE sequence > $1', [sequence]);
      // Never leave a checkpoint pointing above the history that survives.
      await client.query(
        `UPDATE checkpoints
            SET ledger_sequence = $1, event_cursor = $2, updated_at = now()
          WHERE ledger_sequence > $1`,
        [sequence, ledgerUpperBound(sequence)],
      );
      await client.query('COMMIT');
      return removed.rowCount ?? 0;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new IndexerError('STORAGE_FAILURE', 'rollback failed', {
        sequence,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      client.release();
    }
  }

  async getCheckpoint(name: string): Promise<IngestCheckpoint | null> {
    const { rows } = await this.pool.query(
      'SELECT name, event_cursor, ledger_sequence, updated_at FROM checkpoints WHERE name = $1',
      [name],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      name: row.name,
      cursor: row.event_cursor,
      ledgerSequence: Number(row.ledger_sequence),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async getAccountSummary(account: string): Promise<AccountSummary> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::text AS count,
              min(event_cursor) AS first_cursor,
              max(event_cursor) AS last_cursor,
              max(ledger_sequence) AS last_ledger
         FROM events WHERE account = $1`,
      [account],
    );
    const row = rows[0];
    return {
      account,
      eventCount: Number(row?.count ?? 0),
      firstCursor: row?.first_cursor ?? null,
      lastCursor: row?.last_cursor ?? null,
      lastLedgerSequence: row?.last_ledger === null || row?.last_ledger === undefined ? null : Number(row.last_ledger),
    };
  }

  async prune(sequence: number): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query('DELETE FROM events WHERE ledger_sequence < $1', [sequence]);
      await client.query('DELETE FROM ledgers WHERE sequence < $1', [sequence]);
      await client.query('COMMIT');
      return removed.rowCount ?? 0;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new IndexerError('STORAGE_FAILURE', 'prune failed', {
        sequence,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
