import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const sessionToken = 'vendor-api-test-session';
const user = {
  id: 44,
  full_name: 'Vendor Test',
  email: 'vendor-test@example.test',
  phone: null,
  status: 'active',
  role: 'vendor',
};

function createDatabase() {
  const vendor = {
    id: 10,
    user_id: user.id,
    business_name: 'Vendor Test Business',
    category_id: null,
    category_name: null,
    city: null,
    description: '',
    verification_status: 'verified',
    verification_reason: null,
    verified_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    status: user.status,
  };
  const services = [];
  const verificationDocuments = [];
  const statements = [];
  let permissionKeys = ['services.manage_own', 'bookings.view_own'];
  let nextServiceId = 1;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM user_sessions s')) {
      return [values[0] === hashToken(sessionToken) ? [{ ...user, permission_keys: permissionKeys.join(',') }] : [], []];
    }
    if (sql.includes('FROM vendor_profiles vp') && sql.includes('WHERE vp.user_id = ?')) {
      return [Number(values[0]) === vendor.user_id ? [{ ...vendor }] : [], []];
    }
    if (sql.startsWith('SELECT id FROM service_categories')) {
      return [Number(values[0]) === 3 ? [{ id: 3 }] : [], []];
    }
    if (sql.startsWith('SELECT s.id') && sql.includes('FROM services s')) {
      return [services
        .filter((service) => service.vendor_id === vendor.id)
        .map((service) => ({ ...service, category: 'General', booking_count: 0 })), []];
    }
    if (sql.startsWith('INSERT INTO services')) {
      const id = nextServiceId++;
      const [vendorId, categoryId, title, description, price, currency, status] = values;
      services.push({ id, vendor_id: vendorId, category_id: categoryId, title, description, price, currency, status });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT id, status FROM services WHERE id = ? AND vendor_id = ?')) {
      const service = services.find((row) => row.id === Number(values[0]) && row.vendor_id === Number(values[1]));
      return [service ? [{ id: service.id, status: service.status }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM vendor_verification_documents')) {
      return [[{ total: verificationDocuments.length }], []];
    }
    if (sql.startsWith('SELECT id, original_name, content_type, file_size, created_at FROM vendor_verification_documents')) {
      return [verificationDocuments.map(({ content, ...document }) => ({ ...document })), []];
    }
    if (sql.startsWith('SELECT from_status, to_status, reason, created_at FROM vendor_verification_history')) {
      return [[], []];
    }
    if (sql.startsWith('INSERT INTO vendor_verification_documents')) {
      const [vendorId, uploadedBy, originalName, contentType, fileSize, content] = values;
      const document = { id: verificationDocuments.length + 1, vendor_id: vendorId, uploaded_by: uploadedBy, original_name: originalName, content_type: contentType, file_size: fileSize, content, created_at: new Date().toISOString() };
      verificationDocuments.push(document);
      return [{ insertId: document.id, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1, affectedRows: 1 }, []];
    if (sql === "UPDATE services SET status = 'archived' WHERE id = ? AND vendor_id = ?") {
      const service = services.find((row) => row.id === Number(values[0]) && row.vendor_id === Number(values[1]));
      if (!service) return [{ affectedRows: 0 }, []];
      service.status = 'archived';
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE services SET')) {
      const fieldList = sql.match(/^UPDATE services SET (.+) WHERE id = \? AND vendor_id = \?$/)?.[1];
      const fields = fieldList?.split(', ').map((field) => field.split(' = ')[0]) || [];
      const id = Number(values[values.length - 2]);
      const vendorId = Number(values[values.length - 1]);
      const service = services.find((row) => row.id === id && row.vendor_id === vendorId);
      if (!service) return [{ affectedRows: 0 }, []];
      fields.forEach((field, index) => { service[field] = values[index]; });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE vendor_profiles SET')) {
      const fieldList = sql.match(/^UPDATE vendor_profiles SET (.+) WHERE user_id = \?$/)?.[1];
      const fields = fieldList?.split(', ').map((field) => field.split(' = ')[0]) || [];
      fields.forEach((field, index) => { vendor[field] = values[index]; });
      if (Object.hasOwn(vendor, 'category_id')) {
        vendor.category_name = vendor.category_id === 3 ? 'Catering' : null;
      }
      return [{ affectedRows: 1 }, []];
    }
    if (sql === 'UPDATE users SET phone = ? WHERE id = ?') {
      user.phone = values[0];
      vendor.phone = values[0];
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  }

  return {
    vendor,
    services,
    verificationDocuments,
    statements,
    execute,
    query: execute,
    setPermissionKeys(keys) { permissionKeys = keys; },
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
}

const database = createDatabase();
const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60000,
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

async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = {};
  if (authenticated) headers.Cookie = `platform_session=${sessionToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('vendor profile and services require an authenticated vendor session', async () => {
  const response = await request('/api/vendor/profile', { authenticated: false });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});

test('vendor can update only supported profile fields and persists them through the injected database', async () => {
  const response = await request('/api/vendor/profile', {
    method: 'PATCH',
    body: { businessName: 'Updated Catering', categoryId: 3, city: 'Addis Ababa', phone: '+251900000000' },
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.businessName, 'Updated Catering');
  assert.equal(result.data.businessType, 'Catering');
  assert.equal(result.data.phone, '+251900000000');
  assert.equal(database.statements.some(({ sql }) => sql.includes('UPDATE vendor_profiles SET') && sql.includes('WHERE user_id = ?')), true);
  assert.equal(database.statements.some(({ sql, values }) => sql === 'UPDATE users SET phone = ? WHERE id = ?' && values[1] === user.id), true);
});

test('vendor cannot update profile fields outside the schema', async () => {
  const response = await request('/api/vendor/profile', {
    method: 'PATCH',
    body: { businessName: 'Updated Catering', userId: 999 },
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid request data/);
});

test('vendor can create and read an owned service through the injected database', async () => {
  const createResponse = await request('/api/vendor/services', {
    method: 'POST',
    body: { title: 'Wedding Catering', description: 'Custom menus', price: 25000 },
  });

  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).data;
  assert.equal(created.vendorId, user.id === 44 ? 10 : 0);
  assert.equal(created.status, 'Draft');
  assert.equal(database.services[0].vendor_id, 10);

  const listResponse = await request('/api/vendor/services');
  assert.equal(listResponse.status, 200);
  const list = (await listResponse.json()).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Wedding Catering');
});

test('unverified vendors cannot publish services and invalid service data is rejected', async () => {
  const serviceCountBefore = database.services.length;
  database.vendor.verification_status = 'pending';
  const publish = await request('/api/vendor/services', {
    method: 'POST',
    body: { title: 'Unverified service', status: 'active' },
  });
  database.vendor.verification_status = 'verified';
  assert.equal(publish.status, 403);
  assert.equal(database.services.length, serviceCountBefore);

  const badCategory = await request('/api/vendor/services', {
    method: 'POST',
    body: { title: 'Wedding Catering', categoryId: 999 },
  });
  assert.equal(badCategory.status, 400);

  const invalid = await request('/api/vendor/services', {
    method: 'POST',
    body: { title: 'x', price: -1 },
  });
  assert.equal(invalid.status, 400);
});

test('vendor can update owned services but cannot update another vendor service', async () => {
  const owned = database.services[0];
  const updateResponse = await request(`/api/vendor/services/${owned.id}`, {
    method: 'PATCH',
    body: { title: 'Updated Catering', price: 30000 },
  });
  assert.equal(updateResponse.status, 200);
  assert.equal(owned.title, 'Updated Catering');
  assert.equal(Number(owned.price), 30000);

  database.services.push({ id: 500, vendor_id: 77, title: 'Private service', status: 'active' });
  const foreignResponse = await request('/api/vendor/services/500', {
    method: 'PATCH',
    body: { title: 'Unauthorized edit' },
  });
  assert.equal(foreignResponse.status, 404);
  assert.equal(database.services.find((service) => service.id === 500).title, 'Private service');
});

test('vendor service deletion archives the owned record and rejects another vendor record', async () => {
  const owned = database.services[0];
  const response = await request(`/api/vendor/services/${owned.id}`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.equal(owned.status, 'archived');
  assert.equal(database.statements.some(({ sql }) => /^DELETE FROM services/i.test(sql)), false);

  const foreignResponse = await request('/api/vendor/services/500', { method: 'DELETE' });
  assert.equal(foreignResponse.status, 404);
  assert.equal(database.services.find((service) => service.id === 500).status, 'active');
});

test('revoking a role permission blocks the protected vendor operation on the next request', async () => {
  database.setPermissionKeys(['bookings.view_own']);
  const response = await request('/api/vendor/services');
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Access denied. The required permission is not assigned to this account.',
  });

  test('unverified vendors cannot mutate services, but can securely upload verification documents', async () => {
    database.vendor.verification_status = 'suspended';
    const blocked = await request('/api/vendor/services', {
      method: 'POST',
      body: { title: 'Suspended vendor service' },
    });
    assert.equal(blocked.status, 403);

    database.vendor.verification_status = 'information_requested';
    const pdf = Buffer.from('%PDF-1.7 vendor license');
    const uploaded = await fetch(`${baseUrl}/api/vendor/verification/documents?filename=license.pdf`, {
      method: 'POST',
      headers: {
        Cookie: `platform_session=${sessionToken}`,
        'Content-Type': 'application/pdf',
      },
      body: pdf,
    });
    assert.equal(uploaded.status, 201);
    assert.equal(database.verificationDocuments[0].original_name, 'license.pdf');
    assert.deepEqual(database.verificationDocuments[0].content, pdf);

    const spoofed = await fetch(`${baseUrl}/api/vendor/verification/documents?filename=fake.pdf`, {
      method: 'POST',
      headers: {
        Cookie: `platform_session=${sessionToken}`,
        'Content-Type': 'application/pdf',
      },
      body: Buffer.from('not a PDF'),
    });
    assert.equal(spoofed.status, 400);
    database.vendor.verification_status = 'verified';
  });
  database.setPermissionKeys(['services.manage_own', 'bookings.view_own']);
});