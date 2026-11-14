import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/authFlow.js';

function createDatabase() {
  const users = new Map();
  const sessions = new Map();
  const passwordTokens = new Map();
  const roleAssignments = [];
  const audits = [];
  const roleNames = new Map([[2, 'customer'], [3, 'organizer'], [4, 'vendor'], [5, 'admin']]);
  let nextUserId = 1;
  let platformMaintenance = false;

  const database = {
    dialect: 'postgres',
    async query(sql, values = []) {
      if (sql.includes('FROM system_settings WHERE setting_key IN')) {
        return {
          rows: [
            { setting_key: 'platform_status', setting_value: platformMaintenance ? 'maintenance' : 'open' },
            { setting_key: 'maintenance_mode', setting_value: platformMaintenance },
            { setting_key: 'maintenance_message', setting_value: 'Back shortly.' },
          ].filter((row) => values.includes(row.setting_key)),
          rowCount: 3,
        };
      }
      if (sql.includes('FROM system_settings') && !sql.includes('WHERE')) {
        return {
          rows: [
            { setting_key: 'platform_status', setting_value: platformMaintenance ? 'maintenance' : 'open' },
            { setting_key: 'maintenance_mode', setting_value: platformMaintenance },
            { setting_key: 'maintenance_message', setting_value: 'Back shortly.' },
          ],
          rowCount: 3,
        };
      }
      if (sql.includes("setting_key = 'public_registration_enabled'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("setting_key = 'notify_admin_user_registrations'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT id FROM roles')) {
        const roleIds = { customer: 2, organizer: 3, vendor: 4 };
        return { rows: [{ id: roleIds[values[0]] || 2 }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO users')) {
        const [fullName, email, passwordHash, preferredLanguage] = values;
        if ([...users.values()].some((user) => user.email === email)) {
          throw Object.assign(new Error('duplicate user'), { code: '23505' });
        }
        const user = {
          id: nextUserId++,
          full_name: fullName,
          email,
          password_hash: passwordHash,
          preferred_language: preferredLanguage,
          status: 'active',
        };
        users.set(email, user);
        return { rows: [{ id: user.id }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO user_roles')) {
        roleAssignments.push({ userId: values[0], roleId: values[1] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO vendor_profiles')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO user_sessions')) {
        sessions.set(values[0], { userId: values[1], expiresAt: values[2] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        audits.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT prt.user_id, u.email, u.status')) {
        const token = passwordTokens.get(values[0]);
        const user = token && [...users.values()].find((candidate) => candidate.id === token.userId);
        return {
          rows: token && token.expiresAt > new Date() && !token.usedAt && user
            ? [{ user_id: user.id, email: user.email, status: user.status }]
            : [],
          rowCount: token && user ? 1 : 0,
        };
      }
      if (sql.startsWith("UPDATE users SET password_hash = $1, status = 'active'")) {
        const user = [...users.values()].find((candidate) => candidate.id === values[1]);
        if (user) {
          user.password_hash = values[0];
          user.status = 'active';
        }
        return { rows: [], rowCount: user ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE password_reset_tokens SET used_at')) {
        const token = [...passwordTokens.values()].find((candidate) => candidate.userId === values[0]);
        if (token) token.usedAt = new Date();
        return { rows: [], rowCount: token ? 1 : 0 };
      }
      if (sql.startsWith('SELECT DISTINCT u.id')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.password_hash')) {
        const user = users.get(values[0]);
        const assignment = user && roleAssignments.find((item) => item.userId === user.id);
        const role = roleNames.get(assignment?.roleId) || 'customer';
        return {
          rows: user
            ? [{
                ...user,
                role,
                is_admin: role === 'admin',
                role_is_active: true,
              }]
            : [],
          rowCount: user ? 1 : 0,
        };
      }
      if (sql.startsWith('UPDATE users SET last_login_at')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.phone')) {
        const session = sessions.get(values[0]);
        const user = [...users.values()].find((candidate) => candidate.id === session?.userId);
        const assignment = user && roleAssignments.find((item) => item.userId === user.id);
        const role = roleNames.get(assignment?.roleId) || 'customer';
        return {
          rows: user
            ? [{
                ...user,
                role,
                is_admin: role === 'admin',
                vendor_profile_id: null,
                business_name: null,
                category_name: null,
              }]
            : [],
          rowCount: user ? 1 : 0,
        };
      }
      if (sql.startsWith('DELETE FROM user_sessions')) {
        sessions.delete(values[0]);
        return { rows: [], rowCount: 1 };
      }
      database.unexpectedQuery = sql;
      throw new Error('Unexpected PostgreSQL test query.');
    },
    async inTransaction(work) {
      return work(database);
    },
    users,
    sessions,
    roleAssignments,
    audits,
    passwordTokens,
    setPlatformMaintenance(value) {
      platformMaintenance = value;
    },
  };
  return database;
}

const database = createDatabase();
const app = createApp({ database, databaseDialect: 'postgres' });
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

test('PostgreSQL application auth persists registration, login, and session operations', async () => {
  const email = `pg-auth-${Date.now()}@example.test`;
  const registerResponse = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'am', 'X-Forwarded-For': '198.51.100.11' },
    body: JSON.stringify({ name: 'Postgres Auth User', email, password: 'StrongPass123' }),
  });
  const registered = await registerResponse.json();
  assert.equal(registerResponse.status, 201, `${JSON.stringify(registered)} ${database.unexpectedQuery || ''}`);
  assert.equal(registered.data.user.role, 'customer');
  assert.equal(database.roleAssignments.at(-1).roleId, 2);
  assert.equal(database.audits.at(-1)[1], 'auth.register');
  assert.equal(await bcrypt.compare('StrongPass123', database.users.get(email).password_hash), true);
  assert.equal(registerResponse.headers.get('set-cookie'), null);
  assert.equal(database.sessions.size, 0);

  const incorrectPassword = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({ email, password: 'Incorrect123' }),
  });
  assert.equal(incorrectPassword.status, 401);
  assert.equal((await incorrectPassword.json()).error, 'Invalid email or password.');

  const organizerEmail = `organizer-${Date.now()}@example.test`;
  const organizerRegistration = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.13' },
    body: JSON.stringify({ name: 'Platform Organizer', email: organizerEmail, password: 'Pass1234', role: 'organizer' }),
  });
  assert.equal(organizerRegistration.status, 201);
  assert.equal((await organizerRegistration.json()).data.user.role, 'customer');
  assert.equal(database.roleAssignments.at(-1).roleId, 2);

  const vendorEmail = `vendor-${Date.now()}@example.test`;
  const vendorRegistration = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.14' },
    body: JSON.stringify({ name: 'Platform Vendor', email: vendorEmail, password: 'Pass1234', role: 'vendor' }),
  });
  assert.equal(vendorRegistration.status, 201);
  assert.equal((await vendorRegistration.json()).data.user.role, 'customer');
  assert.equal(database.roleAssignments.at(-1).roleId, 2);

  const adminRegistration = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.15' },
    body: JSON.stringify({ name: 'Self Registered Admin', email: `admin-${Date.now()}@example.test`, password: 'Pass1234', role: 'admin' }),
  });
  assert.equal(adminRegistration.status, 201);
  assert.equal((await adminRegistration.json()).data.user.role, 'customer');
  assert.equal(database.roleAssignments.at(-1).roleId, 2);

  const duplicateRegistration = await fetch(`${baseUrl}/api/platform/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.16' },
    body: JSON.stringify({ name: 'Duplicate User', email, password: 'StrongPass123', role: 'vendor' }),
  });
  assert.equal(duplicateRegistration.status, 409);
  assert.match((await duplicateRegistration.json()).error, /account with this email/i);

  const loginResponse = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'StrongPass123' }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie').split(';', 1)[0];
  const meResponse = await fetch(`${baseUrl}/api/platform/me`, { headers: { Cookie: cookie } });
  const me = await meResponse.json();
  assert.equal(me.data.user.id, registered.data.user.id);
  assert.equal(me.data.user.preferred_language, 'am');

  const logoutResponse = await fetch(`${baseUrl}/api/platform/logout`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(logoutResponse.status, 204);
  const sessionCookieValue = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  assert.equal(database.sessions.has(hashToken(sessionCookieValue)), false);
  database.users.get(email).status = 'inactive';
  const inactiveLogin = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'StrongPass123' }),
  });
  assert.equal(inactiveLogin.status, 403);
  assert.equal((await inactiveLogin.json()).error, 'This account is inactive. Contact support for assistance.');
});

test('PostgreSQL login identifies an unknown email with a sign-up message', async () => {
  const unknown = await fetch(`${baseUrl}/api/platform/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `unknown-${Date.now()}@example.test`, password: 'Pass1234' }),
  });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, 'No account found. Please create an account first.');
});

