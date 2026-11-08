import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/authFlow.js';

function createDatabase() {
  const users = new Map();
  const sessions = new Map();
  const roleAssignments = [];
  const audits = [];
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
        return { rows: [{ id: 2 }], rowCount: 1 };
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
      if (sql.startsWith('INSERT INTO user_sessions')) {
        sessions.set(values[0], { userId: values[1], expiresAt: values[2] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        audits.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT DISTINCT u.id')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.password_hash')) {
        const user = users.get(values[0]);
        return {
          rows: user
            ? [{
                ...user,
                role: 'customer',
                is_admin: false,
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
        return {
          rows: user
            ? [{
                ...user,
                role: 'customer',
                is_admin: false,
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
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'am' },
    body: JSON.stringify({ name: 'Postgres Auth User', email, password: 'StrongPass123' }),
  });
  const registered = await registerResponse.json();
  assert.equal(registerResponse.status, 201, `${JSON.stringify(registered)} ${database.unexpectedQuery || ''}`);
  assert.equal(registered.data.user.role, 'customer');
  assert.equal(database.roleAssignments.at(-1).roleId, 2);
  assert.equal(database.audits.at(-1)[1], 'auth.register');
  assert.equal(await bcrypt.compare('StrongPass123', database.users.get(email).password_hash), true);

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
