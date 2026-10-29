import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const root = new URL('../', import.meta.url);
for (const name of ['schema.sql', 'seed.sql']) {
  const sql = await readFile(fileURLToPath(new URL(name, root)), 'utf8');
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  console.log(`Applied ${name}`);
}
await pool.end();
