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
  const roleIds = { customer: 3, organizer: 4, vendor: 5 };
  const roleNames = { 3: 'customer', 4: 'organizer', 5: 'vendor' };
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
    if (sql.includes('SELECT id FROM roles WHERE LOWER(name) = ?')) {
      return [[{ id: roleIds[values[0]] }], []];
    }
    if (sql.startsWith('INSERT INTO users')) {
      const [fullName, email, phone, passwordHash, preferredLanguage] = values;
      const id = nextUserId++;
      const user = { id, full_name: fullName, email, phone, password_hash: passwordHash, preferred_language: preferredLanguage, status: 'active' };
      usersByEmail.set(email, user);
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
      const assignment = user && roleAssignments.find((item) => item.userId === user.id);
      return [user ? [{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        preferred_language: user.preferred_language,
        status: user.status,
        role: roleNames[assignment?.roleId] || 'customer',
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
    body: JSON.stringify({
      phone: '0986481821',
      accountType: 'Customer',
      acceptedTerms: true,
      ...body,
    }),
  });
}

test('public registration creates and authenticates a persisted customer account', async () => {
  const response = await register({
    fullName: 'Hana Bekele',
    email: 'HANA@example.test',
    phone: '0986481821',
    password: 'StrongPass123!',
  }, { 'Accept-Language': 'am' });
  const body = await response.json();

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data.user.role, 'customer');
  assert.equal(body.data.user.email, 'hana@example.test');
  assert.equal(Object.hasOwn(body.data.user, 'username'), false);
  assert.equal(body.data.user.phone, '+251986481821');
  assert.equal(database.roleAssignments.at(-1).roleId, 3);
  assert.equal(database.audits.length, 1);
  const savedUser = database.usersByEmail.get('hana@example.test');
  assert.equal(savedUser.preferred_language, 'am');
  assert.equal(Object.hasOwn(savedUser, 'username'), false);
  assert.notEqual(savedUser.password_hash, 'StrongPass123!');
  assert.equal(await bcrypt.compare('StrongPass123!', savedUser.password_hash), true);

  const cookie = response.headers.get('set-cookie').split(';', 1)[0];
  assert.match(cookie, /^platform_session=/);
  const session = await fetch(`${baseUrl}/api/platform/me`, { headers: { Cookie: cookie } });
  const sessionBody = await session.json();
  assert.equal(session.status, 200);
  assert.equal(sessionBody.data.user.role, 'customer');
  assert.equal(sessionBody.data.user.id, savedUser.id);
});

test('public registration supports allowed account types and rejects duplicate email addresses', async () => {
  for (const [index, accountType] of ['Customer', 'Organizer', 'Vendor'].entries()) {
    const role = accountType.toLowerCase();
    const response = await register({
      fullName: 'Role Attempt',
      email: `${role}@example.test`,
      phone: `098648182${index}`,
      password: 'StrongPass123!',
      accountType,
    }, { 'X-Forwarded-For': `198.51.100.${index + 10}` });
    assert.equal(response.status, 201, `role=${role}`);
    assert.equal((await response.json()).data.user.role, role);
  }

  const adminRole = await register({
    fullName: 'Self Registered Admin',
    email: 'admin@example.test',
    password: 'StrongPass123!',
    accountType: 'Admin',
  }, { 'X-Forwarded-For': '198.51.100.19' });
  assert.equal(adminRole.status, 403);

  const duplicate = await register({
    fullName: 'Duplicate User',
    email: 'hana@example.test',
    phone: '0986481810',
    password: 'StrongPass123!',
  }, { 'X-Forwarded-For': '198.51.100.20' });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /email/i);
});

test('public registration rejects missing terms, weak passwords, and unaccepted fields', async () => {
  const base = {
    fullName: 'Invalid Registration',
    email: 'invalid@example.test',
    phone: '0986481821',
    accountType: 'Customer',
    password: 'NoNumber',
    acceptedTerms: true,
  };
  const cases = [
    { ...base, password: 'StrongPass123!', acceptedTerms: false },
    { ...base, password: 'NoNumber' },
    { ...base, password: 'StrongPass123!', unexpected_field: 'should_not_be_accepted' },
  ];
  for (const [index, body] of cases.entries()) {
    const response = await register(body, { 'X-Forwarded-For': `198.51.100.${30 + index}` });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});
