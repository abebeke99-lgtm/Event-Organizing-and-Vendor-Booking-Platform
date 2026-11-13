import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createPostgresPoolConfig, getPostgresConfigurationErrors } from '../src/lib/postgresConfig.js';
import {
  defaultNeonTestEnvironmentPath,
  loadNeonTestEnvironment,
} from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase, formatPostgresError, getPostgresFailureCode } from '../src/postgresDb.js';

const neonTestEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test-user:test-password@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
  DIRECT_URL: 'postgresql://test-user:test-password@ep-eventhub.us-east-2.aws.neon.tech/eventhub?sslmode=require',
};

function neonUrls(database = 'eventhub') {
  return {
    DATABASE_URL: `postgresql://test-user:test-password@ep-test-pooler.us-east-2.aws.neon.tech/${database}?sslmode=require&channel_binding=require`,
    DIRECT_URL: `postgresql://test-user:test-password@ep-test.us-east-2.aws.neon.tech/${database}?sslmode=require&channel_binding=require`,
  };
}

function verifiedTlsUrl(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

test('PostgreSQL config uses separate Neon pooled and direct endpoints', () => {
  assert.deepEqual(getPostgresConfigurationErrors(neonTestEnvironment), []);
  const runtime = createPostgresPoolConfig(neonTestEnvironment);
  const migration = createPostgresPoolConfig(neonTestEnvironment, { purpose: 'migration' });

  assert.equal(runtime.connectionString, neonTestEnvironment.DATABASE_URL);
  assert.equal(runtime.max, 4);
  assert.equal(runtime.connectionTimeoutMillis, 15000);
  assert.equal(runtime.idleTimeoutMillis, 10000);
  assert.equal(runtime.keepAlive, true);
  assert.equal(runtime.keepAliveInitialDelayMillis, 10000);
  assert.equal(runtime.application_name, 'eventhub-api');
  assert.deepEqual(runtime.ssl, { rejectUnauthorized: true });
  assert.equal(migration.connectionString, neonTestEnvironment.DIRECT_URL);
  assert.equal(migration.max, 2);
  assert.equal(migration.application_name, 'eventhub-migrations');
  assert.deepEqual(migration.ssl, { rejectUnauthorized: true });
});

test('Neon TLS normalizes require to verify-full without disabling certificate validation', () => {
  const urls = neonUrls();
  const config = createPostgresPoolConfig({
    NODE_ENV: 'test',
    DATABASE_URL: urls.DATABASE_URL,
    DIRECT_URL: urls.DIRECT_URL,
    DB_SSL: 'true',
  });
  const normalized = new URL(config.connectionString);
  assert.equal(normalized.searchParams.get('sslmode'), 'verify-full');
  assert.equal(normalized.searchParams.get('channel_binding'), 'require');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });

  const explicitVerifiedUrl = {
    NODE_ENV: 'test',
    DATABASE_URL: verifiedTlsUrl(urls.DATABASE_URL),
    DIRECT_URL: verifiedTlsUrl(urls.DIRECT_URL),
    DB_SSL: 'true',
  };
  assert.deepEqual(getPostgresConfigurationErrors(explicitVerifiedUrl), []);
  assert.equal(createPostgresPoolConfig(explicitVerifiedUrl).connectionString, explicitVerifiedUrl.DATABASE_URL);
});

test('PostgreSQL runtime requires only the pooled URL while migrations require the direct URL', () => {
  const runtimeEnvironment = { DATABASE_URL: neonTestEnvironment.DATABASE_URL };
  assert.deepEqual(getPostgresConfigurationErrors(runtimeEnvironment, { purpose: 'runtime' }), []);
  assert.throws(
    () => createPostgresPoolConfig(runtimeEnvironment, { purpose: 'migration' }),
    /DIRECT_URL is required/,
  );
});

