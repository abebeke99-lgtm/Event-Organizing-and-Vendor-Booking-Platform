import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

const storedSettings = [
  { setting_key: 'platform_name', setting_value: 'Test EventHub' },
  { setting_key: 'support_email', setting_value: 'support@example.com' },
  { setting_key: 'platform_status', setting_value: 'open' },
  { setting_key: 'maintenance_mode', setting_value: 'false' },
  { setting_key: 'public_registration_enabled', setting_value: 'true' },
];

const database = {
  async execute(_statement, keys = []) {
    return [storedSettings.filter((row) => keys.includes(row.setting_key)), []];
  },
  async query() {
    return [[], []];
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