test('invitation password tokens are hashed, expire, and can be used only once', async () => {
  const token = 'unit-test-invitation-token-which-is-long-enough';
  const invitedEmail = `invited-${Date.now()}@example.test`;
  const invitedUser = {
    id: 900,
    full_name: 'Invited Customer',
    email: invitedEmail,
    password_hash: 'unusable-random-hash',
    status: 'pending',
  };
  database.users.set(invitedEmail, invitedUser);
  database.passwordTokens.set(hashToken(token), {
    userId: invitedUser.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
  });
  assert.equal(database.passwordTokens.has(token), false);

  const accepted = await fetch(`${baseUrl}/api/platform/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'InvitedPassword123' }),
  });
  assert.equal(accepted.status, 200);
  assert.equal(invitedUser.status, 'active');
  assert.equal(await bcrypt.compare('InvitedPassword123', invitedUser.password_hash), true);
  assert.ok(database.passwordTokens.get(hashToken(token)).usedAt);

  const replay = await fetch(`${baseUrl}/api/platform/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'AnotherPassword123' }),
  });
  assert.equal(replay.status, 400);

  const expiredToken = 'expired-invitation-token-which-is-long-enough';
  const expiredUser = {
    id: 901,
    full_name: 'Expired Invite',
    email: `expired-${Date.now()}@example.test`,
    password_hash: 'unusable-random-hash',
    status: 'pending',
  };
  database.users.set(expiredUser.email, expiredUser);
  database.passwordTokens.set(hashToken(expiredToken), {
    userId: expiredUser.id,
    expiresAt: new Date(Date.now() - 1000),
    usedAt: null,
  });
  const expired = await fetch(`${baseUrl}/api/platform/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: expiredToken, password: 'ExpiredPassword123' }),
  });
  assert.equal(expired.status, 400);
  assert.equal(expiredUser.status, 'pending');
});

test('PostgreSQL platform maintenance blocks auth operations but keeps availability and logout reachable', async () => {
  database.setPlatformMaintenance(true);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const registration = await fetch(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Maintenance Test',
        email: `maintenance-${Date.now()}@example.test`,
        password: 'StrongPass123',
      }),
    });
    assert.equal(registration.status, 503);
    assert.equal((await registration.json()).message, 'Back shortly.');

    const availability = await fetch(`${baseUrl}/api/platform/availability`);
    assert.equal(availability.status, 200);
    assert.equal((await availability.json()).data.maintenanceMode, true);

    const logout = await fetch(`${baseUrl}/api/platform/logout`, { method: 'POST' });
    assert.equal(logout.status, 204);
  } finally {
    database.setPlatformMaintenance(false);
  }
});