test('PostgreSQL runtime rejects non-Neon providers and accepts Neon pooled and direct endpoints', () => {
  const environment = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app-user:app-password@db.example.test:5432/event_app?sslmode=verify-full',
    DIRECT_URL: 'postgresql://migration-user:migration-password@db.example.test:5432/event_app?sslmode=verify-full',
  };
  assert.ok(getPostgresConfigurationErrors(environment, { purpose: 'migration' })
    .some((error) => error.includes('credentialed Neon PostgreSQL URL')));

  const neonEnvironment = {
    NODE_ENV: 'production',
    ...neonUrls('event_app'),
  };
  assert.deepEqual(getPostgresConfigurationErrors(neonEnvironment, { purpose: 'migration' }), []);
  assert.equal(createPostgresPoolConfig(neonEnvironment).max, 4);
  assert.deepEqual(createPostgresPoolConfig(neonEnvironment).ssl, { rejectUnauthorized: true });
  assert.equal(
    createPostgresPoolConfig(neonEnvironment, { purpose: 'migration' }).connectionString,
    verifiedTlsUrl(neonEnvironment.DIRECT_URL),
  );
});

test('Neon PostgreSQL requires TLS and cannot use local or non-Neon endpoints', () => {
  const environment = {
    NODE_ENV: 'development',
    DB_SSL: 'false',
    DATABASE_URL: 'postgresql://app-user:app-password@localhost:5432/event_app?sslmode=disable',
  };
  assert.ok(getPostgresConfigurationErrors(environment, { purpose: 'runtime' })
    .some((error) => error.includes('credentialed Neon PostgreSQL URL')));

  const neonWithSslDisabled = {
    NODE_ENV: 'development',
    DB_SSL: 'false',
    DATABASE_URL: neonUrls().DATABASE_URL,
  };
  assert.ok(getPostgresConfigurationErrors(neonWithSslDisabled, { purpose: 'runtime' })
    .some((error) => error.includes('sslmode conflicts with DB_SSL=false')));
});

test('PostgreSQL config rejects missing, malformed, non-TLS Neon, and role-swapped URLs', () => {
  assert.ok(getPostgresConfigurationErrors({}).some((error) => error.startsWith('DATABASE_URL')));
  assert.ok(getPostgresConfigurationErrors({
    ...neonTestEnvironment,
    DATABASE_URL: 'not a URL',
  }).some((error) => error.startsWith('DATABASE_URL must be a valid Neon PostgreSQL URL')));
  assert.ok(getPostgresConfigurationErrors({
    ...neonTestEnvironment,
    DATABASE_URL: 'postgresql://user:password@ep-eventhub-pooler.us-east-2.aws.neon.tech/app',
  }).some((error) => error.includes('sslmode=require')));
  assert.ok(getPostgresConfigurationErrors({
    ...neonTestEnvironment,
    DATABASE_URL: neonTestEnvironment.DIRECT_URL,
  }).some((error) => error.includes('pooled endpoint')));
  assert.ok(getPostgresConfigurationErrors({
    ...neonTestEnvironment,
    DIRECT_URL: neonTestEnvironment.DATABASE_URL,
  }).some((error) => error.includes('direct endpoint')));
  assert.throws(
    () => createPostgresPoolConfig({ ...neonTestEnvironment, DIRECT_URL: '' }, { purpose: 'migration' }),
    /PostgreSQL configuration is incomplete or invalid/,
  );
});

