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

/**
 * Tests against a live Stellar node need a second opt-in.
 *
 * PostgreSQL and Redis are cheap for any CI job to provide; a Stellar network
 * takes minutes to boot. So the two are gated separately: the database and
 * cache tests run on every pull request, and the live-node tests run wherever a
 * node is actually pointed at — locally, and in the nightly `live-rpc` job.
 *
 * The gate is whether STELLAR_RPC_URL was set explicitly, not whether it has a
 * value: it has a local default, and defaulting into a connection failure would
 * report a missing node as a broken indexer.
 */
export const LIVE_RPC_ENABLED =
  INTEGRATION_ENABLED && (process.env['STELLAR_RPC_URL'] ?? '').length > 0;

/** Reason string for node:test's `skip` option, or false to run. */
export function skipUnlessIntegration(): string | false {
  return INTEGRATION_ENABLED ? false : 'set STELLAR_CONFIDENTIAL_INTEGRATION=1 to run';
}

/** As above, but also requires a Stellar node to have been named. */
export function skipUnlessLiveRpc(): string | false {
  if (!INTEGRATION_ENABLED) return 'set STELLAR_CONFIDENTIAL_INTEGRATION=1 to run';
  return LIVE_RPC_ENABLED ? false : 'set STELLAR_RPC_URL to run against a live Stellar node';
}
