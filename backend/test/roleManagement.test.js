import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'role-management-test-admin-session';
const roles = [
  { id: 1, name: 'Admin', description: 'Platform administrator', is_admin: 1, is_active: 1, created_at: '2026-01-01' },
  { id: 2, name: 'Vendor', description: 'Service provider', is_admin: 0, is_active: 1, created_at: '2026-01-01' },
  { id: 3, name: 'Customer', description: 'End-user customer', is_admin: 0, is_active: 1, created_at: '2026-01-01' },
  { id: 4, name: 'Organizer', description: 'Event organizer', is_admin: 0, is_active: 1, created_at: '2026-01-01' },
];
const permissionRecords = [
  { id: 1, permission_key: 'admin:*', description: 'All administrator access' },
  { id: 2, permission_key: 'roles.manage', description: 'Manage roles' },
  { id: 3, permission_key: 'roles.permissions.manage', description: 'Manage permissions' },
  { id: 4, permission_key: 'system.settings.manage', description: 'Manage system settings' },
  { id: 5, permission_key: 'bookings.view_own', description: 'View own bookings' },
  { id: 6, permission_key: 'bookings.create', description: 'Create bookings' },
  { id: 7, permission_key: 'bookings.cancel_own', description: 'Cancel own bookings' },
  { id: 8, permission_key: 'vendors.view', description: 'View vendors' },
  { id: 9, permission_key: 'reports.view', description: 'View reports' },
  { id: 10, permission_key: 'events.create', description: 'Create events' },
];

