import 'dotenv/config';
import { getDatabaseDialect } from '../src/lib/startupConfig.js';

getDatabaseDialect();
const [
  { createPostgresDatabase, formatPostgresError, getPostgresFailureCode },
  { runPostgresMigrations },
] = await Promise.all([
  import('../src/postgresDb.js'),
  import('../src/lib/postgresMigrate.js'),
]);
let database;
try {
  database = createPostgresDatabase();
  await database.verifyMigrationConnection();
  const applied = await runPostgresMigrations(database);
  if (applied.length) {
    console.log(`Applied ${applied.length} PostgreSQL migration(s): ${applied.join(', ')}`);
  } else {
    console.log('PostgreSQL database is up to date.');
  }
} catch (error) {
  console.error(`PostgreSQL initialization failed [${getPostgresFailureCode(error)}]: ${formatPostgresError(error)}`);
  process.exitCode = 1;
} finally {
  if (database) {
    try {
      await database.close();
    } catch (error) {
      console.error(`Failed to close PostgreSQL database connections: ${formatPostgresError(error)}`);
      process.exitCode = 1;
    }
  }
}
