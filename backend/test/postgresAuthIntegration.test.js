import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';
const password = 'NeonAuthPass123';

function createServer(database) {
  const server = createApp({ database, databaseDialect: 'postgres' }).listen(0, '127.0.0.1');
  return {
    server,
    async start() {
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

function cookiePair(response, name) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.startsWith(`${name}=`));
  return cookie.split(';', 1)[0];
}

test('Neon PostgreSQL authentication registration, sessions, vendor login, and rollback', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const shortSuffix = suffix.replace(/-/g, '').slice(0, 12);
  const phoneSuffix = suffix.replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
  const customerEmail = `pg-auth-${suffix}@example.invalid`;
  const rollbackEmail = `pg-auth-rollback-${suffix}@example.invalid`;
  const vendorEmail = `pg-auth-vendor-${suffix}@example.invalid`;
  const organizerSignupEmail = `pg-auth-organizer-signup-${suffix}@example.invalid`;
  const vendorSignupEmail = `pg-auth-vendor-signup-${suffix}@example.invalid`;
  const invalidRoleEmail = `pg-auth-invalid-${suffix}@example.invalid`;
  const adminEmail = `pg-auth-admin-${suffix}@example.invalid`;
  const adminToken = randomBytes(32).toString('hex');
  const fixtureEmails = [
    customerEmail, rollbackEmail, vendorEmail, organizerSignupEmail, vendorSignupEmail, invalidRoleEmail, adminEmail,
  ];
  const servers = [];
  let injectedRoleLinkErrorCode;
  let fixtureUserIds = [];

  async function cleanupFixtures(emails = fixtureEmails) {
    await database.runtimeAdapter.inTransaction(async (tx) => {
      const users = await tx.query('SELECT id FROM users WHERE email = ANY($1::varchar[])', [emails]);
      fixtureUserIds = users.rows.map((row) => row.id);
      if (!fixtureUserIds.length) return;

      const notificationPatterns = fixtureUserIds.map((id) => `user-registration:${id}:%`);
      const notificationRows = notificationPatterns.length
        ? await tx.query(
          'SELECT id FROM notifications WHERE idempotency_key LIKE ANY($1::varchar[])',
          [notificationPatterns],
        )
        : { rows: [] };
      const notificationIds = notificationRows.rows.map((row) => row.id);
      if (notificationIds.length) {
        await tx.query(
          'DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])',
          [notificationIds],
        );
        await tx.query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
      }

      await tx.query(
        'DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])',
        [fixtureUserIds],
      );
      await tx.query('DELETE FROM vendor_profiles WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
      await tx.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [fixtureUserIds]);
    });
  }

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.match(identity.server_version, /^PostgreSQL 18\b/);
    assert.equal(identity.database_name, 'eventhub');

    const staleFixtures = await database.runtimeAdapter.query(
      `SELECT email FROM users WHERE email LIKE 'pg-auth-%@example.invalid'`,
    );
    await cleanupFixtures(staleFixtures.rows.map((row) => row.email));

    const roles = await database.runtimeAdapter.query(
      `SELECT LOWER(name) AS name, id FROM roles
       WHERE is_active = TRUE AND (
         (LOWER(name) IN ('customer', 'organizer', 'vendor') AND is_admin = FALSE)
         OR is_admin = TRUE
       )`,
    );
    const roleIds = new Map(roles.rows.map((row) => [row.name, row.id]));
    assert.ok(roleIds.has('customer'));
    assert.ok(roleIds.has('organizer'));
    assert.ok(roleIds.has('vendor'));
    const adminRole = roles.rows.find((row) => {
      const role = row.name.toLowerCase();
      return role === 'admin' || role === 'administrator';
    });
    assert.ok(adminRole);

    const adminPasswordHash = await bcrypt.hash(password, 4);
    const admin = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      ['Neon Registration Notification Admin', adminEmail, adminPasswordHash],
    );
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [admin.rows[0].id, adminRole.id],
    );

    const vendor = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      ['Neon Vendor Auth Fixture', vendorEmail, 'integration-only-not-a-login-hash'],
    );
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [vendor.rows[0].id, roleIds.get('vendor')],
    );

    const databaseAdapter = database.runtimeAdapter;
    const rollbackAdapter = {
      dialect: 'postgres',
      query: (...args) => databaseAdapter.query(...args),
      inTransaction(work) {
        return databaseAdapter.inTransaction((tx) => work({
          async query(sql, values) {
            if (sql.startsWith('INSERT INTO user_roles')) {
              try {
                return await tx.query(sql, [values?.[0], '9223372036854775807']);
              } catch (error) {
                injectedRoleLinkErrorCode = error.code;
                throw error;
              }
            }
            return tx.query(sql, values);
          },
        }));
      },
    };
    const rollbackApp = createServer(rollbackAdapter);
    const rollbackBaseUrl = await rollbackApp.start();
    servers.push(rollbackApp);
    const rollbackResponse = await fetch(`${rollbackBaseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Rollback Fixture',
        email: rollbackEmail,
        phone: `+1555${phoneSuffix}`,
        password,
        accountType: 'Customer',
        acceptedTerms: true,
      }),
    });
    assert.equal(rollbackResponse.status, 500);
    assert.equal(injectedRoleLinkErrorCode, '23503');
    const rolledBackUser = await database.runtimeAdapter.query(
      'SELECT id FROM users WHERE email = $1',
      [rollbackEmail],
    );
    assert.equal(rolledBackUser.rowCount, 0);

    const application = createServer(database.runtimeAdapter);
    const baseUrl = await application.start();
    servers.push(application);

    const availability = await fetch(`${baseUrl}/api/platform/availability`);
    assert.equal(availability.status, 200);
    assert.equal(typeof (await availability.json()).data.maintenanceMode, 'boolean');

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookiePair(adminLogin, 'admin_session');
    const adminSessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    const adminSession = (await adminSessionResponse.json()).user;
    assert.equal(adminSessionResponse.status, 200);
    assert.equal(String(adminSession.id), String(admin.rows[0].id));
    assert.equal(adminSession.role, 'admin');
    assert.equal(adminSession.status, 'active');
    assert.ok(adminSession.roles.some((role) => role.toLowerCase() === 'admin'));

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dashboardQuery = new URLSearchParams({ range: 'custom', from: startDate, to: endDate });
    const adminDashboard = await fetch(`${baseUrl}/api/admin/dashboard/overview?${dashboardQuery}`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminDashboard.status, 200);
    const dashboardBody = (await adminDashboard.json()).data;
    assert.deepEqual(dashboardBody.period, { from: startDate, to: endDate });
    assert.ok(Array.isArray(dashboardBody.recentActivity));

    const adminLoginLogout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminLoginLogout.status, 204);
    const revokedAdminSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(revokedAdminSession.status, 401);

    const invalidRole = await fetch(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.21' },
      body: JSON.stringify({
        fullName: 'Invalid Role Fixture',
        email: invalidRoleEmail,
        phone: `+1666${phoneSuffix}`,
        password,
        accountType: 'Admin',
        acceptedTerms: true,
      }),
    });
    assert.equal(invalidRole.status, 403);

    const registration = await fetch(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'am',
        'X-Forwarded-For': '198.51.100.22',
      },
      body: JSON.stringify({
        fullName: 'Neon Customer Fixture',
        email: customerEmail.toUpperCase(),
        phone: `+1777${phoneSuffix}`,
        password,
        accountType: 'Customer',
        acceptedTerms: true,
      }),
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    const userId = registered.data.user.id;
    fixtureUserIds.push(userId);
    assert.equal(registered.data.user.email, customerEmail);
    assert.equal(registered.data.user.role, 'customer');
    assert.equal(registered.data.user.preferred_language, 'am');
    const registrationNotification = await database.runtimeAdapter.query(
      `SELECT n.id, COUNT(h.id)::integer AS history_count
       FROM notifications n LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.idempotency_key = $1 AND n.user_id = $2
       GROUP BY n.id`,
      [`user-registration:${userId}:${admin.rows[0].id}`, admin.rows[0].id],
    );
    assert.equal(registrationNotification.rowCount, 1);
    assert.equal(registrationNotification.rows[0].history_count, 1);

    const duplicate = await fetch(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.23' },
      body: JSON.stringify({
        fullName: 'Duplicate Fixture',
        email: customerEmail,
        phone: `+1888${phoneSuffix}`,
        password,
        accountType: 'Customer',
        acceptedTerms: true,
      }),
    });
    assert.equal(duplicate.status, 409);

    for (const [index, [email, role]] of [
      [organizerSignupEmail, 'organizer'],
      [vendorSignupEmail, 'vendor'],
    ].entries()) {
      const roleRegistration = await fetch(`${baseUrl}/api/platform/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${24 + index}`,
        },
        body: JSON.stringify({
          fullName: `Neon ${role} signup`,
          email,
          phone: `+1999${phoneSuffix.slice(0, 6)}${index}`,
          password,
          accountType: role === 'organizer' ? 'Organizer' : 'Vendor',
          acceptedTerms: true,
        }),
      });
      assert.equal(roleRegistration.status, 201);
      assert.equal((await roleRegistration.json()).data.user.role, role);
    }

    const invalidLogin = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: 'WrongPassword123' }),
    });
    assert.equal(invalidLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password }),
    });
    assert.equal(login.status, 200);
    const platformCookie = cookiePair(login, 'platform_session');
    const sessionToken = decodeURIComponent(platformCookie.slice('platform_session='.length));
    const session = await database.runtimeAdapter.query(
      'SELECT user_id FROM user_sessions WHERE token_hash = $1',
      [hashToken(sessionToken)],
    );
    assert.equal(String(session.rows[0].user_id), String(userId));

    const currentUser = await fetch(`${baseUrl}/api/platform/me`, {
      headers: { Cookie: platformCookie },
    });
    assert.equal((await currentUser.json()).data.user.id, userId);

    const customerAdminDashboard = await fetch(`${baseUrl}/api/admin/dashboard/overview`, {
      headers: { Cookie: platformCookie },
    });
    assert.equal(customerAdminDashboard.status, 403);

    const redirect = await fetch(`${baseUrl}/api/platform/redirect`, {
      headers: { Cookie: platformCookie },
    });
    assert.deepEqual(await redirect.json(), { redirect: '/customer/dashboard' });

    const customerProfile = await fetch(`${baseUrl}/api/customer/profile`, {
      headers: { Cookie: platformCookie },
    });
    assert.equal((await customerProfile.json()).data.fullName, 'Neon Customer Fixture');
    const profileUpdate = await fetch(`${baseUrl}/api/customer/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ fullName: 'Neon Customer Updated', phone: '+251900000000' }),
    });
    assert.equal(profileUpdate.status, 200);
    const updatedProfile = (await profileUpdate.json()).data;
    assert.equal(updatedProfile.fullName, 'Neon Customer Updated');
    assert.equal(updatedProfile.phone, '+251900000000');
    const invalidPhoneUpdate = await fetch(`${baseUrl}/api/customer/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ fullName: 'Neon Customer Updated', phone: 'not a phone number' }),
    });
    assert.equal(invalidPhoneUpdate.status, 400);
    const invalidProfileUpdate = await fetch(`${baseUrl}/api/customer/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ fullName: 'x', unexpected: true }),
    });
    assert.equal(invalidProfileUpdate.status, 400);

    const draftEventResponse = await fetch(`${baseUrl}/api/platform/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({
        title: `Neon deletable event ${shortSuffix}`,
        type: 'Integration test',
        startDate: '2099-01-10T10:00',
      }),
    });
    assert.equal(draftEventResponse.status, 201);
    const draftEvent = (await draftEventResponse.json()).data;
    const updatedEvent = await fetch(`${baseUrl}/api/platform/events/${draftEvent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ title: `Updated Neon event ${shortSuffix}` }),
    });
    assert.equal(updatedEvent.status, 200);
    assert.equal((await updatedEvent.json()).data.title, `Updated Neon event ${shortSuffix}`);
    const publishedEvent = await fetch(`${baseUrl}/api/platform/events/${draftEvent.id}/publish`, {
      method: 'PATCH',
      headers: { Cookie: platformCookie },
    });
    assert.equal(publishedEvent.status, 200);
    const activeEventDelete = await fetch(`${baseUrl}/api/platform/events/${draftEvent.id}`, {
      method: 'DELETE',
      headers: { Cookie: platformCookie },
    });
    assert.equal(activeEventDelete.status, 409);
    const cancelledEvent = await fetch(`${baseUrl}/api/platform/events/${draftEvent.id}/cancel`, {
      method: 'PATCH',
      headers: { Cookie: platformCookie },
    });
    assert.equal(cancelledEvent.status, 200);
    await database.runtimeAdapter.query(
      "UPDATE events SET status = 'draft' WHERE id = $1 AND organizer_id = $2",
      [draftEvent.id, userId],
    );
    const deletedDraftEvent = await fetch(`${baseUrl}/api/platform/events/${draftEvent.id}`, {
      method: 'DELETE',
      headers: { Cookie: platformCookie },
    });
    assert.equal(deletedDraftEvent.status, 204);
    const deletedEventRecord = await database.runtimeAdapter.query(
      'SELECT id FROM events WHERE id = $1',
      [draftEvent.id],
    );
    assert.equal(deletedEventRecord.rowCount, 0);

    const secondarySessionToken = randomBytes(32).toString('hex');
    await database.runtimeAdapter.query(
      'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
      [hashToken(secondarySessionToken), userId],
    );
    const incorrectCurrentPassword = await fetch(`${baseUrl}/api/customer/profile/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ currentPassword: 'WrongCurrentPass123', newPassword: 'WrongPass456A' }),
    });
    assert.equal(incorrectCurrentPassword.status, 400);
    const passwordChange = await fetch(`${baseUrl}/api/customer/profile/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: platformCookie },
      body: JSON.stringify({ currentPassword: password, newPassword: 'NeonPass456A' }),
    });
    assert.equal(passwordChange.status, 200);
    const survivingSession = await database.runtimeAdapter.query(
      'SELECT id FROM user_sessions WHERE token_hash = $1',
      [hashToken(sessionToken)],
    );
    const invalidatedSession = await database.runtimeAdapter.query(
      'SELECT id FROM user_sessions WHERE token_hash = $1',
      [hashToken(secondarySessionToken)],
    );
    assert.equal(survivingSession.rowCount, 1);
    assert.equal(invalidatedSession.rowCount, 0);

    const logout = await fetch(`${baseUrl}/api/platform/logout`, {
      method: 'POST',
      headers: { Cookie: platformCookie },
    });
    assert.equal(logout.status, 204);
    const deletedSession = await database.runtimeAdapter.query(
      'SELECT id FROM user_sessions WHERE token_hash = $1',
      [hashToken(sessionToken)],
    );
    assert.equal(deletedSession.rowCount, 0);

    const previousPasswordLogin = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password }),
    });
    assert.equal(previousPasswordLogin.status, 401);
    const changedPasswordLogin = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: 'NeonPass456A' }),
    });
    assert.equal(changedPasswordLogin.status, 200);

    const vendorLogin = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: vendorEmail, password: 'integration-only-not-a-login-hash' }),
    });
    assert.equal(vendorLogin.status, 401);

    const vendorPasswordHash = await (await import('bcryptjs')).default.hash(password, 4);
    await database.runtimeAdapter.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [vendorPasswordHash, vendor.rows[0].id],
    );
    const validVendorLogin = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: vendorEmail, password }),
    });
    assert.equal(validVendorLogin.status, 200);
    const vendorProfile = await database.runtimeAdapter.query(
      'SELECT user_id, business_name FROM vendor_profiles WHERE user_id = $1',
      [vendor.rows[0].id],
    );
    assert.equal(String(vendorProfile.rows[0].user_id), String(vendor.rows[0].id));
    assert.equal(vendorProfile.rows[0].business_name, 'Neon Vendor Auth Fixture');

    const vendorLoginAgain = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: vendorEmail, password }),
    });
    assert.equal(vendorLoginAgain.status, 200);
    const vendorCookie = cookiePair(vendorLoginAgain, 'platform_session');
    const vendorMe = await fetch(`${baseUrl}/api/platform/me`, {
      headers: { Cookie: vendorCookie },
    });
    assert.equal((await vendorMe.json()).data.user.role, 'vendor');
    const vendorProfileCount = await database.runtimeAdapter.query(
      'SELECT COUNT(*)::integer AS count FROM vendor_profiles WHERE user_id = $1',
      [vendor.rows[0].id],
    );
    assert.equal(vendorProfileCount.rows[0].count, 1);

    const adminMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `admin_session=${adminToken}` },
    });
    assert.equal(adminMe.status, 401);
    assert.deepEqual(await adminMe.json(), { error: 'Authentication required.' });
    const adminLogout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `admin_session=${adminToken}` },
    });
    assert.equal(adminLogout.status, 204);

    const auditRows = await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE actor_id = $1 AND action IN ('auth.register', 'auth.login')
       ORDER BY action`,
      [userId],
    );
    assert.deepEqual(auditRows.rows.map((row) => row.action).sort(), ['auth.login', 'auth.login', 'auth.register']);
  } finally {
    for (const application of servers.reverse()) await application.close();
    try {
      await cleanupFixtures();
    } finally {
      await database.close();
    }
  }
});
