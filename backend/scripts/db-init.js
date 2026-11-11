import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDatabaseDialect } from '../src/lib/startupConfig.js';

if (getDatabaseDialect() === 'postgres') {
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
} else {
  const [{ pool }, { runMigrations, splitSqlStatements }] = await Promise.all([
    import('../src/db.js'),
    import('../src/lib/migrate.js'),
  ]);

  try {
    await runMigrations(pool);

    const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
    const schemaSql = await readFile(schemaPath, 'utf8');
    for (const statement of splitSqlStatements(schemaSql)) {
      await pool.query(statement);
    }
    console.log('Applied idempotent schema.sql.');

    const seedPath = fileURLToPath(new URL('../seed.sql', import.meta.url));
    const seedSql = await readFile(seedPath, 'utf8');
    for (const statement of splitSqlStatements(seedSql)) {
      await pool.query(statement);
    }
    console.log('Applied seed.sql.');
  } catch (error) {
    console.error(`Database initialization failed (${error.code || error.name || 'ERROR'}). Check database access and migration SQL.`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
