import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { rootCertificates } from 'node:tls';
import { createApp } from '../src/app.js';
import {
  createDatabaseConfig,
  formatDatabaseError,
  getDatabaseConfigurationErrors,
  verifyDatabaseConnection,
} from '../src/db.js';

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

let healthQueryCount = 0;
const app = createApp({
  database: {
    async query(sql) {
      assert.equal(sql, 'SELECT 1');
      healthQueryCount += 1;
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
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(healthQueryCount, 0);
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
  assert.equal(healthQueryCount, 1);
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
    assert.deepEqual(body, { status: 'unavailable' });
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

test('unknown paths still return the JSON 404 response', async () => {
  const response = await fetch(`${baseUrl}/not-a-route`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Endpoint not found.' });
});
