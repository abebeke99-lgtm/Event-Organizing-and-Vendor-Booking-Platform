import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { runPostgresMigrations } from '../src/lib/postgresMigrate.js';
import { postgresApplicationTables } from '../src/lib/postgresSchema.js';
import { createPostgresDatabase, formatPostgresError, getPostgresFailureCode } from '../src/postgresDb.js';

function postgresMajorVersion(version) {
  return Number(version.match(/\b(\d+)\./)?.[1]);
}

let database;
try {
  const environment = await loadNeonTestEnvironment();
  database = createPostgresDatabase(environment);
  const runtimeIdentity = await database.verifyRuntimeConnection();
  if (postgresMajorVersion(runtimeIdentity.server_version) !== 18) {
    throw new Error('The isolated Neon test database must use PostgreSQL 18.');
  }
  if (runtimeIdentity.database_name !== 'eventhub') {
    throw new Error('The pooled Neon test connection must target the isolated eventhub database.');
  }
  console.log('Neon pooled PostgreSQL 18 connection, current_database(), and SELECT 1: PASS.');

  const before = await database.runtimeAdapter.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const applied = await runPostgresMigrations(database, {
    allowedMigrations: [
      '001_initial_schema.sql',
      '002_full_feature_schema.sql',
      '003_legacy_constraint_parity.sql',
      '004_reporting_indexes.sql',
      '005_module_lock_timestamp.sql',
      '006_customer_role_seed.sql',
      '007_case_insensitive_user_email.sql',
      '008_vendor_dashboard_permissions.sql',
      '009_payment_status_width.sql',
      '010_customer_dashboard_permissions.sql',
    ],
  });
  if (applied.length) {
    console.log(`Applied ${applied.length} PostgreSQL test migration(s): ${applied.join(', ')}`);
  } else {
    console.log('PostgreSQL test database is up to date.');
  }

  const migrationRecords = await database.runtimeAdapter.query(
    'SELECT migration_name FROM schema_migrations ORDER BY migration_name',
  );
  const tables = await database.runtimeAdapter.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const foreignKeys = await database.runtimeAdapter.query(
    `SELECT COUNT(*)::integer AS count FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND contype = 'f'`,
  );
  const indexes = await database.runtimeAdapter.query(
    `SELECT COUNT(*)::integer AS count FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const recordedNames = migrationRecords.rows.map((row) => row.migration_name);
  const publicTableNames = tables.rows.map((row) => row.tablename);
  if (!recordedNames.includes('001_initial_schema.sql')
    || !recordedNames.includes('002_full_feature_schema.sql')
    || !recordedNames.includes('003_legacy_constraint_parity.sql')
    || !recordedNames.includes('004_reporting_indexes.sql')
    || !recordedNames.includes('005_module_lock_timestamp.sql')
    || !recordedNames.includes('006_customer_role_seed.sql')
    || !recordedNames.includes('007_case_insensitive_user_email.sql')
    || !recordedNames.includes('008_vendor_dashboard_permissions.sql')
    || !recordedNames.includes('009_payment_status_width.sql')
    || !recordedNames.includes('010_customer_dashboard_permissions.sql')
    || postgresApplicationTables.some((tableName) => !publicTableNames.includes(tableName))
    || publicTableNames.length !== postgresApplicationTables.length + 1) {
    throw new Error('PostgreSQL schema integrity check failed: expected migration record or core tables are missing.');
  }
  if (foreignKeys.rows[0]?.count < 1) {
    throw new Error('PostgreSQL schema integrity check failed: no public foreign keys were found.');
  }
  if (indexes.rows[0]?.count < postgresApplicationTables.length) {
    throw new Error('PostgreSQL schema integrity check failed: expected table indexes are missing.');
  }
  console.log(`Previously present public tables: ${before.rows.map((row) => row.tablename).join(', ') || '(none)'}`);
  console.log(`Applied migration records: ${recordedNames.join(', ') || '(none)'}`);
  console.log(`Public tables: ${publicTableNames.join(', ')}`);
  console.log(`Public foreign-key constraints: ${foreignKeys.rows[0].count} (PASS).`);
  console.log(`Public indexes (including primary/unique indexes): ${indexes.rows[0].count} (PASS).`);
} catch (error) {
  console.error(`Neon test migration failed [${getPostgresFailureCode(error)}]: ${formatPostgresError(error)}`);
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
