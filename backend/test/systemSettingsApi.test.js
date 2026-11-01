import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'system-settings-test-session';
const storedSettings = [
  { setting_key: 'platform_name', setting_value: 'Test EventHub' },
  { setting_key: 'support_email', setting_value: 'support@example.com' },
  { setting_key: 'platform_status', setting_value: 'open' },
  { setting_key: 'maintenance_mode', setting_value: 'false' },
  { setting_key: 'public_registration_enabled', setting_value: 'true' },
];
const auditRecords = [];

const database = {
  async execute(statement, values = []) {
    if (statement.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: 1,
        full_name: 'Settings Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : [], []];
    }
    if (statement.includes('FROM services') && statement.includes('UNION SELECT currency')) {
      return [[{ currency: 'ETB' }], []];
    }
    if (statement.startsWith('SELECT setting_key, setting_value, updated_at FROM system_settings')) {
      return [storedSettings.filter((row) => values.includes(row.setting_key)), []];
    }
    if (statement.startsWith('SELECT setting_key, setting_value FROM system_settings')) {
      return [storedSettings.filter((row) => values.includes(row.setting_key)), []];
    }
    if (statement.startsWith('INSERT INTO system_settings')) {
      const [settingKey, settingValue] = values;
      const existing = storedSettings.find((row) => row.setting_key === settingKey);
      if (existing) existing.setting_value = settingValue;
      else storedSettings.push({ setting_key: settingKey, setting_value: settingValue });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('INSERT INTO audit_logs')) {
      auditRecords.push({ statement, values });
      return [{ insertId: auditRecords.length }, []];
    }
    return [[], []];
  },
  async query() {
    return [[], []];
  },
  async getConnection() {
    return {
      execute: (...args) => database.execute(...args),
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    };
  },
};

const app = createApp({ database });
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

test('public availability returns only non-sensitive system settings', async () => {
  const response = await fetch(`${baseUrl}/api/platform/availability`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      platformName: 'Test EventHub',
      platformDescription: 'Event organizing and vendor booking platform.',
      maintenanceMode: false,
      maintenanceMessage: 'We are performing scheduled maintenance. Please check back soon.',
      publicRegistrationEnabled: true,
      defaultRegistrationRole: 'customer',
      supportEmail: 'support@example.com',
      supportPhone: '',
      brandingLogoUrl: '',
      platformLocale: 'en',
      platformCurrency: 'ETB',
      reportTimezone: 'Africa/Addis_Ababa',
    },
  });
});

test('settings reads and updates require administrator authentication', async () => {
  const requests = [
    fetch(`${baseUrl}/api/admin/settings`),
    fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_name: 'Unauthorized update' }),
    }),
    fetch(`${baseUrl}/api/admin/settings/reset`, { method: 'POST' }),
  ];

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required.' });
  }
});

test('administrator settings updates validate, persist, reload, and write an audit entry', async () => {
  const headers = { Cookie: `admin_session=${adminToken}`, 'Content-Type': 'application/json' };
  const unconfirmed = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ booking_cancellation_cutoff_hours: 36 }),
  });
  assert.equal(unconfirmed.status, 409);

  const invalid = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ platform_locale: 'fr', confirmConsequential: true }),
  });
  assert.equal(invalid.status, 400);

  const saved = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ booking_cancellation_cutoff_hours: 36, confirmConsequential: true }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.booking_cancellation_cutoff_hours, 36);
  assert.equal(storedSettings.find((row) => row.setting_key === 'booking_cancellation_cutoff_hours').setting_value, '36');
  assert.equal(auditRecords.length, 1);

  const reloaded = await fetch(`${baseUrl}/api/admin/settings`, { headers });
  assert.equal(reloaded.status, 200);
  const result = await reloaded.json();
  assert.equal(result.settings.booking_cancellation_cutoff_hours, 36);
  assert.equal(result.configuration.payments.state, 'pending_integration');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('settings reset requires explicit confirmation and restores safe defaults', async () => {
  const headers = { Cookie: `admin_session=${adminToken}`, 'Content-Type': 'application/json' };
  const unconfirmed = await fetch(`${baseUrl}/api/admin/settings/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  assert.equal(unconfirmed.status, 400);

  const reset = await fetch(`${baseUrl}/api/admin/settings/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).data.platform_name, 'EventHub');
  assert.equal(auditRecords.length, 2);
});
