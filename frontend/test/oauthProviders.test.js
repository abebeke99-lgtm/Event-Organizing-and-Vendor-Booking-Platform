import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOAuthStartUrl, getConfiguredOAuthProviders, parseOAuthProviderStatuses } from '../src/oauthProviders.js';

const providerResponse = {
  providers: [
    { id: 'google', configured: true, status: 'configured' },
    { id: 'microsoft', configured: true, status: 'configured' },
  ],
};

test('provider discovery preserves independent configured states', () => {
  assert.deepEqual(parseOAuthProviderStatuses(providerResponse), {
    google: 'configured',
    microsoft: 'configured',
  });
  assert.deepEqual(getConfiguredOAuthProviders(providerResponse), ['google', 'microsoft']);
});

test('provider discovery treats a legacy response without Microsoft as unavailable, not invalid', () => {
  const legacyResponse = {
    providers: providerResponse.providers.filter(({ id }) => id !== 'microsoft'),
  };
  assert.deepEqual(parseOAuthProviderStatuses(legacyResponse), {
    google: 'configured',
    microsoft: 'not_configured',
  });
});

test('provider discovery rejects malformed status data instead of reporting unconfigured providers', () => {
  assert.throws(() => parseOAuthProviderStatuses({ providers: [] }), /invalid social sign-in provider list/);
  assert.throws(() => parseOAuthProviderStatuses({
    providers: [{ ...providerResponse.providers[0], configured: false }],
  }), /invalid social sign-in provider list/);
});

test('OAuth start URL uses one API prefix and the provider-specific start route', () => {
  assert.equal(
    buildOAuthStartUrl('https://api.example.test/api/', 'google'),
    'https://api.example.test/api/platform/oauth/google/start?intent=login',
  );
  assert.equal(
    buildOAuthStartUrl('/api', 'microsoft', 'link'),
    'http://localhost/api/platform/oauth/microsoft/start?intent=link',
  );
  assert.equal(
    buildOAuthStartUrl('https://api.example.test/api', 'microsoft', 'admin-login', { rememberMe: true }),
    'https://api.example.test/api/platform/oauth/microsoft/start?intent=admin-login&rememberMe=true',
  );
  assert.equal(
    buildOAuthStartUrl('http://127.0.0.1:4000/api', 'google', 'admin-login'),
    'http://127.0.0.1:4000/api/platform/oauth/google/start?intent=admin-login',
  );
  assert.equal(
    buildOAuthStartUrl('http://127.0.0.1:4000/api', 'microsoft', 'admin-login'),
    'http://127.0.0.1:4000/api/platform/oauth/microsoft/start?intent=admin-login',
  );
  assert.throws(() => buildOAuthStartUrl('/api', 'facebook'), /Unsupported social sign-in provider/);
  assert.throws(() => buildOAuthStartUrl('/api', 'google', 'register'), /Unsupported social sign-in intent/);
});
