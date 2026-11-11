import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase, formatPostgresError, getPostgresFailureCode } from '../src/postgresDb.js';
import { postgresApplicationTables } from '../src/lib/postgresSchema.js';

function postgresMajorVersion(version) {
  return Number(version.match(/\b(\d+)\./)?.[1]);
}

let database;
try {
  const environment = await loadNeonTestEnvironment();
  database = createPostgresDatabase(environment);
  const runtime = await database.verifyRuntimeConnection();
  const migration = await database.verifyMigrationConnection();
  if (postgresMajorVersion(runtime.server_version) !== 18 || postgresMajorVersion(migration.server_version) !== 18) {
    throw new Error('The isolated Neon test database must use PostgreSQL 18.');
  }
  if (runtime.database_name !== 'eventhub' || migration.database_name !== 'eventhub') {
    throw new Error('Both Neon test connections must target the isolated eventhub database.');
  }
  const schema = await database.runtimeAdapter.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE')::integer AS table_count,
       (SELECT COUNT(*) FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND contype = 'f')::integer AS foreign_key_count,
       (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public')::integer AS index_count`,
  );
  const tables = await database.runtimeAdapter.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const appliedMigrations = await database.runtimeAdapter.query(
    'SELECT migration_name FROM schema_migrations ORDER BY migration_name',
  );
  const actualTables = new Set(tables.rows.map((row) => row.tablename));
  const missingTables = postgresApplicationTables.filter((tableName) => !actualTables.has(tableName));
  if (missingTables.length) {
    throw new Error(`The isolated Neon test database is missing application tables: ${missingTables.join(', ')}.`);
  }
  console.log('Neon test pooled connection: PASS (PostgreSQL 18).');
  console.log('Neon test direct connection: PASS (PostgreSQL 18).');
  console.log(
    `Neon test schema: ${postgresApplicationTables.length} application tables present; `
      + `${schema.rows[0].table_count} public tables, ${schema.rows[0].foreign_key_count} foreign keys, `
      + `${schema.rows[0].index_count} indexes.`,
  );
  console.log(`Applied Neon test migrations: ${appliedMigrations.rows.map((row) => row.migration_name).join(', ')}.`);
} catch (error) {
  console.error(`Neon test database check failed [${getPostgresFailureCode(error)}]: ${formatPostgresError(error)}`);
  process.exitCode = 1;
} finally {
  if (database) {
    try {
      await database.close();
    } catch (error) {
      console.error(`Failed to close PostgreSQL test connections: ${formatPostgresError(error)}`);
      process.exitCode = 1;
    }
  }
}
