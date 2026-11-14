import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createPostgresAdminRouter } from '../src/routes/postgresAdmin.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'test-administrator-session-token';
const adminId = 1;
const roles = new Map([
  [1, { id: 1, name: 'Administrator' }],
  [2, { id: 2, name: 'Customer' }],
  [3, { id: 3, name: 'Organizer' }],
  [4, { id: 4, name: 'Vendor' }],
]);

function createDatabase() {
  const users = new Map([[adminId, {
    id: adminId,
    full_name: 'Administrator',
    email: 'admin@example.test',
    status: 'active',
    created_at: new Date(),
    roles: 'Administrator',
  }]]);
  const assignments = new Map([[adminId, 1]]);
  const tokens = new Map();
  const audits = [];
  let nextId = 2;

  async function query(sql, values = []) {
    if (sql.includes('admin_sessions') && sql.includes('STRING_AGG(DISTINCT r.name')) {
      return values.includes(hashToken(adminToken))
        ? { rows: [{ ...users.get(adminId), phone: null, preferred_language: 'en' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, name FROM roles WHERE id = $1')) {
      const role = roles.get(values[0]);
      return { rows: role ? [role] : [], rowCount: role ? 1 : 0 };
    }
    if (sql.startsWith('SELECT id FROM service_categories')) {
      return values[0] === 7 ? { rows: [{ id: 7 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
      const user = [...users.values()].find((candidate) => candidate.email.toLowerCase() === String(values[0]).toLowerCase());
      return { rows: user ? [{ id: user.id }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.startsWith('SELECT id FROM users WHERE phone')) {
      const user = [...users.values()].find((candidate) => candidate.phone === values[0]);
      return { rows: user ? [{ id: user.id }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO users')) {
      const id = nextId++;
      users.set(id, {
        id,
        full_name: values[0],
        email: values[1],
        phone: values[2],
        password_hash: values[3],
        status: 'pending',
        created_at: new Date(),
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO user_roles')) {
      assignments.set(values[0], values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO vendor_profiles')) {
      users.get(values[0]).vendorProfile = { business_name: values[1], category_id: values[2] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO password_reset_tokens')) {
      tokens.set(values[0], { token_hash: values[1], expires_at: values[2], used_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audits.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.status')) {
      const user = users.get(values[0]);
      return {
        rows: user ? [{ id: user.id, full_name: user.full_name, email: user.email, status: user.status }] : [],
        rowCount: user ? 1 : 0,
      };
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM users')) {
      const matching = [...users.values()].filter((user) => !values.length || user.status === values[0]);
      return { rows: [{ total: matching.length }], rowCount: 1 };
    }
    if (sql.includes('STRING_AGG(DISTINCT r.name') && sql.includes('FROM users u')) {
      const selected = [...users.values()].filter((user) => !values.includes('pending') || user.status === 'pending');
      return {
        rows: selected.map((user) => ({
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          created_at: user.created_at,
          roles: roles.get(assignments.get(user.id))?.name || 'Administrator',
          role_id: assignments.get(user.id),
          bookings_count: 0,
        })),
        rowCount: selected.length,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    users,
    assignments,
    tokens,
    audits,
    query,
    inTransaction: (work) => work({ query }),
  };
}

test('PostgreSQL admin user invitations are authorized, hashed, role-limited, and resendable', async (context) => {
  const database = createDatabase();
  const invitations = [];
  let configured = true;
  let failDelivery = false;
  const app = express();
  app.set('trust proxy', 1);
  app.locals.database = database;
  app.locals.databaseDialect = 'postgres';
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/admin', createPostgresAdminRouter({
    database,
    emailConfigured: () => configured,
    emailSender: async (message) => {
      if (failDelivery) throw new Error('test delivery failure');
      invitations.push(message);
    },
    frontendUrl: 'https://eventhub.example.test',
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  const request = (path, { method = 'GET', body, token = adminToken } = {}) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Cookie: `${token === adminToken ? 'admin_session' : 'platform_session'}=${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  assert.equal((await request('/users', { token: null })).status, 401);

  const organizerResponse = await request('/users', {
    method: 'POST',
    body: { full_name: 'Invited Organizer', email: 'organizer@example.test', role_id: 3 },
  });
  assert.equal(organizerResponse.status, 201);
  const organizerId = (await organizerResponse.json()).data.id;
  const organizer = database.users.get(organizerId);
  assert.equal(organizer.status, 'pending');
  assert.equal(database.assignments.get(organizerId), 3);
  assert.equal(typeof organizer.password_hash, 'string');
  assert.notEqual(organizer.password_hash, 'organizer@example.test');
  assert.equal(invitations.length, 1);
  const rawToken = new URL(invitations[0].setupUrl).searchParams.get('token');
  assert.equal(database.tokens.get(organizerId).token_hash, hashToken(rawToken));
  assert.notEqual(database.tokens.get(organizerId).token_hash, rawToken);
  assert.ok(database.tokens.get(organizerId).expires_at > new Date());
  assert.equal(JSON.stringify(database.tokens).includes(rawToken), false);

  const vendorResponse = await request('/users', {
    method: 'POST',
    body: {
      full_name: 'Invited Vendor',
      email: 'vendor@example.test',
      role_id: 4,
      business_name: 'Test Venue',
      category_id: 7,
    },
  });
  assert.equal(vendorResponse.status, 201);
  const vendorId = (await vendorResponse.json()).data.id;
  assert.deepEqual(database.users.get(vendorId).vendorProfile, {
    business_name: 'Test Venue',
    category_id: 7,
  });

  const customerResponse = await request('/users', {
    method: 'POST',
    body: { full_name: 'Invited Customer', email: 'customer@example.test', role_id: 2 },
  });
  assert.equal(customerResponse.status, 201);

  const adminRole = await request('/users', {
    method: 'POST',
    body: { full_name: 'Blocked Admin', email: 'blocked-admin@example.test', role_id: 1 },
  });
  assert.equal(adminRole.status, 400);
  const passwordInput = await request('/users', {
    method: 'POST',
    body: {
      full_name: 'Rejected Password',
      email: 'rejected@example.test',
      role_id: 3,
      password: 'NeverAcceptThis123',
    },
  });
  assert.equal(passwordInput.status, 400);
  assert.equal([...database.users.values()].some((user) => user.email === 'blocked-admin@example.test'), false);

  failDelivery = true;
  const deliveryFailure = await request('/users', {
    method: 'POST',
    body: { full_name: 'Retry Invite', email: 'retry@example.test', role_id: 3 },
  });
  assert.equal(deliveryFailure.status, 503);
  const failedInviteId = (await deliveryFailure.json()).data.id;
  assert.equal(database.users.get(failedInviteId).status, 'pending');
  failDelivery = false;

  const resent = await request(`/users/${failedInviteId}/resend-invite`, { method: 'POST' });
  assert.equal(resent.status, 200);
  assert.equal(database.tokens.has(failedInviteId), true);

  const pendingList = await request('/users?status=pending');
  assert.equal(pendingList.status, 200);
  const pendingBody = await pendingList.json();
  assert.ok(pendingBody.data.some((user) => user.id === failedInviteId && user.status === 'pending' && user.created_at));
  assert.ok(database.audits.some((entry) => entry[1] === 'user.invitation_created'));
  assert.ok(database.audits.some((entry) => entry[1] === 'user.invitation_resent'));
});
