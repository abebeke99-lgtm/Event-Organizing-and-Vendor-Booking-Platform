import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { runMigrations, splitSqlStatements } from '../src/lib/migrate.js';

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
