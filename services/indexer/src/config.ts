import { isLogLevel, type LogLevel } from '@stellar-confidential/core';

/**
 * Configuration from the environment.
 *
 * Read once, at start, and validated here rather than at each use site — a
 * service should refuse to start on a bad setting instead of failing hours later
 * on the code path that happens to read it.
 */
export interface IndexerConfig {
  readonly rpcUrl: string;
  readonly contractIds: readonly string[];
  readonly databaseUrl: string | undefined;
  readonly databasePoolMax: number;
  readonly redisUrl: string | undefined;
  readonly startLedger: number;
  readonly pageSize: number;
  readonly pollIntervalMs: number;
  readonly retentionLedgers: number;
  readonly httpPort: number;
  readonly logLevel: LogLevel;
  readonly ratePerMinute: number;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function loadIndexerConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const level = env['LOG_LEVEL'] ?? 'info';
  if (!isLogLevel(level)) throw new Error(`LOG_LEVEL must be one of debug|info|warn|error`);

  return {
    rpcUrl: env['STELLAR_RPC_URL'] ?? 'http://localhost:8000/rpc',
    contractIds: (env['CONFIDENTIAL_CONTRACT_IDS'] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    databaseUrl: env['DATABASE_URL'],
    databasePoolMax: integer(env['DATABASE_POOL_MAX'], 10, 'DATABASE_POOL_MAX'),
    redisUrl: env['REDIS_URL'],
    startLedger: integer(env['INGEST_START_LEDGER'], 0, 'INGEST_START_LEDGER'),
    pageSize: integer(env['INGEST_PAGE_SIZE'], 200, 'INGEST_PAGE_SIZE'),
    pollIntervalMs: integer(env['INGEST_POLL_INTERVAL_MS'], 2_000, 'INGEST_POLL_INTERVAL_MS'),
    retentionLedgers: integer(env['RETENTION_LEDGERS'], 0, 'RETENTION_LEDGERS'),
    httpPort: integer(env['INDEXER_HTTP_PORT'], 4_000, 'INDEXER_HTTP_PORT'),
    logLevel: level,
    ratePerMinute: integer(env['RATE_LIMIT_PER_MINUTE'], 600, 'RATE_LIMIT_PER_MINUTE'),
  };
}
