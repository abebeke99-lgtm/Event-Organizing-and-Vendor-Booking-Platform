import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SYSTEM_SETTINGS,
  mergeSystemSettings,
  parseStoredSystemSetting,
  serializeSystemSettingValue,
  systemSettingsPatchSchema,
  loadSystemSettings,
} from '../src/lib/systemSettings.js';
import { requirePlatformAvailable } from '../src/middleware/rbac.js';

function createMiddlewareResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('system settings accept typed, supported settings and preserve false values', () => {
  const parsed = systemSettingsPatchSchema.safeParse({
    support_email: 'events@example.com',
    maintenance_mode: false,
    public_registration_enabled: false,
    default_registration_role: 'vendor',
  });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data, {
    support_email: 'events@example.com',
    maintenance_mode: false,
    public_registration_enabled: false,
    default_registration_role: 'vendor',
  });
  assert.equal(serializeSystemSettingValue(false), 'false');
});

test('system settings reject unsupported fields, privileged public roles, and invalid values', () => {
  for (const settings of [
    { secret_key: 'do-not-store-here' },
    { default_registration_role: 'admin' },
    { platform_status: 'paused' },
    { support_email: 'not-an-email' },
    { maintenance_message: '' },
    { support_phone: 'phone<script>' },
  ]) {
    assert.equal(systemSettingsPatchSchema.safeParse(settings).success, false);
  }
});

test('social link settings require a bounded array of HTTP(S) links', () => {
  assert.equal(systemSettingsPatchSchema.safeParse({
    social_links: JSON.stringify([{ label: 'Site', url: 'https://example.com' }]),
  }).success, true);
  assert.equal(systemSettingsPatchSchema.safeParse({
    social_links: JSON.stringify([{ label: 'Unsafe', url: 'javascript:alert(1)' }]),
  }).success, false);
  assert.equal(systemSettingsPatchSchema.safeParse({ social_links: '{}' }).success, false);
});

test('stored settings merge with safe defaults and parse boolean values strictly', () => {
  const settings = mergeSystemSettings([
    { setting_key: 'maintenance_mode', setting_value: 'true' },
    { setting_key: 'public_registration_enabled', setting_value: 'false' },
    { setting_key: 'unrecognized_secret', setting_value: 'hidden' },
  ]);

  assert.equal(settings.maintenance_mode, true);
  assert.equal(settings.public_registration_enabled, false);
  assert.equal(settings.platform_name, DEFAULT_SYSTEM_SETTINGS.platform_name);
  assert.equal('unrecognized_secret' in settings, false);
  assert.throws(() => parseStoredSystemSetting('maintenance_mode', 'enabled'), /is invalid/);
});

test('system settings loader only queries recognized keys using SQL parameters', async () => {
  let query;
  const settings = await loadSystemSettings({
    async execute(statement, values) {
      query = { statement, values };
      return [[{ setting_key: 'platform_status', setting_value: 'maintenance' }], []];
    },
  }, ['platform_status', 'unknown_key']);

  assert.match(query.statement, /setting_key IN \(\?\)/);
  assert.deepEqual(query.values, ['platform_status']);
  assert.equal(settings.platform_status, 'maintenance');
  assert.equal(settings.maintenance_mode, false);
});

test('maintenance middleware blocks public operations with the configured message', async () => {
  const req = {
    path: '/events',
    app: {
      locals: {
        database: {
          async execute() {
            return [[
              { setting_key: 'platform_status', setting_value: 'open' },
              { setting_key: 'maintenance_mode', setting_value: 'true' },
              { setting_key: 'maintenance_message', setting_value: 'Back shortly.' },
            ], []];
          },
        },
      },
    },
  };
  const res = createMiddlewareResponse();
  let continued = false;

  await requirePlatformAvailable(req, res, () => { continued = true; });

  assert.equal(continued, false);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Platform maintenance', message: 'Back shortly.' });
});

test('maintenance middleware allows logout and propagates database errors', async () => {
  const logoutReq = { path: '/logout', app: { locals: {} } };
  let logoutContinued = false;
  await requirePlatformAvailable(logoutReq, createMiddlewareResponse(), () => { logoutContinued = true; });
  assert.equal(logoutContinued, true);

  const databaseError = new Error('Settings database unavailable.');
  let forwardedError;
  await requirePlatformAvailable({
    path: '/events',
    app: { locals: { database: { async execute() { throw databaseError; } } } },
  }, createMiddlewareResponse(), (error) => { forwardedError = error; });
  assert.equal(forwardedError, databaseError);
});
