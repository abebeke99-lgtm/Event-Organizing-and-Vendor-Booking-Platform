import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const dialect = process.env.DB_DIALECT?.trim() || 'mysql';

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
} else if (dialect === 'mysql') {
  const [{ pool }, { runMigrations }] = await Promise.all([
    import('../src/db.js'),
    import('../src/lib/migrate.js'),
  ]);

  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
} else {
  console.error('DB_DIALECT must be set to mysql or postgres.');
  process.exitCode = 1;
}