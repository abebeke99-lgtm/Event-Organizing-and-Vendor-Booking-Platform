import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { rootCertificates } from 'node:tls';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import {
  createDatabaseConfig,
  formatDatabaseError,
  getDatabaseFailureCode,
  getDatabaseConfigurationErrors,
  verifyDatabaseConnection,
} from '../src/db.js';
import { getDatabaseDialect, getStartupConfigurationErrors } from '../src/lib/startupConfig.js';
import { getCookieOptions } from '../src/lib/cookieOptions.js';
import { requireAdmin } from '../src/middleware/requireAdmin.js';
import { requirePlatformUser } from '../src/middleware/requirePlatformUser.js';

const databaseCredentials = {
  DB_DIALECT: 'postgres',
  DATABASE_URL: 'postgresql://test-user:test-password@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
  DB_SSL: 'true',
};

test('database TLS verifies certificates and normalizes escaped CA newlines', () => {
  const certificateAuthority = rootCertificates[0];
  const config = createDatabaseConfig({
    ...databaseCredentials,
    DB_SSL_CA: certificateAuthority.replace(/\n/g, '\\n'),
  });
  assert.equal(config.database, 'eventhub');
  assert.equal(config.port, 5432);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: certificateAuthority.trim(),
  });
});

test('database TLS loads and verifies CA certificates from a file path', () => {
  const certificateAuthority = rootCertificates[0];
  const directory = mkdtempSync(join(tmpdir(), 'event-platform-ca-'));
  const certificatePath = join(directory, 'ca.pem');
  try {
    writeFileSync(certificatePath, certificateAuthority);
    const config = createDatabaseConfig({
      ...databaseCredentials,
      DB_SSL_CA: certificatePath,
    });
    assert.equal(config.ssl.ca, certificateAuthority.trim());
    assert.equal(config.ssl.rejectUnauthorized, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('database TLS uses system certificate authorities when no custom CA is supplied', () => {
  const config = createDatabaseConfig({ ...databaseCredentials, DB_SSL: 'true' });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('database TLS rejects an invalid custom CA certificate', () => {
  assert.throws(
    () => createDatabaseConfig({
      ...databaseCredentials,
      DB_SSL_CA: '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----',
    }),
    /DB_SSL_CA or DB_SSL_CA_BASE64/,
  );
});

test('production database configuration requires a Neon DATABASE_URL and TLS but not a custom CA', () => {
  assert.deepEqual(getDatabaseConfigurationErrors({}, { requireTls: true })
    .map((error) => error.split(/[ (]/)[0]), [
    'DATABASE_URL',
    'DB_SSL',
  ]);
});

test('DATABASE_URL supplies the PostgreSQL connection credentials', () => {
  const config = createDatabaseConfig({
    DATABASE_URL: 'postgresql://db-user:pass%40word@ep-eventhub-pooler.us-east-2.aws.neon.tech/events?sslmode=require',
    DB_SSL: 'true',
  });
  assert.equal(config.host, 'ep-eventhub-pooler.us-east-2.aws.neon.tech');
  assert.equal(config.port, 5432);
  assert.equal(config.database, 'events');
  assert.equal(config.user, 'db-user');
  assert.equal(config.password, 'pass@word');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('production database configuration rejects loopback database hosts', () => {
  const productionDatabaseSettings = { NODE_ENV: 'production', DB_SSL: 'true', DB_DIALECT: 'postgres' };
  const errors = getDatabaseConfigurationErrors({
    ...databaseCredentials,
    ...productionDatabaseSettings,
    DATABASE_URL: 'postgresql://validation-user:placeholder-only@127.0.0.1/eventhub?sslmode=require',
  });
  assert.ok(errors.some((error) => error.startsWith('DATABASE_URL ')));
  assert.equal(getDatabaseConfigurationErrors({
    ...databaseCredentials,
    ...productionDatabaseSettings,
  }).length, 0);
});

test('production configuration accepts DATABASE_URL with verified TLS and secure cross-site cookies', () => {
  const configuration = {
    DB_DIALECT: 'postgres',
    DATABASE_URL: 'postgresql://validation-user:placeholder-only@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
    DB_SSL: 'true',
    WEB_ORIGIN: 'https://infobekele.netlify.app',
    COOKIE_SECURE: 'true',
    COOKIE_SAME_SITE: 'none',
    NODE_ENV: 'production',
  };

  assert.deepEqual(getStartupConfigurationErrors(configuration), []);
});

test('database TLS accepts a base64-encoded custom CA', () => {
  const certificateAuthority = rootCertificates[0];
  const config = createDatabaseConfig({
    ...databaseCredentials,
    DB_SSL_CA_BASE64: Buffer.from(certificateAuthority).toString('base64'),
  });
  assert.equal(config.ssl.ca, certificateAuthority.trim());
});

test('database TLS is omitted when SSL is disabled for local development', () => {
  const config = createDatabaseConfig({
    ...databaseCredentials,
    DATABASE_URL: 'postgresql://test-user:test-password@127.0.0.1:5432/eventhub?sslmode=disable',
    DB_SSL: 'false',
  });

  assert.equal('ssl' in config, false);
});

test('database pool has a bounded connection timeout', () => {
  const config = createDatabaseConfig(databaseCredentials);

  assert.equal(config.connectionTimeoutMillis, 15000);
});

test('database verifier executes the PostgreSQL database identity query', async () => {
  const statements = [];
  await verifyDatabaseConnection({
    async query(statement) {
      statements.push(statement);
      return { rows: [{ server_version: 'PostgreSQL 16', database_name: 'eventhub' }] };
    },
  });

  assert.deepEqual(statements, ['SELECT version() AS server_version, current_database() AS database_name']);
});

test('database verifier checks the selected database when requested', async () => {
  const statements = [];
  await verifyDatabaseConnection({
    async query(statement) {
      statements.push(statement);
      return { rows: [{ server_version: 'PostgreSQL 16', database_name: 'defaultdb' }] };
    },
  }, 'defaultdb');

  assert.deepEqual(statements, ['SELECT version() AS server_version, current_database() AS database_name']);
});

test('database verifier rejects a connection to a different database', async () => {
  await assert.rejects(
    verifyDatabaseConnection({
      async query() {
        return { rows: [{ server_version: 'PostgreSQL 16', database_name: 'unexpected' }] };
      },
    }, 'defaultdb'),
    { message: 'Connected database does not match DB_NAME.' },
  );
});

test('database diagnostics retain error details while redacting passwords and connection strings', () => {
  const error = Object.assign(new Error(
    'password=secret-pass postgresql://test-user:secret-pass@db.example.test:5432/eventhub?sslmode=require',
  ), { code: '28P01' });

  const diagnostic = formatDatabaseError(error, 'secret-pass');

  assert.match(diagnostic, /28P01/);
  assert.doesNotMatch(diagnostic, /secret-pass/);
  assert.doesNotMatch(diagnostic, /test-user:secret-pass/);
});

test('database failure diagnostics map to safe reason codes', () => {
  assert.equal(getDatabaseFailureCode({ code: '28P01' }), 'DB_AUTH_FAILED');
  assert.equal(getDatabaseFailureCode({ code: 'CERT_HAS_EXPIRED' }), 'DB_TLS_FAILED');
  assert.equal(getDatabaseFailureCode({ code: 'ECONNREFUSED' }), 'DB_CONNECT_FAILED');
  assert.equal(getDatabaseFailureCode(new Error('Connected database does not match DB_NAME.')), 'DB_NAME_MISMATCH');
});

test('startup configuration validation reports missing environment variable names only', () => {
  const errors = getStartupConfigurationErrors({ DB_DIALECT: 'postgres' });
  assert.deepEqual(errors.map((error) => error.split(/[ (]/)[0]), [
    'DATABASE_URL',
    'NODE_ENV',
    'WEB_ORIGIN',
    'COOKIE_SECURE',
    'COOKIE_SAME_SITE',
  ]);
  assert.equal(new Set(errors).size, errors.length);
});

test('database dialect defaults to postgres and rejects MySQL or invalid values', () => {
  assert.equal(getDatabaseDialect({}), 'postgres');
  assert.equal(getDatabaseDialect({ DB_DIALECT: ' postgres ' }), 'postgres');
  assert.throws(
    () => getDatabaseDialect({ DB_DIALECT: 'mysql' }),
    /DB_DIALECT must be postgres/,
  );
  assert.throws(
    () => getDatabaseDialect({ DB_DIALECT: 'postgre' }),
    /DB_DIALECT must be postgres/,
  );
  assert.ok(getStartupConfigurationErrors({ DB_DIALECT: 'mysql' })
    .some((error) => error.includes('DB_DIALECT')));
});

test('PostgreSQL startup validates the pooled runtime URL without requiring migration credentials', () => {
  const configuration = {
    DB_DIALECT: 'postgres',
    DATABASE_URL: 'postgresql://test-user:test-password@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
    WEB_ORIGIN: 'http://localhost:5173',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    NODE_ENV: 'test',
  };
  assert.deepEqual(getStartupConfigurationErrors(configuration), []);
});

test('PostgreSQL mode does not load the MySQL driver', () => {
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const loaderPath = fileURLToPath(new URL('./helpers/forbid-mysql-loader.js', import.meta.url));
  const result = spawnSync(process.execPath, [
    '--experimental-loader',
    pathToFileURL(loaderPath).href,
    '--input-type=module',
    '-e',
    "const { databaseDialect } = await import('./src/db.js'); "
      + "if (databaseDialect !== 'postgres') process.exitCode = 1; "
      + "else console.log('PostgreSQL mode selected.');",
  ], {
    cwd: backendDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: 'postgresql://test-user:test-password@127.0.0.1:5432/eventhub?sslmode=disable',
      DB_SSL: 'false',
      NODE_ENV: 'test',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PostgreSQL mode selected/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MySQL driver import attempted/);
});

test('PostgreSQL startup exits without listening when its database is unavailable', () => {
  const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
  const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: backendDirectory,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      DB_DIALECT: 'postgres',
      DATABASE_URL: 'postgresql://test-user:test-password@127.0.0.1:1/eventhub?sslmode=disable',
      DB_SSL: 'false',
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'lax',
      PORT: '4001',
    },
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /PostgreSQL connection failed \[DB_CONNECT_FAILED\]/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Admin API listening|127\.0\.0\.1:3306|MySQL connected/);
});

test('production startup requires HTTPS origin and cross-site secure cookies', () => {
  const configuration = {
    DB_DIALECT: 'mysql',
    DB_HOST: 'db.example.test',
    DB_PORT: '3306',
    DB_NAME: 'events',
    DB_USER: 'events',
    DB_PASSWORD: 'test-only',
    DB_SSL: 'true',
    DB_SSL_CA: rootCertificates[0],
    WEB_ORIGIN: 'http://example.test',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    NODE_ENV: 'production',
  };
  assert.deepEqual(getStartupConfigurationErrors(configuration)
    .map((error) => error.split(/[ (]/)[0]), [
    'DB_DIALECT',
    'WEB_ORIGIN',
    'COOKIE_SECURE',
    'COOKIE_SAME_SITE',
  ]);
});

test('SameSite none is rejected unless Secure cookies are enabled', () => {
  const errors = getStartupConfigurationErrors({
    ...databaseCredentials,
    DB_SSL: 'true',
    WEB_ORIGIN: 'https://infobekele.netlify.app',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'none',
    NODE_ENV: 'test',
  });
  assert.ok(errors.includes('COOKIE_SECURE (set to true when COOKIE_SAME_SITE is none)'));
});

test('production configuration reports each missing cookie setting once', () => {
  const errors = getStartupConfigurationErrors({
    ...databaseCredentials,
    DB_SSL: 'true',
    NODE_ENV: 'production',
  });

  assert.equal(errors.filter((error) => error.startsWith('COOKIE_SECURE ')).length, 1);
  assert.equal(errors.filter((error) => error.startsWith('COOKIE_SAME_SITE ')).length, 1);
  assert.equal(new Set(errors).size, errors.length);
});

test('cookie options use Secure and SameSite=None in production and insecure Lax locally', () => {
  const prior = {
    NODE_ENV: process.env.NODE_ENV,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_SAME_SITE = 'none';
    assert.deepEqual(getCookieOptions(), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });

    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_SAME_SITE = 'strict';
    assert.deepEqual(getCookieOptions(), {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  } finally {
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

let healthQueryCount = 0;
const app = createApp({
  database: {
    async execute() {
      return [[], []];
    },
    async query(sql) {
      healthQueryCount += 1;
      assert.equal(sql, 'SELECT 1');
      return [[], []];
    },
  },
});
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test('root returns a lightweight service status without a database query', async () => {
  const response = await fetch(baseUrl, { headers: { Origin: 'http://localhost:5173' } });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'event-organizing-and-vendor-booking-api',
  });
  assert.equal(healthQueryCount, 0);
});

test('version endpoint reports the deployed commit and runtime environment', async () => {
  const previousCommit = process.env.RENDER_GIT_COMMIT;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.RENDER_GIT_COMMIT = 'commit-test-sha';
  process.env.NODE_ENV = 'production';
  try {
    const response = await fetch(`${baseUrl}/api/version`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      commit: 'commit-test-sha',
      environment: 'production',
    });
  } finally {
    if (previousCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = previousCommit;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test('configured Netlify origin is allowed to make credentialed API requests', async () => {
  const previousOrigin = process.env.WEB_ORIGIN;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.WEB_ORIGIN = 'https://infobekele.netlify.app';
  process.env.NODE_ENV = 'production';
  const corsApp = createApp({ database: { async query() {} } });
  if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = previousOrigin;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
  const corsServer = corsApp.listen(0, '127.0.0.1');
  await once(corsServer, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${corsServer.address().port}/`, {
      headers: { Origin: 'https://infobekele.netlify.app' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://infobekele.netlify.app');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  } finally {
    await new Promise((resolve, reject) => {
      corsServer.close((error) => error ? reject(error) : resolve());
      corsServer.closeAllConnections();
    });
  }
});

test('only explicitly configured local Vite origins are allowed in development', async () => {
  const previousOrigin = process.env.WEB_ORIGIN;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
  process.env.NODE_ENV = 'development';
  const corsApp = createApp({ database: { async query() {} } });
  if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = previousOrigin;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
  const corsServer = corsApp.listen(0, '127.0.0.1');
  await once(corsServer, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${corsServer.address().port}/`, {
      headers: { Origin: 'http://127.0.0.1:5174' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve, reject) => {
      corsServer.close((error) => error ? reject(error) : resolve());
      corsServer.closeAllConnections();
    });
  }
});

test('production CORS does not allow local development origins', async () => {
  const previousOrigin = process.env.WEB_ORIGIN;
  const previousEnvironment = process.env.NODE_ENV;
  process.env.WEB_ORIGIN = 'https://infobekele.netlify.app';
  process.env.NODE_ENV = 'production';
  const corsApp = createApp({ database: { async query() {} } });
  if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = previousOrigin;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
  const corsServer = corsApp.listen(0, '127.0.0.1');
  await once(corsServer, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${corsServer.address().port}/`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve, reject) => {
      corsServer.close((error) => error ? reject(error) : resolve());
      corsServer.closeAllConnections();
    });
  }
});

test('unconfigured origins cannot submit API writes', async () => {
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Request origin is not allowed.' });
});

test('database health route returns ready only after a successful database query', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', db: true });
  assert.equal(healthQueryCount, 1);
});

test('database health route returns unavailable and a safe failure code when the query fails', async () => {
  const unavailableApp = createApp({
    database: {
      async query() {
        const error = new Error('Database password=health-test-secret mysql://user:health-test-secret@db.example:11713');
        error.code = 'ECONNREFUSED';
        error.sqlMessage = 'password=health-test-secret';
        throw error;
      },
    },
  });
  const unavailableServer = unavailableApp.listen(0, '127.0.0.1');
  await once(unavailableServer, 'listening');

  try {
    const loggedErrors = [];
    const originalConsoleError = console.error;
    console.error = (...values) => loggedErrors.push(values.join(' '));
    let response;
    let body;
    try {
      response = await fetch(`http://127.0.0.1:${unavailableServer.address().port}/api/health`);
      body = await response.json();
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(response.status, 503);
    assert.deepEqual(body, { status: 'ok', db: false });
    assert.equal(Object.hasOwn(body, 'error'), false);
    assert.doesNotMatch(JSON.stringify(body), /health-test-secret/);
    assert.doesNotMatch(loggedErrors.join(' '), /health-test-secret/);
    assert.match(loggedErrors.join(' '), /ECONNREFUSED/);
  } finally {
    await new Promise((resolve, reject) => {
      unavailableServer.close((error) => error ? reject(error) : resolve());
      unavailableServer.closeAllConnections();
    });
  }
});

test('PostgreSQL health route reports the PostgreSQL response shape', async () => {
  const postgresApp = createApp({
    databaseDialect: 'postgres',
    database: { async query() { return { rows: [{ '?column?': 1 }] }; } },
  });
  const postgresServer = postgresApp.listen(0, '127.0.0.1');
  await once(postgresServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${postgresServer.address().port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', db: true });
  } finally {
    await new Promise((resolve, reject) => {
      postgresServer.close((error) => error ? reject(error) : resolve());
      postgresServer.closeAllConnections();
    });
  }
});

test('transient PostgreSQL auth database failures return 503 instead of 401 or 500', async () => {
  const postgresApp = createApp({
    databaseDialect: 'postgres',
    database: {
      async query() {
        throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
      },
      async execute() {
        throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
      },
    },
  });
  const postgresServer = postgresApp.listen(0, '127.0.0.1');
  await once(postgresServer, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${postgresServer.address().port}/api/auth/me`, {
      headers: { Cookie: 'admin_session=test-session' },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: 'Database is waking up, please retry' });
  } finally {
    await new Promise((resolve, reject) => {
      postgresServer.close((error) => error ? reject(error) : resolve());
      postgresServer.closeAllConnections();
    });
  }
});

test('mounted protected API routes reach authorization instead of the 404 handler', async () => {
  const response = await fetch(`${baseUrl}/api/platform/me`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: null });
});

test('anonymous administrator session checks do not consume sign-in rate limits', async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: null });
  }
});

test('anonymous platform session checks do not consume sign-in rate limits', async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/platform/me`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: null });
  }
});

test('successful session checks do not exhaust session probe rate limits', async () => {
  for (const [path, expected] of [
    ['/api/auth/me', { user: null }],
  ]) {
    for (let attempt = 0; attempt < 65; attempt += 1) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
  }
});

test('session endpoints reject invalid cookies with 401 and clear them', async () => {
  const adminResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: 'admin_session=invalid-test-session' },
  });
  const platformResponse = await fetch(`${baseUrl}/api/platform/me`, {
    headers: { Cookie: 'platform_session=invalid-test-session' },
  });

  assert.equal(adminResponse.status, 401);
  assert.deepEqual(await adminResponse.json(), { error: 'Authentication required.' });
  assert.match(adminResponse.headers.get('set-cookie') || '', /admin_session=/);
  assert.equal(platformResponse.status, 401);
  assert.deepEqual(await platformResponse.json(), { message: 'Unauthorized' });
  assert.match(platformResponse.headers.get('set-cookie') || '', /platform_session=/);
});

test('administrator login attempts are rate limited with Retry-After metadata', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 400);
  }

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const retryAfter = Number(response.headers.get('retry-after'));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.ok(retryAfter > 0);
  assert.equal(body.retryAfterSeconds, retryAfter);
  assert.match(body.error, /sign-in attempts/i);
});

test('platform login attempts are rate limited separately from session checks', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.27' },
      body: '{}',
    });
    assert.equal(response.status, 400);
  }

  const response = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.27' },
    body: '{}',
  });

  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});

test('platform registration and password recovery have separate rate limits', async () => {
  for (const [path, limit] of [['/api/platform/register', 5], ['/api/platform/password-recovery', 5]]) {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 400, `${path} request ${attempt + 1}`);
    }

    const limited = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(limited.status, 429, path);
    assert.ok(Number(limited.headers.get('retry-after')) > 0, path);
  }
});

