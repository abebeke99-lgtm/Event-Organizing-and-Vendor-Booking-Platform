import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const syntheticPassword = 'SyntheticAdminPassword12';
const passwordHash = await bcrypt.hash(syntheticPassword, 4);
const users = new Map([
  ['active-admin@example.test', {
    id: 21,
    full_name: 'Synthetic Admin',
    email: 'active-admin@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'active',
    has_admin_role: 1,
    has_active_admin_role: 1,
  }],
  ['inactive-admin@example.test', {
    id: 22,
    full_name: 'Inactive Admin',
    email: 'inactive-admin@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'suspended',
    has_admin_role: 1,
    has_active_admin_role: 1,
  }],
  ['inactive-role@example.test', {
    id: 23,
    full_name: 'Inactive Role',
    email: 'inactive-role@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'active',
    has_admin_role: 1,
    has_active_admin_role: 0,
  }],
  ['customer@example.test', {
    id: 24,
    full_name: 'Synthetic Customer',
    email: 'customer@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'active',
    has_admin_role: 0,
    has_active_admin_role: 0,
  }],
  ['organizer@example.test', {
    id: 25,
    full_name: 'Synthetic Organizer',
    email: 'organizer@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'active',
    has_admin_role: 0,
    has_active_admin_role: 0,
  }],
  ['vendor@example.test', {
    id: 26,
    full_name: 'Synthetic Vendor',
    email: 'vendor@example.test',
    preferred_language: 'en',
    password_hash: passwordHash,
    status: 'active',
    has_admin_role: 0,
    has_active_admin_role: 0,
  }],
]);
const sessions = new Map();
const statements = [];

const database = {
  async execute(statement, values = []) {
    statements.push(statement);
    if (statement.includes('FROM system_settings')) return [[], []];
    if (statement.includes('FROM users u') && statement.includes('has_admin_role')) {
      const user = users.get(values[0]);
      return [user ? [user] : [], []];
    }
    if (statement.includes('FROM users u') && statement.includes('NOT EXISTS')) {
      return [[], []];
    }
    if (statement.startsWith('INSERT INTO admin_sessions')) {
      sessions.set(values[0], { user_id: values[1], expires_at: values[2] });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1 }, []];
    if (statement.includes('FROM admin_sessions s')) {
      const session = sessions.get(values[0]);
      const user = [...users.values()].find((candidate) => candidate.id === session?.user_id);
      return [session && user ? [{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        status: user.status,
        roles: 'Admin',
      }] : [], []];
    }
    if (statement.includes('profile_photo IS NOT NULL')) {
      const user = [...users.values()].find((candidate) => candidate.id === values[0]);
      return [user ? [{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: null,
        status: user.status,
        created_at: '2026-01-01 00:00:00',
        has_profile_photo: 0,
        roles: user.has_admin_role ? 'Admin' : '',
      }] : [], []];
    }
    throw new Error(`Unexpected authentication query: ${statement.slice(0, 60)}`);
  },
  async query() {
    return [[], []];
  },
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      async execute() { return [{ affectedRows: 1 }, []]; },
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

async function login(email, password = syntheticPassword) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('active administrator authenticates with bcrypt and receives an HttpOnly admin session', async () => {
  const response = await login('active-admin@example.test');
  const body = await response.json();
  const cookie = response.headers.get('set-cookie') || '';
  const token = cookie.match(/admin_session=([^;]+)/)?.[1];

  assert.equal(response.status, 200);
  assert.equal(body.user.email, 'active-admin@example.test');
  assert.equal(body.user.id, 21);
  assert.equal(Object.hasOwn(body.user, 'password_hash'), false);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.ok(token);
  assert.ok(sessions.has(hashToken(decodeURIComponent(token))));

  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: `admin_session=${token}` },
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.email, 'active-admin@example.test');

  const dashboardResponse = await fetch(`${baseUrl}/api/admin/profile`, {
    headers: { Cookie: `admin_session=${token}` },
  });
  assert.equal(dashboardResponse.status, 200);
  assert.equal((await dashboardResponse.json()).data.roles, 'Admin');
});

test('administrator login rejects incorrect passwords without creating a session', async () => {
  const response = await login('active-admin@example.test', 'wrong-synthetic-password');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Invalid administrator credentials.' });
  assert.equal(response.headers.has('set-cookie'), false);
});

test('administrator login reports inactive accounts and inactive administrator roles', async () => {
  for (const email of ['inactive-admin@example.test', 'inactive-role@example.test']) {
    const response = await login(email);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'This administrator account or role is inactive.',
    });
  }
});

test('administrator login rejects customer, organizer, and vendor accounts', async () => {
  for (const email of ['customer@example.test', 'organizer@example.test', 'vendor@example.test']) {
    const response = await login(email);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'This account is not authorized for administrator access.',
    });
  }
});

test('unknown administrator email receives the invalid-credentials response', async () => {
  const response = await login('missing@example.test');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Invalid administrator credentials.' });
});

test('administrator dashboard API rejects requests without an authenticated admin session', async () => {
  const response = await fetch(
    `${baseUrl}/api/admin/dashboard/overview?startDate=2026-10-01&endDate=2026-10-30`,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required.' });
});

test('platform login query excludes every administrator account', async () => {
  statements.length = 0;
  const response = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'active-admin@example.test', password: syntheticPassword }),
  });
  const platformLoginQuery = statements.find((statement) => statement.includes('NOT EXISTS'));

  assert.equal(response.status, 401);
  assert.ok(platformLoginQuery);
  assert.match(platformLoginQuery, /admin_role\.is_admin = TRUE/);
});
