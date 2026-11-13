import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { createOAuthProviderService } from '../src/lib/oauthProviders.js';

test('only providers with complete callback and credential configuration are advertised', () => {
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_CALLBACK_URL: 'http://api.example.test/api/platform/oauth/google/callback',
      FACEBOOK_APP_ID: 'facebook-app',
      FACEBOOK_APP_SECRET: 'facebook-secret',
      FACEBOOK_CALLBACK_URL: 'https://api.example.test/api/platform/oauth/facebook/callback',
      FACEBOOK_GRAPH_API_VERSION: 'v22.0',
    },
  });

  assert.deepEqual(service.getEnabledProviders(), ['facebook']);
  assert.deepEqual(service.getProviderStatuses(), [
    { id: 'google', configured: false, status: 'not_configured' },
    { id: 'facebook', configured: true, status: 'configured' },
    { id: 'apple', configured: false, status: 'not_configured' },
  ]);
});

test('Apple is advertised only when a valid P-256 private key and matching callback are configured', () => {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const environment = {
    NODE_ENV: 'production',
    APPLE_SERVICE_ID: 'eventhub-service',
    APPLE_TEAM_ID: 'team-id',
    APPLE_KEY_ID: 'key-id',
    APPLE_PRIVATE_KEY: privateKey,
    APPLE_CALLBACK_URL: 'https://api.example.test/api/platform/oauth/apple/callback',
  };
  const service = createOAuthProviderService({ environment });
  assert.deepEqual(service.getEnabledProviders(), ['apple']);
  assert.equal(service.getProviderStatuses()[2].status, 'configured');
  assert.equal(JSON.stringify(service.getProviderStatuses()).includes(privateKey), false);
  assert.deepEqual(createOAuthProviderService({
    environment: { ...environment, APPLE_PRIVATE_KEY: 'not-a-private-key' },
  }).getEnabledProviders(), []);
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

  test('Apple authorization uses a form-post callback mode supported by its callback route', () => {
    const service = createOAuthProviderService({
      environment: {
        NODE_ENV: 'development',
        APPLE_SERVICE_ID: 'eventhub-service',
        APPLE_TEAM_ID: 'team-id',
        APPLE_KEY_ID: 'key-id',
        APPLE_PRIVATE_KEY: generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }).privateKey,
        APPLE_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/apple/callback',
      },
    });
    const authorizationUrl = new URL(service.createAuthorizationUrl('apple', {
      state: 'one-time-state',
      nonce: 'one-time-nonce',
    }));
    assert.equal(authorizationUrl.searchParams.get('response_mode'), 'form_post');
    assert.equal(authorizationUrl.searchParams.get('state'), 'one-time-state');
    assert.equal(authorizationUrl.searchParams.get('nonce'), 'one-time-nonce');
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

test('Facebook exchanges and validates the token server-side before reading the matching profile', async () => {
  const requests = [];
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      FACEBOOK_APP_ID: '123456789',
      FACEBOOK_APP_SECRET: 'facebook-secret',
      FACEBOOK_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/facebook/callback',
      FACEBOOK_GRAPH_API_VERSION: 'v22.0',
    },
    fetchImpl: async (endpoint, options = {}) => {
      const url = new URL(endpoint);
      requests.push({ url, options });
      if (url.pathname.endsWith('/oauth/access_token')) {
        return { ok: true, json: async () => ({ access_token: 'provider-access-token' }) };
      }
      if (url.pathname.endsWith('/debug_token')) {
        return {
          ok: true,
          json: async () => ({
            data: { is_valid: true, app_id: '123456789', user_id: 'provider-user-1', expires_at: 0 },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          id: 'provider-user-1',
          email: 'Planner@Example.test',
          name: 'Event Planner',
        }),
      };
    },
  });

  const result = await service.exchangeAuthorizationCode('facebook', { code: 'authorization-code' });
  assert.equal(result.subject, 'provider-user-1');
  assert.equal(result.email, 'planner@example.test');
  assert.equal(result.emailVerified, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].url.searchParams.get('input_token'), 'provider-access-token');
  assert.equal(requests[2].options.headers.Authorization, 'Bearer provider-access-token');
});

test('Apple verifies its identity token audience, issuer, algorithm, and nonce server-side', async () => {
  let verifierOptions;
  const service = createOAuthProviderService({
    environment: {
      NODE_ENV: 'development',
      APPLE_SERVICE_ID: 'eventhub-service',
      APPLE_TEAM_ID: 'team-id',
      APPLE_KEY_ID: 'key-id',
      APPLE_PRIVATE_KEY: generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey,
      APPLE_CALLBACK_URL: 'http://localhost:4000/api/platform/oauth/apple/callback',
    },
    importPrivateKey: async () => ({}),
    signJwt: class {
      setProtectedHeader() { return this; }
      setIssuer() { return this; }
      setSubject() { return this; }
      setAudience() { return this; }
      setIssuedAt() { return this; }
      setExpirationTime() { return this; }
      async sign() { return 'server-created-client-secret'; }
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ id_token: 'signed-apple-identity-token' }),
    }),
    verifyJwt: async (_token, _keys, options) => {
      verifierOptions = options;
      return {
        payload: {
          sub: 'apple-user-1',
          nonce: 'expected-nonce',
          email: 'Planner@Example.test',
          email_verified: 'true',
        },
      };
    },
  });

  const result = await service.exchangeAuthorizationCode('apple', {
    code: 'authorization-code',
    nonce: 'expected-nonce',
  });
  assert.equal(verifierOptions.audience, 'eventhub-service');
  assert.equal(verifierOptions.issuer, 'https://appleid.apple.com');
  assert.deepEqual(verifierOptions.algorithms, ['RS256']);
  assert.equal(result.subject, 'apple-user-1');
  assert.equal(result.emailVerified, true);
});
