/**
 * Integration test configuration.
 *
 * These tests need real infrastructure — PostgreSQL, Redis, a Stellar RPC node —
 * so they are opt-in and skip cleanly when it is absent. CI provides all three
 * and runs them via `pnpm test:integration`.
 */
export const INTEGRATION_ENABLED = process.env['STELLAR_CONFIDENTIAL_INTEGRATION'] === '1';

export const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/stellar_confidential_test';

export const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

export const STELLAR_RPC_URL = process.env['STELLAR_RPC_URL'] ?? 'http://localhost:8000/rpc';

/** Reason string for node:test's `skip` option, or false to run. */
export function skipUnlessIntegration(): string | false {
  return INTEGRATION_ENABLED ? false : 'set STELLAR_CONFIDENTIAL_INTEGRATION=1 to run';
}
