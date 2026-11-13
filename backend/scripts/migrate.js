import '../src/lib/environment.js';
import { getDatabaseDialect } from '../src/lib/startupConfig.js';

const dialect = getDatabaseDialect();

if (dialect === 'postgres') {
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
    console.error(`PostgreSQL migration failed [${getPostgresFailureCode(error)}]: ${formatPostgresError(error)}`);
    process.exitCode = 1;
  } finally {
    if (database) await database.close();
  }
}