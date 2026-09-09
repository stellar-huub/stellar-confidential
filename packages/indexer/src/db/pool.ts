import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
}

export function createPool(options: DatabaseOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'stellar-confidential-indexer',
    // Fail fast rather than queue forever behind an unreachable database.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
  return new Pool(config);
}