function createDatabase() {
  const statements = [];
  const audits = [];
  const rolePermissionKeys = new Map([
    [1, ['admin:*']],
    [2, ['vendors.view_own']],
    [3, ['bookings.view_own', 'bookings.create']],
    [4, ['events.create']],
  ]);
  let anotherActiveAdmin = false;
  let assignedUserCount = 2;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: 10,
        full_name: 'RBAC Administrator',
        email: 'rbac-admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM roles r')) {
      return [[{ total: roles.length }], []];
    }
    if (sql.includes('COUNT(DISTINCT ur.user_id) AS user_count')) {
      return [roles.map((role) => ({
        ...role,
        user_count: role.id === 1 ? 1 : role.id === 3 ? 2 : 1,
        permission_count: rolePermissionKeys.get(role.id)?.length || 0,
      })), []];
    }
    if (sql === 'SELECT id, permission_key, description FROM permissions ORDER BY permission_key') {
      return [[...permissionRecords], []];
    }
    if (sql.startsWith('SELECT id, permission_key FROM permissions WHERE permission_key IN')) {
      return [permissionRecords.filter((row) => values.includes(row.permission_key)), []];
    }
    if (sql === 'SELECT id, name, is_admin, is_active FROM roles WHERE id = ?') {
      return [roles.filter((role) => role.id === Number(values[0])).map((role) => ({ ...role })), []];
    }
    if (sql === 'SELECT id, name, is_admin FROM roles WHERE id = ? FOR UPDATE'
      || sql === 'SELECT id, name, is_admin, is_active FROM roles WHERE id = ? FOR UPDATE'
      || sql === 'SELECT id, name FROM roles WHERE id = ?') {
      return [roles.filter((role) => role.id === Number(values[0])).map((role) => ({ ...role })), []];
    }
    if (sql.startsWith('SELECT p.permission_key FROM role_permissions')) {
      return [(rolePermissionKeys.get(Number(values[0])) || []).map((permission_key) => ({ permission_key })), []];
    }
    if (sql.includes('FROM users u JOIN user_roles ur ON ur.user_id = u.id')) {
      if (sql.includes('COUNT(DISTINCT u.id) AS total')) return [[{ total: 2 }], []];
      return [[
        { id: 41, full_name: 'Assigned Customer', email: 'assigned@example.test', status: 'active', created_at: '2026-01-02' },
      ], []];
    }
    if (sql.startsWith('SELECT COUNT(DISTINCT user_id) AS total FROM user_roles')) {
      return [[{ total: assignedUserCount }], []];
    }
    if (sql.includes('user_roles ur') && sql.includes('active_admin_role')) {
      return [[{ total: anotherActiveAdmin ? 1 : 0 }], []];
    }
    if (sql.startsWith('DELETE FROM role_permissions')) {
      rolePermissionKeys.set(Number(values[0]), []);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO role_permissions')) {
      const roleId = Number(values[0]);
      rolePermissionKeys.set(roleId, [...(rolePermissionKeys.get(roleId) || []), permissionRecords.find((row) => row.id === Number(values[1])).permission_key]);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audits.push(JSON.parse(values[4]));
      return [{ insertId: audits.length, affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE roles SET is_active = ?')) {
      const role = roles.find((item) => item.id === Number(values[1]));
      role.is_active = values[0] ? 1 : 0;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE s FROM admin_sessions')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }

  const database = {
    statements,
    audits,
    rolePermissionKeys,
    setAnotherActiveAdmin(value) { anotherActiveAdmin = value; },
    setAssignedUserCount(value) { assignedUserCount = value; },
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

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('all role and permission reads and writes require an administrator session', async () => {
  const unauthenticated = await Promise.all([
    fetch(`${baseUrl}/api/admin/roles`),
    fetch(`${baseUrl}/api/admin/permissions`),
    fetch(`${baseUrl}/api/admin/roles/2/permissions`),
    fetch(`${baseUrl}/api/admin/roles/2/users`),
    fetch(`${baseUrl}/api/admin/roles/2/status`, { method: 'PATCH' }),
    fetch(`${baseUrl}/api/admin/roles/2/permissions`, { method: 'PATCH' }),
  ]);
  assert.deepEqual(unauthenticated.map((response) => response.status), [401, 401, 401, 401, 401, 401]);
});

test('role directory uses database records, search, status filters, and assigned-user counts', async () => {
  const response = await adminRequest('/api/admin/roles?page=1&pageSize=10&q=customer&status=active');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 4);
  assert.equal(body.data.find((role) => role.name === 'Customer').is_assignable, true);
  assert.equal(body.data.find((role) => role.name === 'Customer').user_count, 2);
  assert.equal(body.data.find((role) => role.name === 'Admin').is_assignable, false);
  const query = database.statements.find(({ sql }) => sql.includes('COUNT(DISTINCT ur.user_id) AS user_count'));
  assert.match(query.sql, /r\.name LIKE \?/);
  assert.match(query.sql, /r\.is_active = \?/);
});

test('permission directory groups real database permissions and flags protected grants', async () => {
  const response = await adminRequest('/api/admin/permissions');
  assert.equal(response.status, 200);
  const body = await response.json();
  const adminPermission = body.data.find((permission) => permission.permission_key === 'admin:*');
  const reportsPermission = body.data.find((permission) => permission.permission_key === 'reports.view');
  const bookingsPermission = body.data.find((permission) => permission.permission_key === 'bookings.view_own');
  assert.equal(adminPermission.critical, true);
  assert.deepEqual(adminPermission.assignable_roles, []);
  assert.deepEqual(reportsPermission.assignable_roles, []);
  assert.equal(bookingsPermission.module, 'bookings');
  assert.equal(bookingsPermission.action, 'view_own');
  assert.deepEqual(bookingsPermission.assignable_roles, ['organizer', 'vendor', 'customer']);
});

test('role membership is searchable and paginated using database records', async () => {
  const response = await adminRequest('/api/admin/roles/3/users?page=1&pageSize=10&q=assigned');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.role.name, 'Customer');
  assert.equal(body.data[0].email, 'assigned@example.test');
  assert.equal(body.pagination.total, 2);
});

test('role permission read reports current and approved effective permission policies', async () => {
  const response = await adminRequest('/api/admin/roles/3/permissions');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.role.name, 'Customer');
  assert.deepEqual(body.data.permission_keys, ['bookings.view_own', 'bookings.create']);
  assert.ok(body.data.allowed_permission_keys.includes('bookings.cancel_own'));
  assert.equal(body.data.permissions[0].critical, false);
});

test('permission updates reject mass assignment, critical permissions, and permissions outside role policy', async () => {
  for (const payload of [
    { permission_keys: ['admin:*'] },
    { permission_keys: ['system.settings.manage'] },
    { permission_keys: ['reports.view'] },
    { permission_keys: ['bookings.view_own', 'bookings.view_own'] },
    { permission_keys: ['bookings.view_own'], is_admin: true },
  ]) {
    const response = await adminRequest('/api/admin/roles/3/permissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.ok([400, 403].includes(response.status), `unexpected status ${response.status}`);
  }
  assert.deepEqual(database.rolePermissionKeys.get(3), ['bookings.view_own', 'bookings.create']);
});

test('administrator role permissions are immutable and permission updates are audited transactionally', async () => {
  const protectedResponse = await adminRequest('/api/admin/roles/1/permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission_keys: [] }),
  });
  assert.equal(protectedResponse.status, 409);

  const update = await adminRequest('/api/admin/roles/3/permissions', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permission_keys: ['bookings.view_own', 'bookings.cancel_own'] }),
  });
  assert.equal(update.status, 200);
  assert.deepEqual((await update.json()).data.permission_keys, ['bookings.cancel_own', 'bookings.view_own']);
  assert.deepEqual(database.rolePermissionKeys.get(3), ['bookings.view_own', 'bookings.cancel_own']);
  assert.equal(database.audits.at(-1).role, 'Customer');
  assert.deepEqual(database.audits.at(-1).added, ['bookings.cancel_own']);
  assert.deepEqual(database.audits.at(-1).removed, ['bookings.create']);
});

test('system role creation, mass assignment, and deletion are unavailable', async () => {
  const create = await adminRequest('/api/admin/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Super Admin', is_admin: true }),
  });
  assert.equal(create.status, 405);
  const update = await adminRequest('/api/admin/roles/2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_admin: true, is_active: true }),
  });
  assert.equal(update.status, 405);
  const remove = await adminRequest('/api/admin/roles/2', { method: 'DELETE' });
  assert.equal(remove.status, 405);
});

test('role deactivation preserves the last active administrator and assigned platform users', async () => {
  const lastAdmin = await adminRequest('/api/admin/roles/1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(lastAdmin.status, 409);

  const assignedRole = await adminRequest('/api/admin/roles/3/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(assignedRole.status, 409);
  assert.equal(roles[0].is_active, 1);
});

test('administrator role deactivation is allowed only when another active administrator remains and is audited', async () => {
  database.setAnotherActiveAdmin(true);
  const response = await adminRequest('/api/admin/roles/1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(response.status, 200);
  assert.equal(roles[0].is_active, 0);
  assert.equal(database.audits.at(-1).name, 'Admin');
  assert.equal(database.statements.some(({ sql }) => sql.startsWith('DELETE s FROM admin_sessions')), true);
});
