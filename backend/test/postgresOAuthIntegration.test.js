import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';
import { createPostgresOAuthRouter } from '../src/routes/postgresOAuth.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon OAuth persists and consumes PostgreSQL registration state', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const database = createPostgresDatabase(await loadNeonTestEnvironment());
  const suffix = randomUUID();
  let stateHash;
  let server;

  try {
    const oauthService = {
      getProviderStatuses: () => [{ id: 'google', configured: true, status: 'configured' }],
      createAuthorizationUrl: (_provider, parameters) => {
        const url = new URL('https://identity.example.test/authorize');
        for (const [key, value] of Object.entries(parameters)) {
          if (value) url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async (provider, { code }) => {
        assert.equal(provider, 'google');
        assert.equal(code, 'integration-authorization-code');
        return {
          provider,
          subject: `integration-${suffix}`,
          email: `pg-oauth-${suffix}@example.invalid`,
          emailVerified: true,
          name: 'Neon OAuth Integration',
        };
      },
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
    };
    const app = express();
    app.use(cookieParser());
    app.use('/api/platform/oauth', createPostgresOAuthRouter({ database: database.runtimeAdapter, oauthService }));
    server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const origin = `http://127.0.0.1:${server.address().port}`;
    const start = await fetch(`${origin}/api/platform/oauth/google/start?intent=login`, {
      redirect: 'manual',
    });
    assert.equal(start.status, 302);
    const authorizationUrl = new URL(start.headers.get('location'));
    const stateToken = authorizationUrl.searchParams.get('state');
    const browserCookie = start.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(stateToken);
    assert.ok(browserCookie?.startsWith('oauth_browser='));

    stateHash = createHash('sha256').update(stateToken).digest('hex');
    const storedState = await database.runtimeAdapter.query(
      'SELECT intent, registration_role FROM oauth_login_states WHERE state_hash = $1',
      [stateHash],
    );
    assert.deepEqual(storedState.rows, [{ intent: 'login', registration_role: null }]);

    const callback = await fetch(
      `${origin}/api/platform/oauth/google/callback?state=${encodeURIComponent(stateToken)}&code=integration-authorization-code`,
      {
        headers: { Cookie: browserCookie },
        redirect: 'manual',
      },
    );
    assert.equal(callback.status, 302);
    const destination = new URL(callback.headers.get('location'));
    assert.equal(destination.pathname, '/register');
    assert.equal(destination.searchParams.get('oauth'), 'registration_required');
    assert.equal(destination.searchParams.get('email'), `pg-oauth-${suffix}@example.invalid`);

    const consumedState = await database.runtimeAdapter.query(
      'SELECT 1 FROM oauth_login_states WHERE state_hash = $1',
      [stateHash],
    );
    assert.equal(consumedState.rowCount, 0);
  } finally {
    try {
      if (stateHash) {
        await database.runtimeAdapter.query(
          'DELETE FROM oauth_login_states WHERE state_hash = $1',
          [stateHash],
        );
      }
    } finally {
      try {
        if (server) await new Promise((resolve) => server.close(resolve));
      } finally {
        await database.close();
      }
    }
  }
});
