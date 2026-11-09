import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL admin user, role, and report-summary workflows enforce authorization', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const adminEmail = `pg-admin-${suffix}@example.invalid`;
  const adminRoleName = `integration-admin-${suffix}`;
  const testRoleName = `integration-role-${suffix}`;
  const adminToken = randomBytes(32).toString('hex');
  const userToken = randomBytes(32).toString('hex');
  let adminId;
  let userId;
  let adminRoleId;
  let testRoleId;
  let server;
  let originalDescription;

  try {
    const roleRows = await database.runtimeAdapter.query(
      `SELECT id, name FROM roles
       WHERE LOWER(name) IN ('organizer', 'vendor', 'customer')
       AND is_active = TRUE AND is_admin = FALSE`,
    );
    const roles = new Map(roleRows.rows.map((role) => [role.name.toLowerCase(), role]));
    assert.ok(roles.has('organizer'));
    assert.ok(roles.has('vendor'));
    assert.ok(roles.has('customer'));

    await database.inTransaction(async (client) => {
      const adminRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary admin integration role', TRUE, TRUE) RETURNING id`,
        [adminRoleName],
      );
      adminRoleId = adminRole.rows[0].id;
      const admin = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Postgres Admin Integration', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [adminEmail],
      );
      adminId = admin.rows[0].id;
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [adminId, adminRoleId]);
      await client.query(
        'INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
        [hashToken(adminToken), adminId],
      );
      const testRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary role CRUD fixture', FALSE, TRUE) RETURNING id`,
        [testRoleName],
      );
      testRoleId = testRole.rows[0].id;
    });

    const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
    const request = (path, { method = 'GET', body, token = adminToken } = {}) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: `${token === adminToken ? 'admin_session' : 'platform_session'}=${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const storedDescription = await database.runtimeAdapter.query(
      `SELECT setting_value, updated_by
       FROM system_settings
       WHERE setting_key = 'platform_description'`,
    );
    originalDescription = storedDescription.rows[0] || null;
    const settingsResponse = await request('/settings');
    assert.equal(settingsResponse.status, 200);
    const settingsBody = await settingsResponse.json();
    assert.equal(
      settingsBody.settings.platform_description,
      originalDescription?.setting_value ?? 'Event organizing and vendor booking platform.',
    );
    assert.ok(settingsBody.configuration);

    const temporaryDescription = `Neon settings integration ${suffix}`;
    const updatedSettingsResponse = await request('/settings', {
      method: 'PATCH',
      body: { platform_description: temporaryDescription },
    });
    assert.equal(updatedSettingsResponse.status, 200);
    assert.equal((await updatedSettingsResponse.json()).data.platform_description, temporaryDescription);
    const persistedSetting = await database.runtimeAdapter.query(
      `SELECT setting_value FROM system_settings
       WHERE setting_key = 'platform_description'`,
    );
    assert.equal(persistedSetting.rows[0].setting_value, temporaryDescription);
    const singleUpdateValue = `Neon single-setting integration ${suffix}`;
    const singleSettingResponse = await request('/settings/platform_description', {
      method: 'PUT',
      body: { value: singleUpdateValue },
    });
    assert.equal(singleSettingResponse.status, 200);
    assert.equal((await singleSettingResponse.json()).data.setting_value, singleUpdateValue);
    const persistedSingleSetting = await database.runtimeAdapter.query(
      `SELECT setting_value FROM system_settings
       WHERE setting_key = 'platform_description'`,
    );
    assert.equal(persistedSingleSetting.rows[0].setting_value, singleUpdateValue);

    const rolesResponse = await request(`/roles?q=${encodeURIComponent(testRoleName)}&pageSize=5`);
    assert.equal(rolesResponse.status, 200);
    const rolesBody = await rolesResponse.json();
    assert.equal(rolesBody.pagination.total, 1);
    assert.equal(String(rolesBody.data[0].id), String(testRoleId));
    assert.equal(rolesBody.data[0].is_assignable, false);

    const reportSummaryResponse = await request('/reports/summary');
    assert.equal(reportSummaryResponse.status, 200);
    const reportSummary = (await reportSummaryResponse.json()).data;
    assert.deepEqual(Object.keys(reportSummary).sort(), [
      'bookings', 'complaints', 'events', 'payments', 'users', 'vendors',
    ]);
    assert.equal(reportSummary.users.total_users >= 1, true);
    for (const section of Object.values(reportSummary)) {
      for (const value of Object.values(section)) assert.equal(Number.isInteger(value), true);
    }

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const overviewResponse = await request(`/dashboard/overview?startDate=${startDate}&endDate=${endDate}`);
    assert.equal(overviewResponse.status, 200);
    const overview = (await overviewResponse.json()).data;
    assert.deepEqual(overview.filters, { startDate, endDate });
    for (const key of [
      'users', 'userRoles', 'vendors', 'events', 'bookings', 'payments',
      'revenueByCurrency', 'complaints', 'reviews', 'recentBookings',
      'recentVendorRequests', 'recentComplaints', 'recentReviews',
      'bookingTrend', 'eventCategories', 'bookingStatuses', 'recentActivities',
    ]) assert.ok(Object.hasOwn(overview, key), `Missing dashboard field ${key}`);
    assert.ok(Array.isArray(overview.bookingTrend));

    const roleUsersResponse = await request(`/roles/${testRoleId}/users`);
    assert.equal(roleUsersResponse.status, 200);
    assert.equal((await roleUsersResponse.json()).pagination.total, 0);

    const matrixResponse = await request('/rbac/matrix');
    assert.equal(matrixResponse.status, 200);
    assert.ok((await matrixResponse.json()).data.roles.admin.includes('users.view'));

    const rolePermissionsResponse = await request(`/roles/${testRoleId}/permissions`);
    assert.equal(rolePermissionsResponse.status, 200);
    assert.deepEqual((await rolePermissionsResponse.json()).data.permission_keys, []);
    const forbiddenPermission = await request(`/roles/${testRoleId}/permissions`, {
      method: 'PATCH',
      body: { permission_keys: ['admin:*'] },
    });
    assert.equal(forbiddenPermission.status, 403);
    const permissionUpdate = await request(`/roles/${testRoleId}/permissions`, {
      method: 'PATCH',
      body: { permission_keys: [] },
    });
    assert.equal(permissionUpdate.status, 200);

    const organizerRole = roles.get('organizer');
    const createdResponse = await request('/users', {
      method: 'POST',
      body: {
        full_name: 'Postgres Admin Created User',
        email: `pg-user-${suffix}@example.invalid`,
        phone: `+1555${suffix.replaceAll('-', '').slice(0, 10)}`,
        password: 'StrongIntegrationPass123',
        role_id: organizerRole.id,
      },
    });
    assert.equal(createdResponse.status, 201);
    userId = (await createdResponse.json()).data.id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, testRoleId],
    );
    const disableAssignedRole = await request(`/roles/${testRoleId}/status`, {
      method: 'PATCH',
      body: { is_active: false },
    });
    assert.equal(disableAssignedRole.status, 409);
    await database.runtimeAdapter.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [userId, testRoleId],
    );
    const disabledRole = await request(`/roles/${testRoleId}/status`, {
      method: 'PATCH',
      body: { is_active: false },
    });
    assert.equal(disabledRole.status, 200);
    const enabledRole = await request(`/roles/${testRoleId}/status`, {
      method: 'PATCH',
      body: { is_active: true },
    });
    assert.equal(enabledRole.status, 200);

    const setUserSession = await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [hashToken(userToken), userId],
    );
    assert.equal(setUserSession.rowCount, 1);
    const nonAdminAccess = await request('/users', { token: userToken });
    assert.equal(nonAdminAccess.status, 403);
    const nonAdminReportAccess = await request('/reports/summary', { token: userToken });
    assert.equal(nonAdminReportAccess.status, 403);
    const nonAdminDashboardAccess = await request(
      `/dashboard/overview?startDate=${startDate}&endDate=${endDate}`,
      { token: userToken },
    );
    assert.equal(nonAdminDashboardAccess.status, 403);

    const listed = await request(`/users?q=${encodeURIComponent(`pg-user-${suffix}`)}&pageSize=5`);
    assert.equal(listed.status, 200);
    const listBody = await listed.json();
    assert.equal(listBody.pagination.total, 1);
    assert.equal(String(listBody.data[0].id), String(userId));
    assert.equal(listBody.data[0].roles, 'Organizer');

    const updated = await request(`/users/${userId}`, {
      method: 'PATCH',
      body: { full_name: 'Updated PostgreSQL User' },
    });
    assert.equal(updated.status, 200);
    const detail = await request(`/users/${userId}`);
    assert.equal((await detail.json()).data.full_name, 'Updated PostgreSQL User');

    const invalidRole = await request(`/users/${userId}/role`, {
      method: 'PATCH',
      body: { role_id: -1 },
    });
    assert.equal(invalidRole.status, 400);
    const roleChange = await request(`/users/${userId}/role`, {
      method: 'PATCH',
      body: { role_id: roles.get('vendor').id },
    });
    assert.equal(roleChange.status, 200);
    const roleChangeState = await database.runtimeAdapter.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.is_admin = FALSE`,
      [userId],
    );
    assert.deepEqual(roleChangeState.rows.map((role) => role.name.toLowerCase()), ['vendor']);
    const sessionsAfterRoleChange = await database.runtimeAdapter.query(
      'SELECT id FROM user_sessions WHERE user_id = $1',
      [userId],
    );
    assert.equal(sessionsAfterRoleChange.rowCount, 0);

    const suspend = await request(`/users/${userId}/status`, {
      method: 'PATCH',
      body: { status: 'suspended', reason: 'Integration test suspension' },
    });
    assert.equal(suspend.status, 200);
    const persisted = await database.runtimeAdapter.query(
      `SELECT u.status, COUNT(a.id)::int AS audit_count
       FROM users u LEFT JOIN audit_logs a ON a.entity_type = 'user' AND a.entity_id = u.id::text
       WHERE u.id = $1 GROUP BY u.id`,
      [userId],
    );
    assert.equal(persisted.rows[0].status, 'suspended');
    assert.ok(persisted.rows[0].audit_count >= 3);
  } finally {
    if (server?.listening) {
      server.close();
      await once(server, 'close');
    }
    if (adminId) {
      await database.inTransaction(async (client) => {
        if (originalDescription !== undefined) {
          if (originalDescription) {
            await client.query(
              `INSERT INTO system_settings (setting_key, setting_value, updated_by)
               VALUES ('platform_description', $1, $2)
               ON CONFLICT (setting_key) DO UPDATE
               SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
              [originalDescription.setting_value, originalDescription.updated_by],
            );
          } else {
            await client.query(
              `DELETE FROM system_settings WHERE setting_key = 'platform_description'`,
            );
          }
        }
        await client.query('DELETE FROM audit_logs WHERE actor_id = $1', [adminId]);
        await client.query('DELETE FROM vendor_profiles WHERE user_id = $1', [userId || -1]);
        if (userId && testRoleId) {
          await client.query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, testRoleId]);
        }
        if (userId) await client.query('DELETE FROM users WHERE id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [adminId]);
        if (testRoleId) await client.query('DELETE FROM roles WHERE id = $1', [testRoleId]);
        if (adminRoleId) await client.query('DELETE FROM roles WHERE id = $1', [adminRoleId]);
      });
    }
    await database.close();
  }
});
