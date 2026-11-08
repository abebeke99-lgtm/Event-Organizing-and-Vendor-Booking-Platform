import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase, formatPostgresError, getPostgresFailureCode } from '../src/postgresDb.js';

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
