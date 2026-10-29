import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { pool } from '../src/db.js';
import { runMigrations, splitSqlStatements } from '../src/lib/migrate.js';

const database = String(process.env.DB_NAME || '').trim();
if (!/^[A-Za-z0-9_]+$/.test(database)) {
  console.error('Set DB_NAME to a valid database identifier before running db:init.');
  process.exit(1);
}

const useSsl = process.env.DB_SSL === 'true';
const adminConnection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ...(useSsl ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {})
});

try {
  await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`Database ${database} is ready.`);
} finally {
  await adminConnection.end();
}

await runMigrations(pool);

const seedPath = fileURLToPath(new URL('../seed.sql', import.meta.url));
const seedSql = await readFile(seedPath, 'utf8');
for (const statement of splitSqlStatements(seedSql)) {
  await pool.query(statement);
}
console.log('Applied seed.sql');
await pool.end();
