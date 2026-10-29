import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from '../db.js';

const migrationDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

export function splitSqlStatements(sql = '') {
  const statements = [];
  let current = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        current += char;
      }
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\' && quote !== '`') {
        current += next ?? '';
        index += 1;
      } else if (char === quote) {
        if (next === quote && quote !== '`') {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '#') {
      lineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

export async function runMigrations(db = pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
  const appliedMigrations = [];

  for (const name of files) {
    const [applied] = await db.execute('SELECT migration_name FROM schema_migrations WHERE migration_name = ?', [name]);
    if (applied.length) continue;

    const sql = await readFile(join(migrationDir, name), 'utf8');
    for (const statement of splitSqlStatements(sql)) {
      await db.query(statement);
    }
    await db.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [name]);
    appliedMigrations.push(name);
    console.log(`Applied migration ${name}`);
  }

  return appliedMigrations;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await runMigrations();
  } finally {
    await pool.end();
  }
}