test('logout clears both session cookies without requiring a session', async () => {
  for (const [path, cookieName] of [
    ['/api/auth/logout', 'admin_session'],
    ['/api/platform/logout', 'platform_session'],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });
    assert.equal(response.status, 204, path);
    assert.match(response.headers.get('set-cookie') || '', new RegExp(`${cookieName}=`));
  }
});

test('profile photo endpoints require the authenticated account for platform and administrator roles', async () => {
  for (const prefix of ['/api/platform', '/api/admin']) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await fetch(`${baseUrl}${prefix}/profile/photo`, {
        method,
        headers: method === 'PUT' ? { 'Content-Type': 'image/png' } : {},
        body: method === 'PUT' ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) : undefined,
      });

      assert.equal(response.status, 401, `${method} ${prefix}/profile/photo`);
      assert.deepEqual(await response.json(), prefix === '/api/platform'
        ? { message: 'Unauthorized' }
        : { error: 'Authentication required.' });
    }
  }

  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await fetch(`${baseUrl}/api/users/me/avatar`, { method });
    assert.equal(response.status, 401, `${method} /api/users/me/avatar`);
    assert.deepEqual(await response.json(), { message: 'Unauthorized' });
  }
});

test('administrator dashboard API rejects unauthenticated requests', async () => {
  const response = await fetch(`${baseUrl}/api/admin/dashboard/overview?startDate=2026-10-01&endDate=2026-10-30`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});

test('unknown paths still return the JSON 404 response', async () => {
  const response = await fetch(`${baseUrl}/not-a-route`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Endpoint not found.' });
});
