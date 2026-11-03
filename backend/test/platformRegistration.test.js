import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

function createDatabase() {
  const usersByEmail = new Map();
  const sessionsByHash = new Map();
  const roleAssignments = [];
  const audits = [];
  let nextUserId = 10;

  async function execute(sql, values = []) {
    if (sql.includes('FROM system_settings')) {
      const settings = values.flatMap((key) => {
        if (key === 'public_registration_enabled') {
          return [{ setting_key: key, setting_value: 'true' }];
        }
        if (key === 'notify_admin_user_registrations') {
          return [{ setting_key: key, setting_value: 'false' }];
        }
        return [];
      });
      return [settings, []];
    }
    if (sql.includes('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')) {
      const user = usersByEmail.get(String(values[0]).toLowerCase());
      return [user ? [{ id: user.id }] : [], []];
    }
    if (sql.includes("SELECT id FROM roles WHERE LOWER(name) = 'customer'")) {
      return [[{ id: 3 }], []];
    }
    if (sql.startsWith('INSERT INTO users')) {
      const [fullName, email, phone, passwordHash, preferredLanguage] = values;
      const id = nextUserId++;
      usersByEmail.set(email, { id, full_name: fullName, email, phone, password_hash: passwordHash, preferred_language: preferredLanguage, status: 'active' });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO user_roles')) {
      roleAssignments.push({ userId: values[0], roleId: values[1] });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO user_sessions')) {
      sessionsByHash.set(values[0], values[1]);
      return [{ insertId: 1, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audits.push(values);
      return [{ insertId: audits.length, affectedRows: 1 }, []];
    }
    if (sql.includes('FROM user_sessions s')) {
      const userId = sessionsByHash.get(values[0]);
      const user = [...usersByEmail.values()].find((candidate) => candidate.id === userId);
      return [user ? [{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        preferred_language: user.preferred_language,
        status: user.status,
        role: 'customer',
        permission_keys: '',
      }] : [], []];
    }
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }

  return {
    usersByEmail,
    roleAssignments,
    audits,
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

function register(body, headers = {}) {
  return fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('public registration creates and authenticates a persisted customer account', async () => {
  const response = await register({
    name: 'Hana Bekele',
    email: 'HANA@example.test',
    password: 'StrongPass123',
  }, { 'Accept-Language': 'am' });
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.user.role, 'customer');
  assert.equal(body.data.user.email, 'hana@example.test');
  assert.equal(database.roleAssignments.at(-1).roleId, 3);
  assert.equal(database.audits.length, 1);
  const savedUser = database.usersByEmail.get('hana@example.test');
  assert.equal(savedUser.preferred_language, 'am');
  assert.notEqual(savedUser.password_hash, 'StrongPass123');
  assert.equal(await bcrypt.compare('StrongPass123', savedUser.password_hash), true);

  const cookie = response.headers.get('set-cookie').split(';', 1)[0];
  assert.match(cookie, /^platform_session=/);
  const session = await fetch(`${baseUrl}/api/platform/me`, { headers: { Cookie: cookie } });
  const sessionBody = await session.json();
  assert.equal(session.status, 200);
  assert.equal(sessionBody.data.user.role, 'customer');
  assert.equal(sessionBody.data.user.id, savedUser.id);
});

test('public registration rejects all client-supplied roles and duplicate emails', async () => {
  for (const [index, role] of ['customer', 'organizer', 'vendor', 'admin'].entries()) {
    const response = await register({
      name: 'Role Attempt',
      email: `${role}@example.test`,
      password: 'StrongPass123',
      role,
    }, { 'X-Forwarded-For': `198.51.100.${index + 10}` });
    assert.equal(response.status, 403, `role=${role}`);
    assert.deepEqual(await response.json(), { error: 'Public registration is limited to customer accounts.' });
  }

  const duplicate = await register({
    name: 'Duplicate User',
    email: 'hana@example.test',
    password: 'StrongPass123',
  }, { 'X-Forwarded-For': '198.51.100.20' });
  assert.equal(duplicate.status, 409);
});
