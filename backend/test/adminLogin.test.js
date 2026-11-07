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
    id: 21, full_name: 'Synthetic Admin', email: 'active-admin@example.test',
    password_hash: passwordHash, status: 'active', role: 'admin', is_admin: 1, role_is_active: 1,
  }],
  ['inactive-admin@example.test', {
    id: 22, full_name: 'Inactive Admin', email: 'inactive-admin@example.test',
    password_hash: passwordHash, status: 'suspended', role: 'admin', is_admin: 1, role_is_active: 1,
  }],
  ['inactive-role@example.test', {
    id: 23, full_name: 'Inactive Role', email: 'inactive-role@example.test',
    password_hash: passwordHash, status: 'active', role: 'admin', is_admin: 1, role_is_active: 0,
  }],
  ['customer@example.test', {
    id: 24, full_name: 'Synthetic Customer', email: 'customer@example.test',
    password_hash: passwordHash, status: 'active', role: 'customer', is_admin: 0, role_is_active: 1,
  }],
  ['organizer@example.test', {
    id: 25, full_name: 'Synthetic Organizer', email: 'organizer@example.test',
    password_hash: passwordHash, status: 'active', role: 'organizer', is_admin: 0, role_is_active: 1,
  }],
  ['vendor@example.test', {
    id: 26, full_name: 'Synthetic Vendor', email: 'vendor@example.test',
    password_hash: passwordHash, status: 'active', role: 'vendor', is_admin: 0, role_is_active: 1,
  }],
]);
const sessions = new Map();
let customerSessionToken;

function findUserById(id) {
  return [...users.values()].find((user) => String(user.id) === String(id));
}

function findSession(tokenHash) {
  return sessions.get(tokenHash);
}

const database = {
  async execute(statement, values = []) {
    if (statement.includes('FROM system_settings')) return [[], []];
    if (statement.includes('FROM users u') && statement.includes('LOWER(u.email) = ?')) {
      const user = users.get(values[0]);
      return [user ? [user] : [], []];
    }
    if (statement.startsWith('UPDATE users SET last_login_at')) return [{ affectedRows: 1 }, []];
    if (statement.includes('FROM users u') && statement.includes('GROUP_CONCAT(DISTINCT r.name')) {
      const session = findSession(values[0]);
      const user = findUserById(session?.user_id);
      return [user?.is_admin ? [{ ...user, roles: 'Admin' }] : [], []];
    }
    if (statement.includes('FROM user_sessions s') && statement.includes('SELECT 1 FROM user_sessions')) {
      const user = findUserById(findSession(values[0])?.user_id);
      return [user && user.status === 'active' && !user.is_admin ? [{ 1: 1 }] : [], []];
    }
    if (statement.includes('FROM user_sessions s') && statement.includes('GROUP_CONCAT(DISTINCT p.permission_key')) {
      const user = findUserById(findSession(values[0])?.user_id);
      return [user && user.status === 'active' && user.role_is_active
        ? [{ ...user, permission_keys: '' }]
        : [], []];
    }
    if (statement.includes('profile_photo IS NOT NULL')) {
      const user = findUserById(values[0]);
      return [user ? [{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: null,
        status: user.status,
        created_at: '2026-01-01 00:00:00',
        has_profile_photo: 0,
        roles: user.is_admin ? 'Admin' : '',
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
      async execute(statement, values = []) {
        if (statement.startsWith('INSERT INTO user_sessions')) {
          sessions.set(values[0], { user_id: values[1], expires_at: values[2] });
        }
        return [{ affectedRows: 1, insertId: 1 }, []];
      },
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

async function login(email, password = syntheticPassword, endpoint = '/api/platform/login') {
  return fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('one platform login endpoint authenticates all four roles with a shared HttpOnly cookie session', async () => {
  for (const [email, role] of [
    ['active-admin@example.test', 'admin'],
    ['organizer@example.test', 'organizer'],
    ['vendor@example.test', 'vendor'],
    ['customer@example.test', 'customer'],
  ]) {
    const response = await login(`  ${email.toUpperCase()}  `);
    const body = await response.json();
    const cookie = response.headers.get('set-cookie') || '';
    const token = cookie.match(/platform_session=([^;]+)/)?.[1];

    assert.equal(response.status, 200);
    assert.equal(body.user.email, email);
    assert.equal(body.user.role, role);
    assert.equal(Object.hasOwn(body.user, 'password_hash'), false);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.ok(token);
    assert.ok(sessions.has(hashToken(decodeURIComponent(token))));
    if (role === 'customer') customerSessionToken = token;
  }
});

test('deprecated administrator login endpoint aliases the unified endpoint', async () => {
  const response = await login('active-admin@example.test', syntheticPassword, '/api/auth/login');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'admin');
  assert.match(response.headers.get('set-cookie') || '', /platform_session=/);
});

test('both session inspection endpoints accept the same admin session', async () => {
  const loginResponse = await login('active-admin@example.test');
  const token = (loginResponse.headers.get('set-cookie') || '').match(/platform_session=([^;]+)/)?.[1];

  const [adminResponse, platformResponse] = await Promise.all([
    fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: `platform_session=${token}` } }),
    fetch(`${baseUrl}/api/platform/me`, { headers: { Cookie: `platform_session=${token}` } }),
  ]);
  assert.equal(adminResponse.status, 200);
  assert.equal((await adminResponse.json()).user.role, 'admin');
  assert.equal(platformResponse.status, 200);
  assert.equal((await platformResponse.json()).data.user.role, 'admin');
});

test('inactive accounts and inactive roles receive clear errors', async () => {
  const inactiveAccount = await login('inactive-admin@example.test');
  assert.equal(inactiveAccount.status, 403);
  assert.match((await inactiveAccount.json()).error, /inactive/i);

  const inactiveRole = await login('inactive-role@example.test');
  assert.equal(inactiveRole.status, 403);
  assert.match((await inactiveRole.json()).error, /role is inactive/i);
});

test('incorrect or unknown credentials do not create a session', async () => {
  const wrongPassword = await login('active-admin@example.test', 'wrong-synthetic-password');
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), { error: 'Invalid email or password.' });
  assert.equal(wrongPassword.headers.has('set-cookie'), false);

  const missingUser = await login('missing@example.test');
  assert.equal(missingUser.status, 401);
  assert.deepEqual(await missingUser.json(), { error: 'Invalid email or password.' });
});

test('admin API rejects unauthenticated and non-admin platform sessions', async () => {
  const anonymousResponse = await fetch(`${baseUrl}/api/admin/dashboard/overview`);
  assert.equal(anonymousResponse.status, 401);

  assert.ok(customerSessionToken);
  const deniedResponse = await fetch(`${baseUrl}/api/admin/dashboard/overview`, {
    headers: { Cookie: `platform_session=${customerSessionToken}` },
  });
  const body = await deniedResponse.json();
  assert.equal(deniedResponse.status, 403, JSON.stringify(body));
  assert.deepEqual(body, { error: 'Access denied.' });
});
