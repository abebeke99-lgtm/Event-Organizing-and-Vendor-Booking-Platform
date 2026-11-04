import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'admin-vendor-featured-test-session';
const vendorRows = new Map([
  [7, { id: 7, verification_status: 'verified', is_featured: false }],
  [8, { id: 8, verification_status: 'pending', is_featured: false }],
]);
const statements = [];

async function execute(sql, values = []) {
  statements.push({ sql, values });
  if (sql.includes('FROM admin_sessions s')) {
    return [values[0] === hashToken(adminToken) ? [{
      id: 1,
      full_name: 'Platform Admin',
      email: 'admin@example.test',
      phone: null,
      preferred_language: 'en',
      status: 'active',
      roles: 'Admin',
    }] : [], []];
  }
  if (sql.startsWith('SELECT id, verification_status, is_featured FROM vendor_profiles')) {
    const vendor = vendorRows.get(Number(values[0]));
    return [vendor ? [{ ...vendor }] : [], []];
  }
  if (sql.startsWith('UPDATE vendor_profiles SET is_featured')) {
    const vendor = vendorRows.get(Number(values[1]));
    if (vendor) vendor.is_featured = values[0];
    return [{ affectedRows: vendor ? 1 : 0 }, []];
  }
  if (sql.includes('INSERT INTO audit_logs')) return [{ insertId: statements.length, affectedRows: 1 }, []];
  throw new Error(`Unexpected test SQL: ${sql}`);
}

const database = {
  execute,
  async getConnection() {
    return {
      execute,
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    };
  },
};
const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
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

function request(path, { body, authenticated = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      ...(authenticated ? { Cookie: `admin_session=${adminToken}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('only an authorized administrator can manage featured vendors', async () => {
  const anonymous = await request('/api/admin/vendors/7/featured', { body: { is_featured: true }, authenticated: false });
  assert.equal(anonymous.status, 401);

  const enabled = await request('/api/admin/vendors/7/featured', { body: { is_featured: true } });
  assert.equal(enabled.status, 200);
  assert.deepEqual((await enabled.json()).data, { id: 7, is_featured: true });
  assert.equal(vendorRows.get(7).is_featured, true);
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));

  const disabled = await request('/api/admin/vendors/7/featured', { body: { is_featured: false } });
  assert.equal(disabled.status, 200);
  assert.equal(vendorRows.get(7).is_featured, false);
});

test('featured vendor changes validate the flag and only allow verified vendors', async () => {
  const invalid = await request('/api/admin/vendors/7/featured', { body: { is_featured: 'true' } });
  assert.equal(invalid.status, 400);

  const pending = await request('/api/admin/vendors/8/featured', { body: { is_featured: true } });
  assert.equal(pending.status, 409);
  assert.equal(vendorRows.get(8).is_featured, false);

  const missing = await request('/api/admin/vendors/999/featured', { body: { is_featured: true } });
  assert.equal(missing.status, 404);
});
