import { createLogger, isLogLevel } from '@stellar-confidential/core';
import {
  MemoryEventStore,
  PostgresEventStore,
  createPool,
  type EventStore,
} from '@stellar-confidential/indexer';
import { RecoveryServer } from './server.js';

async function main(): Promise<void> {
  const level = process.env['LOG_LEVEL'] ?? 'info';
  if (!isLogLevel(level)) throw new Error('LOG_LEVEL must be one of debug|info|warn|error');
  const logger = createLogger(level, { service: 'recovery' });

  const databaseUrl = process.env['DATABASE_URL'];
  const store: EventStore =
    databaseUrl === undefined
      ? new MemoryEventStore()
      : new PostgresEventStore(createPool({ connectionString: databaseUrl }));
  await store.migrate();

  const port = Number(process.env['RECOVERY_HTTP_PORT'] ?? 4010);
  const server = new RecoveryServer({ store, logger });
  await server.listen(port);

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    void (async () => {
      await server.close();
      await store.close();
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
