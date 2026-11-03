import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'user-management-test-admin-session';
const adminRow = {
  id: 1,
  full_name: 'Platform Admin',
  email: 'admin@example.test',
  phone: null,
  status: 'active',
  roles: 'Admin',
};
const account = {
  id: 2,
  full_name: 'Jordan Customer',
  email: 'jordan@example.test',
  phone: '+12025550123',
  status: 'active',
  created_at: '2026-01-10T12:00:00.000Z',
  roles: 'Customer',
  role_id: 3,
  bookings_count: 1,
};

function createDatabase() {
  const statements = [];
  let duplicateEmail = false;
  let duplicatePhone = false;
  let failUserList = false;
  let insertedPasswordHash = '';
  let insertedUserValues = [];
  const deletedSessions = [];
  const user = { ...account };

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM system_settings')) {
      return [[{ setting_key: 'public_registration_enabled', setting_value: 'true' }], []];
    }
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{ ...adminRow }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM users u')) {
      if (failUserList) throw new Error('test database failure');
      return [[{ total: 1 }], []];
    }
    if (sql.includes('GROUP_CONCAT(DISTINCT r.name')) {
      return [[{ ...user }], []];
    }
    if (sql.includes('FROM users WHERE id = ? LIMIT 1')) {
      return [Number(values[0]) === user.id ? [{ id: user.id, full_name: user.full_name, email: user.email }] : [], []];
    }
    if (sql.includes('FROM users WHERE id = ? FOR UPDATE')) {
      return [Number(values[0]) === user.id ? [{ id: user.id, status: user.status }] : [], []];
    }
    if (sql.includes('FROM users u WHERE u.id = ? FOR UPDATE')) {
      return [Number(values[0]) === user.id ? [{ id: user.id, is_admin: 0 }] : [], []];
    }
    if (sql.includes('FROM users WHERE id = ?')) {
      return [Number(values[0]) === user.id ? [{ id: user.id }] : [], []];
    }
    if (sql.startsWith('SELECT id, name FROM roles WHERE id = ?')) {
      const roles = {
        3: { id: 3, name: 'Customer' },
        4: { id: 4, name: 'Organizer' },
        5: { id: 5, name: 'Vendor' },
      };
      return [roles[Number(values[0])] ? [roles[Number(values[0])]] : [], []];
    }
    if (sql.includes("LOWER(name) = 'customer'")) return [[{ id: 3 }], []];
    if (sql.includes('FROM users WHERE phone = ?')) {
      return [duplicatePhone ? [{ id: 9 }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM roles')) return [[{ total: 1 }], []];
    if (sql.includes('GROUP_CONCAT(r.name ORDER BY r.name')) return [[{ id: 3, name: 'Customer', is_admin: 0, is_active: 1 }], []];
    if (sql.startsWith('INSERT INTO users')) {
      if (duplicateEmail) throw Object.assign(new Error('Duplicate email'), { code: 'ER_DUP_ENTRY' });
      insertedUserValues = values;
      insertedPasswordHash = values[3];
      return [{ insertId: 20, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO user_roles')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1, affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE users SET')) {
      if (sql.includes('status')) user.status = values[0];
      else if (sql.includes('full_name')) user.full_name = values[0];
      else if (sql.includes('email')) user.email = values[0];
      else if (sql.includes('phone')) user.phone = values[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE FROM user_sessions') || sql.startsWith('DELETE FROM admin_sessions')) {
      deletedSessions.push(sql);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM user_roles')) return [[{ total: 0 }], []];
    if (sql.startsWith('SELECT (last_sent_at')) return [[], []];
    if (sql.startsWith('INSERT INTO password_reset_otp_challenges')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('DELETE FROM password_reset_tokens')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE password_reset_otp_challenges')) return [{ affectedRows: 1 }, []];
    if (sql.includes('FROM bookings b')) return [[{
      id: 8,
      event_title: 'Spring Reception',
      service_description: 'Catering',
      vendor_name: 'Example Vendor',
      quoted_amount: '125.00',
      currency: 'USD',
      status: 'completed',
      payment_count: 1,
      paid_total: '125.00',
      created_at: '2026-02-01T10:00:00.000Z',
    }], []];
    if (sql.includes('FROM audit_logs')) return [[{
      id: 12,
      actor_id: 1,
      action: 'user.status_changed',
      entity_type: 'user',
      entity_id: '2',
      created_at: '2026-02-02T10:00:00.000Z',
    }], []];
    if (sql.includes('FROM password_reset_otp_challenges')) return [[], []];
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }

  const database = {
    statements,
    deletedSessions,
    setDuplicateEmail(value) { duplicateEmail = value; },
    setDuplicatePhone(value) { duplicatePhone = value; },
    setFailUserList(value) { failUserList = value; },
    getInsertedPasswordHash() { return insertedPasswordHash; },
    getInsertedUserValues() { return insertedUserValues; },
    async execute(...args) { return execute(...args); },
    async query() { return [[], []]; },
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
  return database;
}

const database = createDatabase();
const deliveredResetMessages = [];
const app = createApp({
  database,
  emailConfigured: () => true,
  emailSender: async (message) => { deliveredResetMessages.push(message); },
  otpGenerator: () => '123456',
  otpHasher: async () => ({ hash: 'test-otp-hash', salt: 'test-otp-salt' }),
});
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

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('user management endpoints require an authenticated administrator', async () => {
  for (const [path, options] of [
    ['/api/admin/users', {}],
    ['/api/admin/users/2/activity', {}],
    ['/api/admin/users/2/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'suspended', reason: 'Policy breach' }) }],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, options);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required.' });
  }

  const platformUser = await fetch(`${baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'platform_session=customer-session',
    },
    body: JSON.stringify({
      full_name: 'Unauthorized Organizer',
      email: 'unauthorized@example.test',
      password: 'StrongInitialPassword123',
      role_id: 4,
    }),
  });
  assert.equal(platformUser.status, 401);
});

test('public registration rejects organizer and vendor role requests', async () => {
  for (const role of ['organizer', 'vendor']) {
    const response = await fetch(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Account',
        email: `${role}@example.test`,
        password: 'StrongPass123',
        role,
      }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Public registration is limited to customer accounts.' });
  }
});

test('public registration creates an authenticated customer account only', async () => {
  const response = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Public Customer',
      email: 'public-customer@example.test',
      password: 'StrongPass123',
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.user.role, 'customer');
  assert.equal(response.headers.get('set-cookie')?.includes('platform_session='), true);
  assert.equal(database.statements.some(({ sql, values }) => sql.startsWith('INSERT INTO user_roles') && values[1] === 3), true);
});

test('user listing applies database filters, sorting, and pagination without exposing hashes', async () => {
  const response = await adminRequest('/api/admin/users?page=2&pageSize=10&q=2&status=active&role=customer&dateFrom=2026-01-01&dateTo=2026-01-31&sortBy=email&sortDirection=asc');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.page, 2);
  assert.equal(body.pagination.pageSize, 10);
  assert.equal(body.data[0].email, account.email);
  assert.equal(JSON.stringify(body).includes('password_hash'), false);
  const countQuery = database.statements.find(({ sql }) => sql.startsWith('SELECT COUNT(*) AS total FROM users u'));
  const listQuery = database.statements.find(({ sql }) => sql.includes('ORDER BY u.email ASC'));
  assert.match(countQuery.sql, /u\.full_name LIKE \? OR u\.email LIKE \? OR COALESCE\(u\.phone, ''\) LIKE \? OR CAST\(u\.id AS CHAR\) = \?/);
  assert.match(countQuery.sql, /filter_r\.name\) = LOWER\(\?\)/);
  assert.match(countQuery.sql, /u\.created_at >= \?/);
  assert.match(countQuery.sql, /u\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.match(listQuery.sql, /ORDER BY u\.email ASC/);
  assert.deepEqual(listQuery.values.slice(-2), [10, 10]);
});

test('user listing rejects invalid registration dates and invalid pagination', async () => {
  const invalidDate = await adminRequest('/api/admin/users?dateFrom=2026-02-31');
  assert.equal(invalidDate.status, 400);
  const invalidRange = await adminRequest('/api/admin/users?dateFrom=2026-02-10&dateTo=2026-02-01');
  assert.equal(invalidRange.status, 400);
  const invalidPage = await adminRequest('/api/admin/users?pageSize=1000');
  assert.equal(invalidPage.status, 400);
});

test('administrator can create organizer and vendor accounts with a bcrypt-hashed password', async () => {
  const weakPassword = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Weak Password Account',
      email: 'weak-password@example.test',
      password: 'aaaaaaaaaaaaaaaa',
      role_id: 4,
    }),
  });
  assert.equal(weakPassword.status, 400);

  const response = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'New Organizer',
      email: ' NEW@example.test ',
      phone: '',
      password: 'StrongInitialPassword123',
      role_id: 4,
      status: 'suspended',
    }),
  });
  const responseBody = await response.json();
  assert.equal(response.status, 201, JSON.stringify(responseBody));
  assert.deepEqual(responseBody, { data: { id: 20 } });
  assert.notEqual(database.getInsertedPasswordHash(), 'StrongInitialPassword123');
  assert.equal(await bcrypt.compare('StrongInitialPassword123', database.getInsertedPasswordHash()), true);
  assert.equal(database.getInsertedUserValues()[4], 'suspended');

  const vendor = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'New Vendor',
      email: 'vendor@example.test',
      password: 'StrongInitialPassword123',
      role_id: 5,
    }),
  });
  assert.equal(vendor.status, 201);

  database.setDuplicateEmail(true);
  const duplicateResponse = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Duplicate User',
      email: 'jordan@example.test',
      password: 'StrongInitialPassword123',
      role_id: 4,
    }),
  });
  assert.equal(duplicateResponse.status, 409);
  database.setDuplicateEmail(false);

  database.setDuplicatePhone(true);
  const duplicatePhoneResponse = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Duplicate Phone',
      email: 'different@example.test',
      phone: '+12025550123',
      password: 'StrongInitialPassword123',
      role_id: 4,
    }),
  });
  assert.equal(duplicatePhoneResponse.status, 409);
  database.setDuplicatePhone(false);

  const administratorRole = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Unauthorized Administrator',
      email: 'new-admin@example.test',
      password: 'StrongInitialPassword123',
      role_id: 1,
    }),
  });
  assert.equal(administratorRole.status, 400);

  const customerRole = await adminRequest('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Admin-created Customer',
      email: 'customer@example.test',
      password: 'StrongInitialPassword123',
      role_id: 3,
    }),
  });
  assert.equal(customerRole.status, 400);
});

test('administrator can create organizer and vendor accounts, and vendor profiles are provisioned', async () => {
  for (const [roleId, status] of [[4, 'active'], [5, 'suspended']]) {
    const response = await adminRequest('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Platform Account',
        email: `role-${roleId}@example.test`,
        password: 'StrongInitialPassword123',
        role_id: roleId,
        status,
      }),
    });
    assert.equal(response.status, 201);
  }
  assert.equal(database.statements.some(({ sql }) => sql.startsWith('INSERT INTO vendor_profiles')), true);
});

test('user updates validate editable fields and reject role escalation through profile updates', async () => {
  const selfEmailChange = await adminRequest('/api/admin/users/1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'unverified@example.test' }),
  });
  assert.equal(selfEmailChange.status, 409);

  const invalid = await adminRequest('/api/admin/users/2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: 1 }),
  });
  assert.equal(invalid.status, 400);

  const updated = await adminRequest('/api/admin/users/2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Jordan Updated', email: 'JORDAN@example.test' }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), { data: { id: 2 } });
  assert.equal(database.statements.some(({ sql, values }) => sql.startsWith('UPDATE users SET') && values.includes('jordan@example.test')), true);
});

test('role changes reject self-change and cannot assign administrator roles', async () => {
  const self = await adminRequest('/api/admin/users/1/role', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: 3 }),
  });
  assert.equal(self.status, 400);
  const escalation = await adminRequest('/api/admin/users/2/role', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: 1 }),
  });
  assert.equal(escalation.status, 404);

  const permittedRole = await adminRequest('/api/admin/users/2/role', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: 3 }),
  });
  assert.equal(permittedRole.status, 200);
  assert.ok(database.deletedSessions.includes('DELETE FROM user_sessions WHERE user_id = ?'));
});

test('status changes require a reason and revoke both session types when deactivated', async () => {
  const invalid = await adminRequest('/api/admin/users/2/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'suspended', reason: 'x' }),
  });
  assert.equal(invalid.status, 400);

  const suspended = await adminRequest('/api/admin/users/2/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'suspended', reason: 'Policy breach' }),
  });
  assert.equal(suspended.status, 200);
  assert.ok(database.deletedSessions.includes('DELETE FROM user_sessions WHERE user_id = ?'));
  assert.ok(database.deletedSessions.includes('DELETE FROM admin_sessions WHERE user_id = ?'));

  const activated = await adminRequest('/api/admin/users/2/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active', reason: 'Account verified' }),
  });
  assert.equal(activated.status, 200);
});

test('user detail endpoint returns booking and administrative activity records', async () => {
  const response = await adminRequest('/api/admin/users/2/activity');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.bookings[0].event_title, 'Spring Reception');
  assert.equal(body.data.activity[0].action, 'user.status_changed');
});

test('accounts cannot be deleted through the admin resource API', async () => {
  const response = await adminRequest('/api/admin/users/2', { method: 'DELETE' });
  assert.equal(response.status, 405);
  assert.equal(database.statements.some(({ sql }) => sql.startsWith('DELETE FROM users')), false);
});

test('password reset initiation emails a code without returning it or exposing credentials', async () => {
  const response = await adminRequest('/api/admin/users/2/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes('123456'), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveredResetMessages.at(-1).email, account.email);
});

test('database failures are reported as API errors', async () => {
  database.setFailUserList(true);
  const response = await adminRequest('/api/admin/users');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'The request could not be completed.' });
  database.setFailUserList(false);
});
