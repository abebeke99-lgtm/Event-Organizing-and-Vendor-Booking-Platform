import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const migrationDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`);
const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
for (const name of files) {
  const [applied] = await pool.execute('SELECT migration_name FROM schema_migrations WHERE migration_name = ?', [name]);
  if (applied.length) continue;
  const sql = await readFile(join(migrationDir, name), 'utf8');
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await pool.query(statement);
  await pool.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [name]);
  console.log(`Applied migration ${name}`);
}
await pool.end();
