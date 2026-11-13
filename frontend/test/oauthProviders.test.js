import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOAuthStartUrl, getConfiguredOAuthProviders, parseOAuthProviderStatuses } from '../src/oauthProviders.js';

const providerResponse = {
  providers: [
    { id: 'google', configured: true, status: 'configured' },
    { id: 'facebook', configured: false, status: 'not_configured' },
    { id: 'apple', configured: false, status: 'not_configured' },
  ],
};

test('provider discovery preserves independent configured states', () => {
  assert.deepEqual(parseOAuthProviderStatuses(providerResponse), {
    google: 'configured',
    facebook: 'not_configured',
    apple: 'not_configured',
  });
  assert.deepEqual(getConfiguredOAuthProviders(providerResponse), ['google']);
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
    buildOAuthStartUrl('/api', 'apple', 'link'),
    'http://localhost/api/platform/oauth/apple/start?intent=link',
  );
});
