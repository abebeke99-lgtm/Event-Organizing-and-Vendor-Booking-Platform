import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { createPostgresOAuthRouter } from '../src/routes/postgresOAuth.js';
import { requirePlatformAvailable } from '../src/middleware/rbac.js';

async function withOAuthServer(callback) {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform/oauth', createPostgresOAuthRouter({
    database: { query: async () => ({ rows: [] }) },
    oauthService: {
      getProviderStatuses: () => [
        { id: 'google', configured: true, status: 'configured' },
        { id: 'facebook', configured: false, status: 'not_configured' },
        { id: 'apple', configured: false, status: 'not_configured' },
      ],
      createAuthorizationUrl: (provider) => `https://provider.example.test/${provider}`,
      getFrontendUrl: (path) => `https://eventhub.example.test${path}`,
    },
  }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('provider discovery returns all provider identifiers and safe status fields', async () => {
  await withOAuthServer(async (origin) => {
    const response = await fetch(`${origin}/api/platform/oauth/providers`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      providers: [
        { id: 'google', configured: true, status: 'configured' },
        { id: 'facebook', configured: false, status: 'not_configured' },
        { id: 'apple', configured: false, status: 'not_configured' },
      ],
    });
  });
});

test('each provider start route uses the provider-specific authorization URL', async () => {
  await withOAuthServer(async (origin) => {
    for (const provider of ['google', 'facebook', 'apple']) {
      const response = await fetch(`${origin}/api/platform/oauth/${provider}/start?intent=login`, {
        redirect: 'manual',
      });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), `https://provider.example.test/${provider}`);
    }
  });
});

test('Apple form-post callback parses state and provider cancellation safely', async () => {
  const app = express();
  app.use(cookieParser());
  app.use('/api/platform/oauth', createPostgresOAuthRouter({
    database: { query: async () => ({ rows: [{
      provider: 'apple',
      intent: 'login',
      user_id: null,
      nonce: 'one-time-nonce',
      code_verifier: null,
    }] }) },
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        return url.href;
      },
    },
  }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform/oauth/apple/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'oauth_browser=browser-token' },
      body: new URLSearchParams({ state: 'one-time-state', error: 'access_denied' }),
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'),
      'https://eventhub.example.test/login?oauth=error&reason=cancelled');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('provider discovery is available while platform availability is being checked', async () => {
  let continued = false;
  await requirePlatformAvailable({
    path: '/providers',
    app: { locals: { database: { query: async () => { throw new Error('must not query PostgreSQL'); } } } },
  }, {}, () => { continued = true; });
  assert.equal(continued, true);
});
