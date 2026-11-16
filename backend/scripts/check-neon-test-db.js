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
  console.log('Neon test pooled connection: PASS (PostgreSQL 18).');
  console.log('Neon test direct connection: PASS (PostgreSQL 18).');
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
  const identityColumns = await database.runtimeAdapter.query(
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name IN ('digital_id', 'fid_number')`,
  );
  const identityIntegrity = await database.runtimeAdapter.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM users
        WHERE digital_id IS NULL OR BTRIM(digital_id) = '') AS missing_digital_ids,
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'users'
           AND indexname = 'uq_users_digital_id'
           AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
       ) AS has_unique_digital_id`,
  );
  const actualTables = new Set(tables.rows.map((row) => row.tablename));
  const missingTables = postgresApplicationTables.filter((tableName) => !actualTables.has(tableName));
  console.log(
    `Neon test schema: ${postgresApplicationTables.length - missingTables.length} of `
      + `${postgresApplicationTables.length} application tables present; `
      + `${schema.rows[0].table_count} public tables, ${schema.rows[0].foreign_key_count} foreign keys, `
      + `${schema.rows[0].index_count} indexes.`,
  );
  if (missingTables.length) {
    const error = new Error(
      `The isolated Neon test database is missing application tables: ${missingTables.join(', ')}.`,
    );
    error.code = 'DB_SCHEMA_INCOMPLETE';
    throw error;
  }
  const identityNullability = new Map(
    identityColumns.rows.map((column) => [column.column_name, column.is_nullable]),
  );
  if (identityNullability.get('digital_id') !== 'NO'
    || identityNullability.get('fid_number') !== 'YES'
    || identityIntegrity.rows[0].missing_digital_ids !== 0
    || !identityIntegrity.rows[0].has_unique_digital_id
    || !appliedMigrations.rows.some((row) => row.migration_name === '018_user_digital_and_fid_ids.sql')) {
    const error = new Error(
      'The isolated Neon user identity schema is missing required columns, values, or uniqueness.',
    );
    error.code = 'DB_SCHEMA_INCOMPLETE';
    throw error;
  }
  console.log('Neon test user identity schema: digital IDs are populated and unique; FID is nullable (PASS).');
  console.log(`Applied Neon test migrations: ${appliedMigrations.rows.map((row) => row.migration_name).join(', ')}.`);
} catch (error) {
  const isIncompleteSchema = error.code === 'DB_SCHEMA_INCOMPLETE';
  const failureCode = isIncompleteSchema ? error.code : getPostgresFailureCode(error);
  const message = isIncompleteSchema ? error.message : formatPostgresError(error);
  console.error(`Neon test database check failed [${failureCode}]: ${message}`);
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
