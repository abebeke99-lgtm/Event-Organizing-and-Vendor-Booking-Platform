import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOAuthProviderService } from '../src/lib/oauthProviders.js';

test('only providers with complete callback and credential configuration are advertised', () => {
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'https://api.example.test/api/platform/oauth/google/callback',
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: '11111111-2222-4333-8444-555555555555',
      MICROSOFT_CALLBACK_URL: 'https://api.example.test/api/platform/oauth/microsoft/callback',
    },
  });

  assert.deepEqual(service.getEnabledProviders(), ['google', 'microsoft']);
  assert.deepEqual(service.getProviderStatuses(), [
    { id: 'google', configured: true, status: 'configured' },
    { id: 'microsoft', configured: true, status: 'configured' },
  ]);
});

test('Google authorization requires state, nonce, and an S256 PKCE challenge', () => {
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:5173',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/google/callback',
    },
  });

  const authorizationUrl = new URL(service.createAuthorizationUrl('google', {
    state: 'one-time-state',
    nonce: 'one-time-nonce',
    codeChallenge: 's256-challenge',
  }));

  assert.equal(authorizationUrl.searchParams.get('state'), 'one-time-state');
  assert.equal(authorizationUrl.searchParams.get('nonce'), 'one-time-nonce');
  assert.equal(authorizationUrl.searchParams.get('code_challenge'), 's256-challenge');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
});

test('Google token validation enforces configured audience and nonce and returns normalized identity', async () => {
  let verifierOptions;
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/google/callback',
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ id_token: 'signed-provider-token' }),
    }),
    verifyJwt: async (_token, _keys, options) => {
      verifierOptions = options;
      return {
        payload: {
          iss: 'https://accounts.google.com',
          aud: 'google-client',
          sub: 'provider-user-1',
          nonce: 'expected-nonce',
          email: 'Planner@Example.test',
          email_verified: true,
          name: 'Event Planner',
        },
      };
    },
  });

  const identity = await service.exchangeAuthorizationCode('google', {
    code: 'authorization-code',
    codeVerifier: 'code-verifier',
    nonce: 'expected-nonce',
  });
  assert.equal(verifierOptions.audience, 'google-client');
  assert.deepEqual(verifierOptions.issuer, ['https://accounts.google.com', 'accounts.google.com']);
  assert.equal(identity.subject, 'provider-user-1');
  assert.equal(identity.email, 'planner@example.test');
  assert.equal(identity.emailVerified, true);
});

test('Google identity with a mismatched nonce is rejected', async () => {
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/google/callback',
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ id_token: 'signed-provider-token' }),
    }),
    verifyJwt: async () => ({ payload: { sub: 'provider-user-1', nonce: 'different-nonce' } }),
  });

  await assert.rejects(
    service.exchangeAuthorizationCode('google', {
      code: 'authorization-code',
      codeVerifier: 'code-verifier',
      nonce: 'expected-nonce',
    }),
    { code: 'invalid_identity' },
  );
});

test('Microsoft authorization uses tenant-bound OIDC state, nonce, and S256 PKCE', () => {
  const tenantId = '11111111-2222-4333-8444-555555555555';
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: tenantId,
      MICROSOFT_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/microsoft/callback',
    },
  });
  const authorizationUrl = new URL(service.createAuthorizationUrl('microsoft', {
    state: 'one-time-state',
    nonce: 'one-time-nonce',
    codeChallenge: 's256-challenge',
  }));
  assert.equal(authorizationUrl.origin, `https://login.microsoftonline.com`);
  assert.equal(authorizationUrl.pathname, `/${tenantId}/oauth2/v2.0/authorize`);
  assert.equal(authorizationUrl.searchParams.get('state'), 'one-time-state');
  assert.equal(authorizationUrl.searchParams.get('nonce'), 'one-time-nonce');
  assert.equal(authorizationUrl.searchParams.get('code_challenge'), 's256-challenge');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
});

test('Microsoft token validation enforces tenant, audience, issuer, nonce, and verified email', async () => {
  const tenantId = '11111111-2222-4333-8444-555555555555';
  let verifierOptions;
  let tokenRequest;
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: tenantId,
      MICROSOFT_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/microsoft/callback',
    },
    fetchImpl: async (url, options) => {
      tokenRequest = { url: new URL(url), options };
      return { ok: true, json: async () => ({ id_token: 'microsoft-id-token' }) };
    },
    verifyJwt: async (_token, _keys, options) => {
      verifierOptions = options;
      return {
        payload: {
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          aud: 'microsoft-client',
          tid: tenantId,
          sub: 'microsoft-user-1',
          nonce: 'expected-nonce',
          email: 'Admin@Example.test',
          email_verified: true,
          name: 'Event Administrator',
        },
      };
    },
  });

  const identity = await service.exchangeAuthorizationCode('microsoft', {
    code: 'authorization-code',
    codeVerifier: 'code-verifier',
    nonce: 'expected-nonce',
  });
  assert.equal(tokenRequest.url.pathname, `/${tenantId}/oauth2/v2.0/token`);
  assert.equal(tokenRequest.options.body.get('code_verifier'), 'code-verifier');
  assert.equal(verifierOptions.issuer, `https://login.microsoftonline.com/${tenantId}/v2.0`);
  assert.equal(verifierOptions.audience, 'microsoft-client');
  assert.deepEqual(identity, {
    provider: 'microsoft',
    subject: 'microsoft-user-1',
    email: 'admin@example.test',
    emailVerified: true,
    name: 'Event Administrator',
  });
});

test('Microsoft token validation does not trust an unverified email claim', async () => {
  const tenantId = '11111111-2222-4333-8444-555555555555';
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      MICROSOFT_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
      MICROSOFT_TENANT_ID: tenantId,
      MICROSOFT_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/microsoft/callback',
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ id_token: 'microsoft-id-token' }) }),
    verifyJwt: async () => ({
      payload: {
        tid: tenantId,
        sub: 'microsoft-user-1',
        nonce: 'expected-nonce',
        email: 'unverified@example.test',
        email_verified: false,
      },
    }),
  });
  const identity = await service.exchangeAuthorizationCode('microsoft', {
    code: 'authorization-code',
    codeVerifier: 'code-verifier',
    nonce: 'expected-nonce',
  });
  assert.equal(identity.email, null);
  assert.equal(identity.emailVerified, false);
});
