import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runPostgresMigrations, splitPostgresSqlStatements } from '../src/lib/postgresMigrate.js';

test('standard migration command selects PostgreSQL and fails closed without its connection URL', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/migrate.js', import.meta.url));
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: backendDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: '',
      DIRECT_URL: '',
      DB_SSL: 'true',
      NODE_ENV: 'test',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PostgreSQL migration failed \[DB_CONFIG_INVALID\]: .*DATABASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ECONNREFUSED|MySQL/);
});

test('isolated Neon migration script refuses to run without explicit target and authorization', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/migrate-neon-test.js', import.meta.url));
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const invalidArguments = [
    [],
    ['--target=isolated-neon-eventhub', '--target=isolated-neon-eventhub'],
    ['--target=wrong-database', '--authorize-allowlisted-migrations'],
    ['--target=isolated-neon-eventhub'],
  ];

  for (const arguments_ of invalidArguments) {
    const result = spawnSync(process.execPath, [scriptPath, ...arguments_], {
      cwd: backendDirectory,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing Neon test migrations/);
    assert.match(result.stderr, /--target=isolated-neon-eventhub/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /PostgreSQL operation failed|ECONNREFUSED/);
  }
});

test('database initialization selects PostgreSQL migrations without loading the MySQL schema path', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/db-init.js', import.meta.url));
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: backendDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: '',
      DIRECT_URL: '',
      DB_SSL: 'true',
      NODE_ENV: 'test',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PostgreSQL initialization failed \[DB_CONFIG_INVALID\]: .*DATABASE_URL is required/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ECONNREFUSED|MySQL|Applied idempotent schema\.sql/);
});

test('database health check validates PostgreSQL configuration without trying MySQL', () => {
  const scriptPath = fileURLToPath(new URL('../scripts/check-db.js', import.meta.url));
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: backendDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: '',
      DIRECT_URL: '',
      DB_SSL: 'true',
      NODE_ENV: 'test',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL Configuration: set valid values for DATABASE_URL/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ECONNREFUSED|MySQL/);
});

