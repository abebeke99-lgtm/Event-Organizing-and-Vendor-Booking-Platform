import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationDirectory = fileURLToPath(new URL('../../postgres/migrations/', import.meta.url));

export function splitPostgresSqlStatements(sql = '') {
  const statements = [];
  let current = '';
  let quote = null;
  let dollarQuote = null;
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
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, index)) {
        current += dollarQuote;
        index += dollarQuote.length - 1;
        dollarQuote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
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
    } else if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (char === '\'' || char === '"') {
      quote = char;
      current += char;
    } else if (char === '$') {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        dollarQuote = delimiter;
        current += delimiter;
        index += delimiter.length - 1;
      } else {
        current += char;
      }
    } else if (char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
    } else {
      current += char;
    }
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

export async function runPostgresMigrations(database, {
  directory = migrationDirectory,
  allowedMigrations,
} = {}) {
  const discoveredFiles = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
  const files = allowedMigrations
    ? allowedMigrations.filter((name) => discoveredFiles.includes(name)).sort()
    : discoveredFiles;
  if (allowedMigrations?.some((name) => !discoveredFiles.includes(name))) {
    throw new Error('An explicitly approved PostgreSQL migration file is missing.');
  }
  const appliedMigrations = [];

  for (const name of files) {
    const sql = await readFile(join(directory, name), 'utf8');
    const wasApplied = await database.inTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['eventhub-postgres-migrations']);
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const applied = await client.query(
        'SELECT migration_name FROM schema_migrations WHERE migration_name = $1',
        [name],
      );
      if (applied.rowCount) return true;

      for (const statement of splitPostgresSqlStatements(sql)) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [name]);
      return false;
    }, database.migrationPool);

    if (!wasApplied) appliedMigrations.push(name);
  }

  return appliedMigrations;
}
