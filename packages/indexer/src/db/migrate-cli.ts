/**
 * Apply schema migrations.
 *
 *   pnpm migrate            apply everything outstanding
 *   pnpm migrate --status   list what is applied without changing anything
 *
 * Migrations also run automatically when a service starts, so this exists for
 * the cases where that is not what you want: preparing a database ahead of a
 * deploy, or checking what a database is actually running.
 */
import { createPool } from './pool.js';
import { PostgresEventStore } from './postgres-store.js';
import { MIGRATIONS } from './migrations.js';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const pool = createPool({ connectionString, applicationName: 'stellar-confidential-migrate' });
  const statusOnly = process.argv.includes('--status');

  try {
    if (!statusOnly) {
      await new PostgresEventStore(pool).migrate();
    }

    const { rows } = await pool.query<{ version: string; applied_at: Date }>(
      `SELECT version, applied_at FROM schema_migrations ORDER BY version`,
    );
    const applied = new Map(rows.map((row) => [row.version, row.applied_at]));

    for (const migration of MIGRATIONS) {
      const at = applied.get(migration.version);
      console.log(
        at === undefined
          ? `pending  ${migration.version}`
          : `applied  ${migration.version}  ${new Date(at).toISOString()}`,
      );
    }

    // A version in the database that this build does not know about means the
    // database is ahead of the code — usually a rollback that needs attention.
    for (const version of applied.keys()) {
      if (!MIGRATIONS.some((migration) => migration.version === version)) {
        console.error(`unknown  ${version}  (database is ahead of this build)`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