test('Neon test config loads only explicit local values without changing production env', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-test-'));
  const filePath = join(directory, '.env.neon-test');
  try {
    await writeFile(filePath, `DATABASE_URL=${neonTestEnvironment.DATABASE_URL}\nDIRECT_URL=${neonTestEnvironment.DIRECT_URL}\n`);
    const environment = { NODE_ENV: 'development', DB_SSL: 'false', DATABASE_URL: 'postgresql://ignored' };
    const loaded = await loadNeonTestEnvironment({ environment, filePath });
    assert.equal(loaded.NODE_ENV, 'test');
    assert.equal(loaded.DB_SSL, 'true');
    assert.equal(loaded.DATABASE_URL, neonTestEnvironment.DATABASE_URL);
    assert.equal(loaded.DIRECT_URL, neonTestEnvironment.DIRECT_URL);
    assert.equal(environment.DATABASE_URL, 'postgresql://ignored');
    assert.equal(environment.DB_SSL, 'false');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Neon test loader accepts BOM, CRLF, comments, export, spaces, quotes, and preserves channel binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-formats-'));
  const filePath = join(directory, '.env.neon-test');
  const urls = neonUrls();
  try {
    await writeFile(
      filePath,
      `\uFEFF# ignored comment\r\nexport DATABASE_URL = "${urls.DATABASE_URL}" # pooled\r\n DIRECT_URL = '${urls.DIRECT_URL}'\r\n`,
    );
    const loaded = await loadNeonTestEnvironment({ environment: {}, filePath });
    assert.deepEqual(
      { DATABASE_URL: loaded.DATABASE_URL, DIRECT_URL: loaded.DIRECT_URL },
      urls,
    );
    assert.equal(new URL(loaded.DATABASE_URL).searchParams.get('channel_binding'), 'require');
    assert.equal(new URL(loaded.DIRECT_URL).searchParams.get('channel_binding'), 'require');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('default Neon test env path is absolute and anchored to the backend regardless of process cwd', () => {
  assert.equal(isAbsolute(defaultNeonTestEnvironmentPath), true);
  assert.match(defaultNeonTestEnvironmentPath, /backend[\\/]\.env\.neon-test$/);
  assert.equal(resolve(defaultNeonTestEnvironmentPath), defaultNeonTestEnvironmentPath);
});

test('Neon test config identifies missing and empty names with the resolved path but no values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-empty-'));
  const filePath = join(directory, '.env.neon-test');
  try {
    await writeFile(filePath, '\uFEFF# local test URLs\r\nDATABASE_URL =   # not configured\r\nDIRECT_URL=\r\n');
    await assert.rejects(
      loadNeonTestEnvironment({ filePath }),
      (error) => {
        assert.match(error.message, /DATABASE_URL, DIRECT_URL/);
        assert.ok(error.message.includes(filePath));
        assert.doesNotMatch(error.message, /postgresql|password|secret/i);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Neon test config refuses production and reports a missing file safely', async () => {
  await assert.rejects(
    loadNeonTestEnvironment({ environment: { NODE_ENV: 'production' } }),
    /cannot be loaded in production/,
  );
  await assert.rejects(
    loadNeonTestEnvironment({ filePath: join(tmpdir(), 'missing-eventhub-neon-test.env') }),
    /Neon test configuration file could not be read:.*missing-eventhub-neon-test\.env/,
  );
});

test('Neon test loader rejects a wrong database name without exposing URL credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-wrong-db-'));
  const filePath = join(directory, '.env.neon-test');
  const urls = neonUrls('enam%20bekele');
  try {
    await writeFile(filePath, `DATABASE_URL=${urls.DATABASE_URL}\nDIRECT_URL=${urls.DIRECT_URL}\n`);
    await assert.rejects(
      loadNeonTestEnvironment({ filePath }),
      (error) => {
        assert.match(error.message, /DATABASE_URL must target the isolated eventhub database/);
        assert.match(error.message, /DIRECT_URL must target the isolated eventhub database/);
        assert.doesNotMatch(error.message, /test-password|test-user|ep-test/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Neon test config rejects pooled and direct endpoints from different Neon projects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-mismatched-project-'));
  const filePath = join(directory, '.env.neon-test');
  const urls = neonUrls();
  const wrongDirectUrl = urls.DIRECT_URL.replace('ep-test.', 'ep-another-project.');
  try {
    await writeFile(filePath, `DATABASE_URL=${urls.DATABASE_URL}\nDIRECT_URL=${wrongDirectUrl}\n`);
    await assert.rejects(
      loadNeonTestEnvironment({ filePath }),
      /DATABASE_URL and DIRECT_URL must target the same Neon endpoint/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Neon test loader rejects malformed, non-PostgreSQL, and non-TLS URLs with sanitized diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eventhub-neon-invalid-'));
  const filePath = join(directory, '.env.neon-test');
  const invalidCases = [
    { database: 'not a URL', expected: /DATABASE_URL must be a valid Neon PostgreSQL URL/ },
    {
      database: 'mysql://test-user:test-password@ep-test-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
      expected: /DATABASE_URL must be a credentialed Neon PostgreSQL URL with sslmode=require or sslmode=verify-full/,
    },
    {
      database: 'postgresql://test-user:test-password@ep-test-pooler.us-east-2.aws.neon.tech/eventhub',
      expected: /DATABASE_URL must be a credentialed Neon PostgreSQL URL with sslmode=require or sslmode=verify-full/,
    },
  ];
  try {
    for (const { database: databaseUrl, expected } of invalidCases) {
      const urls = neonUrls();
      await writeFile(filePath, `DATABASE_URL=${databaseUrl}\nDIRECT_URL=${urls.DIRECT_URL}\n`);
      await assert.rejects(
        loadNeonTestEnvironment({ filePath }),
        (error) => {
          assert.match(error.message, expected);
          assert.doesNotMatch(error.message, /test-password|test-user/);
          return true;
        },
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL error helpers return sanitized messages and stable categories', () => {
  const error = {
    code: '23505',
    message: 'duplicate value for <private-value>',
    detail: 'Key value <private-value>',
  };
  assert.equal(formatPostgresError(error), 'PostgreSQL error 23505: A database record already exists.');
  assert.equal(getPostgresFailureCode(error), 'DB_CONNECT_FAILED');
  assert.equal(getPostgresFailureCode({ code: '28P01' }), 'DB_AUTH_FAILED');
  assert.equal(getPostgresFailureCode({ message: 'certificate verify failed' }), 'DB_TLS_FAILED');

  const connectionFailure = new AggregateError([
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
  ], 'transaction rollback failed');
  assert.equal(formatPostgresError(connectionFailure), 'PostgreSQL operation failed (ECONNRESET).');
  assert.equal(getPostgresFailureCode(connectionFailure), 'DB_CONNECT_FAILED');
});

test('PostgreSQL transactions commit, roll back, release clients, and close pools', async () => {
  const poolCalls = [];
  const clientCalls = [];
  const releases = [];
  const fakePoolFactory = (config) => {
    const calls = [];
    poolCalls.push({ config, calls });
    return {
      async connect() {
        return {
          async query(statement) {
            calls.push(statement);
            clientCalls.push(statement);
            return {
              rows: [{ database_name: 'eventhub', server_version: '18.0' }],
              rowCount: 1,
            };
          },
          release() {
            releases.push(true);
          },
        };
      },
      async query(statement) {
        calls.push(statement);
        return {
          rows: [{ database_name: 'eventhub', server_version: '18.0' }],
        };
      },
      async end() {
        calls.push('END');
      },
    };
  };
  const database = createPostgresDatabase(neonTestEnvironment, { poolFactory: fakePoolFactory });

  assert.equal(await database.inTransaction(async () => 'committed'), 'committed');
  await assert.rejects(
    database.inTransaction(async () => {
      throw new Error('transaction test failure');
    }),
    /transaction test failure/,
  );
  assert.deepEqual(clientCalls, ['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
  assert.equal(releases.length, 2);
  assert.equal(await database.verifyRuntimeConnection().then((result) => result.server_version), '18.0');
  assert.equal(await database.verifyMigrationConnection().then((result) => result.server_version), '18.0');

  const closing = database.close();
  assert.equal(database.close(), closing);
  await closing;
  assert.ok(poolCalls.every(({ calls }) => calls.includes('END')));
  assert.ok(poolCalls.every(({ calls }) => calls.filter((call) => call === 'END').length === 1));
  assert.equal(poolCalls[0].config.connectionString, neonTestEnvironment.DATABASE_URL);
  assert.equal(poolCalls[1].config.connectionString, neonTestEnvironment.DIRECT_URL);
});

test('PostgreSQL check errors distinguish missing configuration without exposing URLs', () => {
  const error = new Error('Neon test configuration is unavailable; configure backend/.env.neon-test locally.');
  assert.equal(getPostgresFailureCode(error), 'DB_CONFIG_INVALID');
  assert.equal(formatPostgresError(error), error.message);
});