test('PostgreSQL SQL splitter preserves semicolons in strings and dollar-quoted bodies', () => {
  const statements = splitPostgresSqlStatements(`
    SELECT 'left;right', "a;b";
    CREATE FUNCTION f() RETURNS void AS $body$
    BEGIN
      PERFORM ';';
    END;
    $body$ LANGUAGE plpgsql;
    DO $$ BEGIN PERFORM 1; PERFORM 2; END $$;
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /PERFORM ';';/);
  assert.match(statements[2], /PERFORM 1; PERFORM 2;/);
});

test('full feature schema is additive and defines every legacy application table', async () => {
  const initial = await readFile(new URL('../postgres/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
  const extension = await readFile(new URL('../postgres/migrations/002_full_feature_schema.sql', import.meta.url), 'utf8');
  const tables = new Set(
    [...`${initial}\n${extension}`.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)]
      .map((match) => match[1]),
  );
  assert.equal(tables.size, 51);
  assert.match(extension, /ADD COLUMN IF NOT EXISTS/);
  assert.doesNotMatch(extension, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

test('initial PostgreSQL schema uses PostgreSQL types, constraints, and identity keys', async () => {
  const sql = await readFile(new URL('../postgres/migrations/001_initial_schema.sql', import.meta.url), 'utf8');

  assert.match(sql, /GENERATED BY DEFAULT AS IDENTITY/);
  assert.match(sql, /NUMERIC\(12,\s*2\)/);
  assert.match(sql, /TIMESTAMPTZ/);
  assert.match(sql, /JSONB NOT NULL/);
  assert.match(sql, /ON CONFLICT/);
  assert.match(sql, /REFERENCES users\(id\)/);
  assert.match(sql, /CHECK \(rating BETWEEN 1 AND 5\)/);
  assert.doesNotMatch(sql, /AUTO_INCREMENT|UNSIGNED|ENGINE\s*=\s*InnoDB|ON DUPLICATE KEY|INSERT IGNORE|MEDIUMBLOB|LONGBLOB/i);
});

test('vendor dashboard permissions are assigned only to active vendor roles', async () => {
  const sql = await readFile(new URL('../postgres/migrations/008_vendor_dashboard_permissions.sql', import.meta.url), 'utf8');

  assert.match(sql, /'services\.manage_own'/);
  assert.match(sql, /WHERE LOWER\(r\.name\) = 'vendor' AND r\.is_active = TRUE/);
  assert.match(sql, /ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('payment status width accommodates every PostgreSQL payment state without removing data', async () => {
  const sql = await readFile(new URL('../postgres/migrations/009_payment_status_width.sql', import.meta.url), 'utf8');

  assert.match(sql, /ALTER TABLE payments\s+ALTER COLUMN status TYPE VARCHAR\(24\)/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
});

test('customer permissions are granted idempotently only to active customer roles', async () => {
  const sql = await readFile(new URL('../postgres/migrations/010_customer_dashboard_permissions.sql', import.meta.url), 'utf8');

  assert.match(sql, /'favorites\.manage_own'/);
  assert.match(sql, /'messages\.view_own'/);
  assert.match(sql, /'notifications\.view_own'/);
  assert.match(sql, /'reviews\.create'/);
  assert.match(sql, /WHERE LOWER\(r\.name\) = 'customer'\s+AND r\.is_active = TRUE/);
  assert.match(sql, /ON CONFLICT \(role_id, permission_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('PostgreSQL migration runner sorts files and records successful migrations transactionally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-pg-migrations-'));
  const statements = [];
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '002_second.sql'), 'CREATE TABLE second_table(id INTEGER);');
    await writeFile(join(directory, '001_first.sql'), 'CREATE TABLE first_table(id INTEGER);');
    await writeFile(join(directory, 'not-a-migration.sql'), 'INVALID SQL');
    const database = {
      migrationPool: {},
      async inTransaction(work, pool) {
        assert.strictEqual(pool, this.migrationPool);
        const client = {
          async query(sql, values = []) {
            statements.push({ sql, values });
            if (sql.startsWith('SELECT migration_name')) {
              return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [] };
          },
        };
        return work(client);
      },
    };

    assert.deepEqual(await runPostgresMigrations(database, { directory }), ['001_first.sql', '002_second.sql']);
    assert.deepEqual(
      statements.filter(({ sql }) => sql.startsWith('INSERT INTO schema_migrations'))
        .map(({ values }) => values[0]),
      ['001_first.sql', '002_second.sql'],
    );
    assert.equal(statements.filter(({ sql }) => sql.startsWith('SELECT pg_advisory_xact_lock')).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL migration runner skips already-applied migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-pg-applied-'));
  const statements = [];
  try {
    await writeFile(join(directory, '001_first.sql'), 'CREATE TABLE first_table(id INTEGER);');
    const database = {
      migrationPool: {},
      async inTransaction(work) {
        return work({
          async query(sql) {
            statements.push(sql);
            if (sql.startsWith('SELECT migration_name')) {
              return { rowCount: 1, rows: [{ migration_name: '001_first.sql' }] };
            }
            return { rowCount: 1, rows: [] };
          },
        });
      },
    };
    assert.deepEqual(await runPostgresMigrations(database, { directory }), []);
    assert.equal(statements.includes('CREATE TABLE first_table(id INTEGER);'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL migration runner applies only explicitly approved migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-pg-approved-'));
  const executed = [];
  try {
    await writeFile(join(directory, '001_approved.sql'), 'CREATE TABLE approved_table(id INTEGER);');
    await writeFile(join(directory, '002_unapproved.sql'), 'CREATE TABLE unapproved_table(id INTEGER);');
    const database = {
      migrationPool: {},
      async inTransaction(work) {
        return work({
          async query(sql) {
            if (sql.startsWith('SELECT migration_name')) return { rowCount: 0, rows: [] };
            executed.push(sql);
            return { rowCount: 1, rows: [] };
          },
        });
      },
    };

    assert.deepEqual(
      await runPostgresMigrations(database, { directory, allowedMigrations: ['001_approved.sql'] }),
      ['001_approved.sql'],
    );
    assert.ok(executed.includes('CREATE TABLE approved_table(id INTEGER)'));
    assert.equal(executed.includes('CREATE TABLE unapproved_table(id INTEGER)'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
