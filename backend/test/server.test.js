import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { rootCertificates } from 'node:tls';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import {
  createDatabaseConfig,
  formatDatabaseError,
  getDatabaseFailureCode,
  getDatabaseConfigurationErrors,
  verifyDatabaseConnection,
} from '../src/db.js';
import { getStartupConfigurationErrors } from '../src/lib/startupConfig.js';

test('database TLS verifies certificates and normalizes escaped CA newlines', () => {
  const certificateAuthority = rootCertificates[0];
  const config = createDatabaseConfig({
    DB_HOST: 'mysql.example.test',
    DB_PORT: '11713',
    DB_NAME: 'defaultdb',
    DB_USER: 'avnadmin',
    DB_PASSWORD: 'test-only',
    DB_SSL: 'true',
    DB_SSL_CA: certificateAuthority.replace(/\n/g, '\\n'),
  });

  test('database TLS loads and verifies CA certificates from a file path', () => {
    const certificateAuthority = rootCertificates[0];
    const directory = mkdtempSync(join(tmpdir(), 'event-platform-ca-'));
    const certificatePath = join(directory, 'ca.pem');
    try {
      writeFileSync(certificatePath, certificateAuthority);
      const config = createDatabaseConfig({
        DB_SSL: 'true',
        DB_SSL_CA: certificatePath,
      });
      assert.equal(config.ssl.ca, certificateAuthority.trim());
      assert.equal(config.ssl.rejectUnauthorized, true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  assert.equal(config.host, 'mysql.example.test');
  assert.equal(config.port, 11713);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    ca: certificateAuthority.trim(),
  });
});

test('database TLS requires a valid CA certificate when enabled', () => {
  assert.throws(
    () => createDatabaseConfig({ DB_SSL: 'true', DB_SSL_CA: '' }),
    { message: 'DB_SSL_CA must contain a PEM-encoded certificate when DB_SSL=true.' },
  );
  assert.throws(
    () => createDatabaseConfig({
      DB_SSL: 'true',
      DB_SSL_CA: '-----BEGIN CERTIFICATE-----invalid-----END CERTIFICATE-----',
    }),
    { message: 'DB_SSL_CA must contain a PEM-encoded certificate when DB_SSL=true.' },
  );
});

test('production database configuration requires credentials, TLS, a valid port, and a CA', () => {
  assert.deepEqual(getDatabaseConfigurationErrors({}, { requireTls: true }), [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_SSL=true',
    'DB_SSL_CA (valid PEM certificate required)',
  ]);
});

test('database TLS is omitted when SSL is disabled for local development', () => {
  const config = createDatabaseConfig({ DB_SSL: 'false' });

  assert.equal('ssl' in config, false);
});

test('database pool has a bounded connection timeout', () => {
  const config = createDatabaseConfig({});

  assert.equal(config.connectTimeout, 10000);
});

test('database verifier executes only the read-only SELECT 1 query', async () => {
  const statements = [];
  await verifyDatabaseConnection({
    async query(statement) {
      statements.push(statement);
    },
  });

  assert.deepEqual(statements, ['SELECT 1']);
});

test('database verifier checks the selected database when requested', async () => {
  const statements = [];
  await verifyDatabaseConnection({
    async query(statement) {
      statements.push(statement);
      if (statement === 'SELECT DATABASE() AS database_name') {
        return [[{ database_name: 'defaultdb' }], []];
      }
      return [[], []];
    },
  }, 'defaultdb');

  assert.deepEqual(statements, ['SELECT 1', 'SELECT DATABASE() AS database_name']);
});

test('database verifier rejects a connection to a different database', async () => {
  await assert.rejects(
    verifyDatabaseConnection({
      async query(statement) {
        if (statement === 'SELECT DATABASE() AS database_name') {
          return [[{ database_name: 'unexpected' }], []];
        }
        return [[], []];
      },
    }, 'defaultdb'),
    { message: 'Connected database does not match DB_NAME.' },
  );
});

test('database diagnostics retain error details while redacting passwords and connection strings', () => {
  const error = Object.assign(new Error(
    'Access failed for password=secret-pass mysql://avnadmin:secret-pass@db.example:11713',
  ), { code: 'ER_ACCESS_DENIED_ERROR', errno: 1045, sqlState: '28000' });

  const diagnostic = formatDatabaseError(error, 'secret-pass');

  assert.match(diagnostic, /ER_ACCESS_DENIED_ERROR/);
  assert.match(diagnostic, /errno=1045/);
  assert.match(diagnostic, /sqlState=28000/);
  assert.doesNotMatch(diagnostic, /secret-pass/);
  assert.doesNotMatch(diagnostic, /avnadmin:/);
});

test('database failure diagnostics map to safe reason codes', () => {
  assert.equal(getDatabaseFailureCode({ code: 'ER_ACCESS_DENIED_ERROR' }), 'DB_AUTH_FAILED');
  assert.equal(getDatabaseFailureCode({ code: 'CERT_HAS_EXPIRED' }), 'DB_TLS_FAILED');
  assert.equal(getDatabaseFailureCode({ code: 'ECONNREFUSED' }), 'DB_CONNECT_FAILED');
  assert.equal(getDatabaseFailureCode(new Error('Connected database does not match DB_NAME.')), 'DB_NAME_MISMATCH');
});

test('startup configuration validation reports missing environment variable names only', () => {
  assert.deepEqual(getStartupConfigurationErrors({}), [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'WEB_ORIGIN',
    'COOKIE_SECURE',
    'COOKIE_SAME_SITE',
    'NODE_ENV',
  ]);
});

test('production startup requires HTTPS origin and cross-site secure cookies', () => {
  const configuration = {
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
  assert.deepEqual(getStartupConfigurationErrors(configuration), [
    'WEB_ORIGIN',
    'COOKIE_SECURE',
    'COOKIE_SAME_SITE',
  ]);
});

let healthQueryCount = 0;
const app = createApp({
  expectedDatabase: 'defaultdb',
  database: {
    async query(sql) {
      healthQueryCount += 1;
      if (sql === 'SELECT DATABASE() AS database_name') {
        return [[{ database_name: 'defaultdb' }], []];
      }
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

test('database health route remains available and checks database connectivity', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(healthQueryCount, 2);
});

test('database health route reports unavailable when DB_NAME does not match the selected database', async () => {
  const mismatchedApp = createApp({
    expectedDatabase: 'defaultdb',
    database: {
      async query(sql) {
        if (sql === 'SELECT DATABASE() AS database_name') {
          return [[{ database_name: 'unexpected' }], []];
        }
        return [[], []];
      },
    },
  });
  const mismatchedServer = mismatchedApp.listen(0, '127.0.0.1');
  await once(mismatchedServer, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${mismatchedServer.address().port}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'unavailable',
      reasonCode: 'DB_NAME_MISMATCH',
    });
  } finally {
    await new Promise((resolve, reject) => {
      mismatchedServer.close((error) => error ? reject(error) : resolve());
      mismatchedServer.closeAllConnections();
    });
  }
});

test('database health route reports unavailable when the database query fails', async () => {
  const unavailableApp = createApp({
    database: {
      async query() {
        const error = new Error('Database password=health-test-secret mysql://user:health-test-secret@db.example:11713');
        error.code = 'ECONNREFUSED';
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
    assert.deepEqual(body, {
      status: 'unavailable',
      reasonCode: 'DB_CONNECT_FAILED',
    });
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

test('mounted protected API routes reach authorization instead of the 404 handler', async () => {
  const response = await fetch(`${baseUrl}/api/platform/me`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
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
