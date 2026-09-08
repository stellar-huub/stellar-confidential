import { createLogger } from '@stellar-confidential/core';
import {
  Ingestor,
  IntegrityService,
  MemoryEventStore,
  PostgresEventStore,
  ReferenceContractAdapter,
  StellarRpc,
  createCache,
  createPool,
  type EventStore,
} from '@stellar-confidential/indexer';
import { ApiServer } from './server.js';
import { loadIndexerConfig } from './config.js';

/**
 * Indexer service entry point.
 *
 * Runs ingestion and the archive API in one process: the API only reads what
 * ingestion has committed, so keeping them together removes a whole class of
 * "which one is behind" questions in development. Splitting them for a larger
 * deployment needs no code change — both sides talk only to the store.
 */
async function main(): Promise<void> {
  const config = loadIndexerConfig();
  const logger = createLogger(config.logLevel, { service: 'indexer' });

  const store: EventStore =
    config.databaseUrl === undefined
      ? new MemoryEventStore()
      : new PostgresEventStore(
          createPool({ connectionString: config.databaseUrl, max: config.databasePoolMax }),
        );

  if (config.databaseUrl === undefined) {
    logger.warn('DATABASE_URL is not set: running with an in-memory store, nothing is durable');
  }
  await store.migrate();

  const cache = await createCache(config.redisUrl);
  const adapter = new ReferenceContractAdapter();
  const integrity = new IntegrityService(store, cache);

  const rpc = new StellarRpc({ url: config.rpcUrl, logger });
  const ingestor = new Ingestor({
    rpc,
    store,
    adapter,
    logger,
    contractIds: config.contractIds,
    pageSize: config.pageSize,
    pollIntervalMs: config.pollIntervalMs,
    startLedger: config.startLedger,
  });

  const api = new ApiServer({
    store,
    integrity,
    logger,
    adapterId: adapter.id,
    ratePerMinute: config.ratePerMinute,
  });
  await api.listen(config.httpPort);

  const controller = new AbortController();
  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    controller.abort();
    void (async () => {
      await api.close();
      await cache.close();
      await store.close();
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('ingestion starting', {
    rpcUrl: config.rpcUrl,
    contracts: config.contractIds.length,
    adapter: adapter.id,
  });

  await ingestor.follow(controller.signal);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
