import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { getRolePermissionPolicy } from '../src/lib/rbac.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL admin user, role, and report-summary workflows enforce authorization', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async (context) => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  let phaseStartedAt = Date.now();
  const profilePhase = (name) => {
    console.info(`NEON_ADMIN_TEST_PHASE ${name}=${Date.now() - phaseStartedAt}ms`);
    phaseStartedAt = Date.now();
  };
  const suffix = randomUUID();
  const adminEmail = `pg-admin-${suffix}@example.invalid`;
  const adminRoleName = `integration-admin-${suffix}`;
  const testRoleName = `integration-role-${suffix}`;
  const adminToken = randomBytes(32).toString('hex');
  const userToken = randomBytes(32).toString('hex');
  let adminId;
  let secondAdminId;
  let rosterChangeAdminId;
  let userId;
  let invitedVendorId;
  let invitedCustomerId;
  let adminRoleId;
  let secondAdminRoleId;
  let rosterChangeAdminRoleId;
  let testRoleId;
  let secondAdminToken;
  let organizerRoleId;
  let organizerPermissionIds;
  let vendorProfileId;
  let eventId;
  let bookingId;
  let reviewId;
  let complaintId;
  let server;
  let originalDescription;
  let notificationEmailConfigured = false;
  const invitationMessages = [];
  let deliveryCalls = 0;
  let notificationEmailSender = async () => ({ messageId: `notification-${suffix}` });
  const ownedReadKey = `admin-notification-read-${suffix}`;
  const ownedBulkKey = `admin-notification-bulk-${suffix}`;
  const foreignNotificationKey = `admin-notification-foreign-${suffix}`;
  const foreignRetryKey = `admin-notification-retry-foreign-${suffix}`;
  const inAppAnnouncementKey = `announcement-inapp-${suffix}`;
  const emailAnnouncementKey = `announcement-email-${suffix}`;
  const countActiveAdminRecipients = async () => database.runtimeAdapter.query(
    `SELECT COUNT(DISTINCT u.id)::integer AS count
     FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
  );

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
    organizerRoleId = roles.get('organizer').id;
    organizerPermissionIds = (await database.runtimeAdapter.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = $1 ORDER BY permission_id',
      [organizerRoleId],
    )).rows.map((row) => row.permission_id);

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
    profilePhase('fixture setup');

    const previousFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://eventhub.example.test';
    let app;
    try {
      app = createApp({
        database: database.runtimeAdapter,
        databaseDialect: 'postgres',
        invitationEmailConfigured: () => true,
        invitationEmailSender: async (message) => invitationMessages.push(message),
        notificationEmailConfigured: () => notificationEmailConfigured,
        notificationEmailSender: (...args) => notificationEmailSender(...args),
      });
    } finally {
      if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
    }
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

    const reports = [
      'users', 'vendors', 'events', 'bookings', 'payments', 'refunds',
      'revenue', 'categories', 'reviews', 'complaints', 'vendor-performance', 'booking-outcomes',
    ];
    const reportResponsesPromise = Promise.all(reports.map((report) => request(
      `/reports?report=${report}&period=last30`,
    )));
    const reportResponses = await reportResponsesPromise;
    await Promise.all(reportResponses.map(async (reportResponse, index) => {
      const report = reports[index];
      assert.equal(reportResponse.status, 200, report);
      const reportBody = await reportResponse.json();
      assert.equal(reportBody.appliedFilters.report, report);
      assert.ok(Array.isArray(reportBody.data));
      assert.ok(Array.isArray(reportBody.summary));
      assert.ok(Array.isArray(reportBody.chartData));
    }));
    const reportExportResponse = await request('/reports/export?report=users&period=last30');
    assert.equal(reportExportResponse.status, 200);
    assert.match(reportExportResponse.headers.get('content-type'), /text\/csv/);
    profilePhase('settings and reports');

    const listPaths = [
      '/reviews', '/reviews/vendors', '/reviews/services',
      '/complaints', '/complaints/assignees',
    ];
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const overviewPromise = (async () => {
      const startedAt = Date.now();
      const response = await request(`/dashboard/overview?startDate=${startDate}&endDate=${endDate}`);
      return { response, durationMs: Date.now() - startedAt };
    })();
    const [
      listResponses,
      overviewResult,
      roleUsersResponse,
      matrixResponse,
      permissionsResponse,
      rolePermissionsResponse,
      organizerPermissionsResult,
    ] = await Promise.all([
      Promise.all(listPaths.map((path) => request(path))),
      overviewPromise,
      request(`/roles/${testRoleId}/users`),
      request('/rbac/matrix'),
      request('/permissions'),
      request(`/roles/${testRoleId}/permissions`),
      database.runtimeAdapter.query(
        'SELECT id, permission_key FROM permissions WHERE permission_key = ANY($1::text[]) ORDER BY permission_key LIMIT 1',
        [getRolePermissionPolicy('organizer')],
      ),
    ]);
    for (const [index, response] of listResponses.entries()) {
      assert.equal(response.status, 200, listPaths[index]);
    }
    const overviewResponse = overviewResult.response;
    const dashboardDurationMs = overviewResult.durationMs;
    console.info(`NEON_DASHBOARD_RESPONSE_MS role=admin overview=${dashboardDurationMs}`);
    assert.ok(dashboardDurationMs < 15000, 'admin dashboard must load before the 15-second client timeout');
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

    assert.equal(roleUsersResponse.status, 200);
    assert.equal((await roleUsersResponse.json()).pagination.total, 0);

    assert.equal(matrixResponse.status, 200);
    assert.ok((await matrixResponse.json()).data.roles.admin.includes('users.view'));

    assert.equal(permissionsResponse.status, 200);
    const availablePermissions = (await permissionsResponse.json()).data;
    assert.ok(availablePermissions.length > 0);
    assert.ok(availablePermissions.every((permission) => (
      permission.permission_key && typeof permission.module === 'string' && typeof permission.action === 'string'
    )));

    assert.equal(rolePermissionsResponse.status, 200);
    assert.deepEqual((await rolePermissionsResponse.json()).data.permission_keys, []);
    const forbiddenPermission = await request(`/roles/${testRoleId}/permissions`, {
      method: 'PATCH',
      body: { permission_keys: ['admin:*'] },
    });
    assert.equal(forbiddenPermission.status, 403);
    assert.ok(organizerPermissionsResult.rows[0], 'Expected an allowed organizer permission in the Neon test database.');
    const permittedPermission = organizerPermissionsResult.rows[0];
    const [nonEmptyPermissionUpdate, permissionUpdate] = await Promise.all([
      request(`/roles/${organizerRoleId}/permissions`, {
        method: 'PATCH',
        body: { permission_keys: [permittedPermission.permission_key] },
      }),
      request(`/roles/${testRoleId}/permissions`, {
        method: 'PATCH',
        body: { permission_keys: [] },
      }),
    ]);
    assert.equal(nonEmptyPermissionUpdate.status, 200, await nonEmptyPermissionUpdate.text());
    assert.equal(permissionUpdate.status, 200, `Empty permission update failed: ${await permissionUpdate.text()}`);
    const persistedPermissionUpdate = await database.runtimeAdapter.query(
      `SELECT p.permission_key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1 ORDER BY p.permission_key`,
      [organizerRoleId],
    );
    assert.deepEqual(persistedPermissionUpdate.rows.map((row) => row.permission_key), [permittedPermission.permission_key]);
    profilePhase('dashboard and role permissions');

    const organizerRole = roles.get('organizer');
    const createdResponse = await request('/users', {
      method: 'POST',
      body: {
        full_name: 'Postgres Admin Created User',
        email: `pg-user-${suffix}@example.invalid`,
        phone: `+1555${suffix.replaceAll('-', '').slice(0, 10)}`,
        role_id: organizerRole.id,
      },
    });
    assert.equal(createdResponse.status, 201);
    userId = (await createdResponse.json()).data.id;
    assert.equal(invitationMessages.length, 1);
    const invitationToken = new URL(invitationMessages[0].setupUrl).searchParams.get('token');
    const storedInvitation = await database.runtimeAdapter.query(
      'SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
    assert.equal(storedInvitation.rows[0].token_hash, hashToken(invitationToken));
    assert.notEqual(storedInvitation.rows[0].token_hash, invitationToken);
    assert.ok(storedInvitation.rows[0].expires_at > new Date());
    const apiOrigin = new URL(baseUrl).origin;
    const setPassword = await fetch(`${apiOrigin}/api/platform/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitationToken, password: 'StrongIntegrationPass123' }),
    });
    assert.equal(setPassword.status, 200);
    const replayedInvitation = await fetch(`${apiOrigin}/api/platform/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitationToken, password: 'StrongIntegrationPass123' }),
    });
    assert.equal(replayedInvitation.status, 400);

    const activeCategory = await database.runtimeAdapter.query(
      'SELECT id FROM service_categories WHERE is_active = TRUE ORDER BY id LIMIT 1',
    );
    assert.ok(activeCategory.rows.length > 0, 'an active vendor category is required for this integration test');
    const vendorInvitation = await request('/users', {
      method: 'POST',
      body: {
        full_name: 'Postgres Admin Created Vendor',
        email: `pg-vendor-${suffix}@example.invalid`,
        role_id: roles.get('vendor').id,
        business_name: `Integration Vendor ${suffix}`,
        category_id: activeCategory.rows[0].id,
      },
    });
    assert.equal(vendorInvitation.status, 201);
    invitedVendorId = (await vendorInvitation.json()).data.id;
    const customerInvitation = await request('/users', {
      method: 'POST',
      body: {
        full_name: 'Postgres Admin Created Customer',
        email: `pg-customer-${suffix}@example.invalid`,
        role_id: roles.get('customer').id,
      },
    });
    assert.equal(customerInvitation.status, 201);
    invitedCustomerId = (await customerInvitation.json()).data.id;
    const forbiddenAdminInvitation = await request('/users', {
      method: 'POST',
      body: {
        full_name: 'Blocked Administrator',
        email: `pg-blocked-admin-${suffix}@example.invalid`,
        role_id: adminRoleId,
      },
    });
    assert.equal(forbiddenAdminInvitation.status, 400);

    const invitedVendorProfile = await database.runtimeAdapter.query(
      'SELECT business_name, category_id FROM vendor_profiles WHERE user_id = $1',
      [invitedVendorId],
    );
    assert.equal(invitedVendorProfile.rows[0].business_name, `Integration Vendor ${suffix}`);
    assert.equal(String(invitedVendorProfile.rows[0].category_id), String(activeCategory.rows[0].id));
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

    const seededNotifications = await database.inTransaction(async (client) => {
      const fixtures = [];
      for (const [userIdForNotification, title, idempotencyKey, channel, deliveryStatus, status] of [
        [adminId, `Notifications ${suffix} A`, ownedReadKey, 'in_app', 'delivered', 'queued'],
        [adminId, `Notifications ${suffix} B`, ownedBulkKey, 'in_app', 'delivered', 'queued'],
        [userId, `Notifications ${suffix} private`, foreignNotificationKey, 'in_app', 'delivered', 'queued'],
        [userId, `Notifications ${suffix} failed retry`, foreignRetryKey, 'email', 'failed', 'failed'],
      ]) {
        const inserted = await client.query(
          `INSERT INTO notifications
             (user_id, title, message, notification_type, idempotency_key,
              delivery_channel, delivery_status, status, delivery_attempts, last_delivery_error)
           VALUES ($1, $2, $3, 'system', $4, $5, $6, $7, $8, $9) RETURNING id`,
          [userIdForNotification, title, 'PostgreSQL notification integration fixture', idempotencyKey,
            channel, deliveryStatus, status, deliveryStatus === 'failed' ? 1 : 0,
            deliveryStatus === 'failed' ? 'TEST_PREVIOUS_FAILURE' : null],
        );
        const notificationId = inserted.rows[0].id;
        await client.query(
          `INSERT INTO notification_history (notification_id, actor_id, action, details)
           VALUES ($1, $2, 'created', $3::jsonb)`,
          [notificationId, adminId, JSON.stringify({ fixture: suffix })],
        );
        fixtures.push(Number(notificationId));
      }
      return fixtures;
    });
    profilePhase('user setup and notification fixtures');
    const [ownedReadId, ownedBulkId, foreignNotificationId, foreignRetryId] = seededNotifications;

    await context.test('GET /notifications/options enforces admin and reports available channels', async () => {
      assert.equal((await fetch(`${baseUrl}/notifications/options`)).status, 401);
      assert.equal((await request('/notifications/options', { token: userToken })).status, 403);
      const inAppOptions = await request('/notifications/options');
      assert.equal(inAppOptions.status, 200);
      assert.deepEqual((await inAppOptions.json()).data.channels, ['in_app']);
      notificationEmailConfigured = true;
      const emailOptions = await request('/notifications/options');
      assert.deepEqual((await emailOptions.json()).data.channels, ['in_app', 'email']);
      notificationEmailConfigured = false;
    });

    await context.test('GET /notifications filters, paginates, and returns empty results', async () => {
      const empty = await request(`/notifications?q=${encodeURIComponent(`no-match-${suffix}`)}`);
      assert.equal(empty.status, 200);
      const emptyBody = await empty.json();
      assert.deepEqual(emptyBody.data, []);
      assert.equal(emptyBody.pagination.total, 0);
      const filtered = await request(
        `/notifications?page=1&pageSize=1&q=${encodeURIComponent(`Notifications ${suffix}`)}&type=system&read=false&sortBy=title&sortDirection=asc`,
      );
      assert.equal(filtered.status, 200);
      const body = await filtered.json();
      assert.equal(body.data.length, 1);
      assert.equal(body.pagination.total, 2);
      assert.equal(body.unreadCount, 2);
      assert.equal(body.data[0].read, false);
      assert.equal((await request('/notifications?dateFrom=2026-99-99')).status, 400);
      assert.equal((await request('/notifications?dateFrom=2026-11-02&dateTo=2026-11-01')).status, 400);
    });

    await context.test('POST /notifications/:id/read enforces ownership and idempotency', async () => {
      const crossRecipient = await request(`/notifications/${foreignNotificationId}/read`, { method: 'POST' });
      assert.equal(crossRecipient.status, 404);
      const read = await request(`/notifications/${ownedReadId}/read`, { method: 'POST' });
      assert.equal(read.status, 200);
      assert.deepEqual((await read.json()).data, { id: ownedReadId, read: true, changed: true });
      const readAgain = await request(`/notifications/${ownedReadId}/read`, { method: 'POST' });
      assert.equal((await readAgain.json()).data.changed, false);
    });

    await context.test('POST /notifications/read-all marks only the current admin inbox', async () => {
      const readAll = await request('/notifications/read-all', { method: 'POST' });
      assert.equal(readAll.status, 200);
      assert.equal((await readAll.json()).data.changed, 1);
      assert.equal((await (await request('/notifications/read-all', { method: 'POST' })).json()).data.changed, 0);
      const bulkState = await database.runtimeAdapter.query(
        `SELECT n.status, COUNT(h.id)::integer AS read_history
         FROM notifications n LEFT JOIN notification_history h
           ON h.notification_id = n.id AND h.action = 'read'
         WHERE n.id = $1 GROUP BY n.id`,
        [ownedBulkId],
      );
      assert.equal(bulkState.rows[0].status, 'read');
      assert.equal(bulkState.rows[0].read_history, 1);
      const foreignState = await database.runtimeAdapter.query('SELECT status FROM notifications WHERE id = $1', [foreignNotificationId]);
      assert.equal(foreignState.rows[0].status, 'queued');
    });

    await context.test('GET /notifications/:id/history is ownership-scoped', async () => {
      const ownHistory = await request(`/notifications/${ownedReadId}/history`);
      assert.equal(ownHistory.status, 200);
      assert.deepEqual(new Set((await ownHistory.json()).data.map((row) => row.action)), new Set(['created', 'read']));
      const foreignHistory = await request(`/notifications/${foreignNotificationId}/history`);
      assert.equal(foreignHistory.status, 404);
      const amharicValidation = await fetch(`${baseUrl}/notifications/not-a-number/history`, {
        headers: { Cookie: `admin_session=${adminToken}`, 'X-Language': 'am' },
      });
      assert.equal(amharicValidation.status, 400);
      assert.match((await amharicValidation.json()).error, /ትክክለኛ/);
    });

    const emailAnnouncement = {
      title: `Email announcement ${suffix}`,
      message: `Email announcement body ${suffix}`,
      channel: 'email',
      idempotencyKey: emailAnnouncementKey,
    };
    await context.test('POST /notifications/announcements is transactional and idempotent', async () => {
      const rollbackKey = `notification-rollback-${suffix}`;
      await assert.rejects(
        database.runtimeAdapter.inTransaction(async (transaction) => {
          await transaction.query(
            `INSERT INTO notifications
               (user_id, title, message, notification_type, idempotency_key, delivery_status)
             VALUES ($1, $2, $3, 'announcement', $4, 'delivered')`,
            [adminId, `Rollback ${suffix}`, 'This insert must roll back.', rollbackKey],
          );
          await transaction.query(
            `INSERT INTO notification_history (notification_id, actor_id, action)
             VALUES ($1, $2, 'created')`,
            ['9223372036854775807', adminId],
          );
        }),
        (error) => error.code === '23503',
      );
      const rolledBackNotification = await database.runtimeAdapter.query(
        'SELECT id FROM notifications WHERE idempotency_key = $1',
        [rollbackKey],
      );
      assert.equal(rolledBackNotification.rowCount, 0);

      const inAppAnnouncement = {
        title: `Notification announcement ${suffix}`,
        message: `Notification announcement body ${suffix}`,
        channel: 'in_app',
        idempotencyKey: inAppAnnouncementKey,
      };
      const activeAdminRecipients = await countActiveAdminRecipients();
      const created = await request('/notifications/announcements', { method: 'POST', body: inAppAnnouncement });
      assert.equal(created.status, 201);
      const result = (await created.json()).data;
      assert.equal(result.created, activeAdminRecipients.rows[0].count);
      assert.ok(result.deliveries.every((delivery) => delivery.deliveryStatus === 'delivered'));
      const stored = await database.runtimeAdapter.query(
        `SELECT n.id, n.user_id, n.status, n.delivery_status, COUNT(h.id)::integer AS history_count
         FROM notifications n LEFT JOIN notification_history h ON h.notification_id = n.id
         WHERE n.idempotency_key LIKE $1 GROUP BY n.id ORDER BY n.id`,
        [`announcement:${inAppAnnouncementKey}:%`],
      );
      assert.equal(stored.rowCount, activeAdminRecipients.rows[0].count);
      assert.ok(stored.rows.every((row) => row.status === 'queued' && row.delivery_status === 'delivered' && row.history_count === 1));
      const announcementAudits = await database.runtimeAdapter.query(
        `SELECT COUNT(*)::integer AS count FROM audit_logs
         WHERE actor_id = $1 AND action = 'notification.announcement_created'
           AND entity_id = ANY($2::varchar[])`,
        [adminId, stored.rows.map((row) => String(row.id))],
      );
      assert.equal(announcementAudits.rows[0].count, stored.rowCount);
      await database.inTransaction(async (client) => {
        const role = await client.query(
          `INSERT INTO roles (name, description, is_admin, is_active)
           VALUES ($1, 'Temporary announcement roster fixture', TRUE, TRUE) RETURNING id`,
          [`integration-roster-admin-${suffix}`],
        );
        rosterChangeAdminRoleId = role.rows[0].id;
        const user = await client.query(
          `INSERT INTO users (full_name, email, password_hash, status)
           VALUES ('Postgres Announcement Roster Admin', $1, 'integration-only-not-a-login-hash', 'active')
           RETURNING id`,
          [`pg-announcement-roster-${suffix}@example.invalid`],
        );
        rosterChangeAdminId = user.rows[0].id;
        await client.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [rosterChangeAdminId, rosterChangeAdminRoleId],
        );
      });
      const duplicate = await request('/notifications/announcements', { method: 'POST', body: inAppAnnouncement });
      assert.equal(duplicate.status, 200);
      const duplicateBody = (await duplicate.json()).data;
      assert.equal(duplicateBody.created, 0);
      assert.equal(duplicateBody.deliveries.length, stored.rowCount);
      const rosterAdminNotification = await database.runtimeAdapter.query(
        'SELECT id FROM notifications WHERE user_id = $1 AND idempotency_key = $2',
        [rosterChangeAdminId, `announcement:${inAppAnnouncementKey}:${rosterChangeAdminId}`],
      );
      assert.equal(rosterAdminNotification.rowCount, 0);
      const conflictingReplay = await request('/notifications/announcements', {
        method: 'POST',
        body: { ...inAppAnnouncement, title: `Conflicting ${suffix}` },
      });
      assert.equal(conflictingReplay.status, 409);
      const storedAfterDuplicate = await database.runtimeAdapter.query(
        `SELECT id FROM notifications
         WHERE LEFT(idempotency_key, CHAR_LENGTH($1)) = $1`,
        [`announcement:${inAppAnnouncementKey}:`],
      );
      assert.equal(storedAfterDuplicate.rowCount, stored.rowCount);
      await database.inTransaction(async (client) => {
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [rosterChangeAdminId]);
        await client.query('DELETE FROM users WHERE id = $1', [rosterChangeAdminId]);
        await client.query('DELETE FROM roles WHERE id = $1', [rosterChangeAdminRoleId]);
      });
      rosterChangeAdminId = undefined;
      rosterChangeAdminRoleId = undefined;

      const concurrentAnnouncement = {
        title: `Concurrent announcement ${suffix}`,
        message: `Concurrent announcement body ${suffix}`,
        channel: 'in_app',
        idempotencyKey: `announcement-concurrent-${suffix}`,
      };
      const concurrentAdminRecipients = await countActiveAdminRecipients();
      const concurrentResponses = await Promise.all([
        request('/notifications/announcements', { method: 'POST', body: concurrentAnnouncement }),
        request('/notifications/announcements', { method: 'POST', body: concurrentAnnouncement }),
      ]);
      const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json()));
      assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [200, 201]);
      assert.equal(
        concurrentBodies.reduce((total, body) => total + body.data.created, 0),
        concurrentAdminRecipients.rows[0].count,
      );
      const concurrentStored = await database.runtimeAdapter.query(
        `SELECT n.user_id, COUNT(*)::integer AS copies, COUNT(h.id)::integer AS history_count
         FROM notifications n LEFT JOIN notification_history h ON h.notification_id = n.id
         WHERE n.idempotency_key LIKE $1
         GROUP BY n.user_id`,
        [`announcement:${concurrentAnnouncement.idempotencyKey}:%`],
      );
      assert.equal(concurrentStored.rowCount, concurrentAdminRecipients.rows[0].count);
      assert.ok(concurrentStored.rows.every((row) => row.copies === 1 && row.history_count === 1));

      const unavailableEmail = await request('/notifications/announcements', { method: 'POST', body: emailAnnouncement });
      assert.equal(unavailableEmail.status, 503);
      const absent = await database.runtimeAdapter.query(
        'SELECT id FROM notifications WHERE idempotency_key LIKE $1',
        [`announcement:${emailAnnouncementKey}:%`],
      );
      assert.equal(absent.rowCount, 0);

      notificationEmailConfigured = true;
      notificationEmailSender = async () => {
        deliveryCalls += 1;
        throw Object.assign(new Error('safe test failure'), { code: 'TEST_SMTP_FAILURE' });
      };
      const emailAdminRecipients = await countActiveAdminRecipients();
      const failed = await request('/notifications/announcements', { method: 'POST', body: emailAnnouncement });
      assert.equal(failed.status, 201);
      const failedResult = (await failed.json()).data;
      assert.equal(failedResult.created, emailAdminRecipients.rows[0].count);
      assert.ok(failedResult.deliveries.every((delivery) => delivery.deliveryStatus === 'failed'));
      assert.equal(deliveryCalls, emailAdminRecipients.rows[0].count);
      const duplicateEmail = await request('/notifications/announcements', { method: 'POST', body: emailAnnouncement });
      assert.equal(duplicateEmail.status, 200);
      assert.equal((await duplicateEmail.json()).data.created, 0);
      assert.equal(deliveryCalls, emailAdminRecipients.rows[0].count);
    });

    await context.test('POST /notifications/:id/retry handles failure, success, duplicate, and recipient scope', async () => {
      const adminFailedEmailResult = await database.runtimeAdapter.query(
        'SELECT id FROM notifications WHERE user_id = $1 AND idempotency_key = $2',
        [adminId, `announcement:${emailAnnouncementKey}:${adminId}`],
      );
      assert.equal(adminFailedEmailResult.rowCount, 1);
      const adminFailedEmail = Number(adminFailedEmailResult.rows[0].id);
      notificationEmailConfigured = true;
      let failedRetryCalls = 0;
      notificationEmailSender = async () => {
        failedRetryCalls += 1;
        throw Object.assign(new Error('safe retry failure'), { code: 'TEST_RETRY_FAILURE' });
      };
      const failedRetry = await request(`/notifications/${adminFailedEmail}/retry`, { method: 'POST' });
      assert.equal(failedRetry.status, 502);
      assert.equal(failedRetryCalls, 1);
      const failedState = await database.runtimeAdapter.query(
        'SELECT delivery_status, delivery_attempts, last_delivery_error FROM notifications WHERE id = $1 AND user_id = $2',
        [adminFailedEmail, adminId],
      );
      assert.equal(failedState.rows[0].delivery_status, 'failed');
      assert.equal(failedState.rows[0].delivery_attempts, 2);
      assert.equal(failedState.rows[0].last_delivery_error, 'TEST_RETRY_FAILURE');
      notificationEmailSender = async () => ({ messageId: `confirmed-${suffix}` });
      const successfulRetry = await request(`/notifications/${adminFailedEmail}/retry`, { method: 'POST' });
      assert.equal(successfulRetry.status, 200);
      assert.deepEqual((await successfulRetry.json()).data, { id: adminFailedEmail, deliveryStatus: 'delivered' });
      const successfulState = await database.runtimeAdapter.query(
        'SELECT delivery_status, status, delivery_attempts FROM notifications WHERE id = $1',
        [adminFailedEmail],
      );
      assert.equal(successfulState.rows[0].delivery_status, 'delivered');
      assert.equal(successfulState.rows[0].status, 'sent');
      assert.equal(successfulState.rows[0].delivery_attempts, 3);
      const history = await database.runtimeAdapter.query(
        'SELECT action FROM notification_history WHERE notification_id = $1 ORDER BY id',
        [adminFailedEmail],
      );
      assert.deepEqual(history.rows.map((row) => row.action), [
        'created', 'email_failed', 'email_retry_started', 'email_failed', 'email_retry_started', 'email_delivered',
      ]);
      const audit = await database.runtimeAdapter.query(
        `SELECT COUNT(*)::integer AS count FROM audit_logs
         WHERE actor_id = $1 AND action = 'notification.delivery_retried' AND entity_id = $2`,
        [adminId, String(adminFailedEmail)],
      );
      assert.equal(audit.rows[0].count, 1);
      assert.equal((await request(`/notifications/${adminFailedEmail}/retry`, { method: 'POST' })).status, 409);
      assert.equal(failedRetryCalls, 1);
      assert.equal((await request(`/notifications/${foreignRetryId}/retry`, { method: 'POST' })).status, 404);
    });
    profilePhase('notification subtests');

    const [nonAdminAccess, nonAdminReportAccess, nonAdminDashboardAccess, listed] = await Promise.all([
      request('/users', { token: userToken }),
      request('/reports/summary', { token: userToken }),
      request(
        `/dashboard/overview?startDate=${startDate}&endDate=${endDate}`,
        { token: userToken },
      ),
      request(`/users?q=${encodeURIComponent(`pg-user-${suffix}`)}&pageSize=5`),
    ]);
    assert.equal(nonAdminAccess.status, 403);
    assert.equal(nonAdminReportAccess.status, 403);
    assert.equal(nonAdminDashboardAccess.status, 403);

    assert.equal(listed.status, 200);
    const listBody = await listed.json();
    assert.equal(listBody.pagination.total, 1);
    assert.equal(String(listBody.data[0].id), String(userId));
    assert.equal(listBody.data[0].roles, 'Organizer');

    const [updated, invalidRole] = await Promise.all([
      request(`/users/${userId}`, {
        method: 'PATCH',
        body: { full_name: 'Updated PostgreSQL User' },
      }),
      request(`/users/${userId}/role`, {
        method: 'PATCH',
        body: { role_id: -1 },
      }),
    ]);
    assert.equal(updated.status, 200);
    assert.equal(invalidRole.status, 400);
    const [duplicateEmail, detail] = await Promise.all([
      request(`/users/${userId}`, {
        method: 'PATCH',
        body: { email: adminEmail },
      }),
      request(`/users/${userId}`),
    ]);
    assert.equal(duplicateEmail.status, 409);
    assert.equal((await detail.json()).data.full_name, 'Updated PostgreSQL User');

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

    const [vendorProfile, event] = await Promise.all([
      database.runtimeAdapter.query(
        `INSERT INTO vendor_profiles (user_id, business_name, verification_status)
         VALUES ($1, $2, 'verified') RETURNING id`,
        [userId, `Integration vendor ${suffix}`],
      ),
      database.runtimeAdapter.query(
        `INSERT INTO events (organizer_id, title, event_type, start_date, status)
         VALUES ($1, $2, 'Integration', CURRENT_TIMESTAMP + INTERVAL '1 day', 'active')
         RETURNING id`,
        [adminId, `Integration event ${suffix}`],
      ),
    ]);
    vendorProfileId = vendorProfile.rows[0].id;
    eventId = event.rows[0].id;
    const booking = await database.runtimeAdapter.query(
      `INSERT INTO bookings (event_id, vendor_id, service_description, quoted_amount, status)
       VALUES ($1, $2, 'Integration service', 10, 'accepted') RETURNING id`,
      [eventId, vendorProfileId],
    );
    bookingId = booking.rows[0].id;
    const review = await database.runtimeAdapter.query(
      `INSERT INTO reviews (booking_id, rating, comment, status)
       VALUES ($1, 2, 'Integration review', 'published') RETURNING id`,
      [bookingId],
    );
    reviewId = review.rows[0].id;
    const complaint = await database.runtimeAdapter.query(
      `INSERT INTO complaints (user_id, booking_id, subject, details, status)
       VALUES ($1, $2, 'Integration complaint', 'Integration complaint details', 'open')
       RETURNING id`,
      [userId, bookingId],
    );
    complaintId = complaint.rows[0].id;

    const [reviewDetailsResponse, complaintDetailsResponse] = await Promise.all([
      request(`/reviews/${reviewId}`),
      request(`/complaints/${complaintId}`),
    ]);
    assert.equal(reviewDetailsResponse.status, 200);
    assert.equal((await reviewDetailsResponse.json()).data.comment, 'Integration review');
    assert.equal(complaintDetailsResponse.status, 200);
    const complaintDetails = await complaintDetailsResponse.json();
    assert.equal(complaintDetails.data.details, 'Integration complaint details');
    const [moderateResponse, complaintUpdate] = await Promise.all([
      request(`/reviews/${reviewId}/moderation`, {
        method: 'PATCH',
        body: { status: 'hidden', reason: 'Integration moderation test' },
      }),
      request(`/complaints/${complaintId}`, {
        method: 'PATCH',
        body: {
          status: 'under_review',
          reason: 'Integration assignment test',
          assignedTo: adminId,
        },
      }),
    ]);
    assert.equal(moderateResponse.status, 200);
    const reviewHistory = await database.runtimeAdapter.query(
      'SELECT action FROM review_history WHERE review_id = $1',
      [reviewId],
    );
    assert.equal(reviewHistory.rows[0].action, 'hidden');
    assert.equal(complaintUpdate.status, 200);
    assert.equal(String((await complaintUpdate.json()).data.assigned_to), String(adminId));
    const attachmentResponse = await fetch(`${baseUrl}/complaints/${complaintId}/attachments?filename=evidence.pdf`, {
      method: 'POST',
      headers: { Cookie: `admin_session=${adminToken}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from('%PDF-1.7 integration evidence'),
    });
    assert.equal(attachmentResponse.status, 201);
    const attachmentId = (await attachmentResponse.json()).data.id;
    const downloadResponse = await request(`/complaints/${complaintId}/attachments/${attachmentId}`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(await downloadResponse.text(), '%PDF-1.7 integration evidence');

    secondAdminToken = randomBytes(32).toString('hex');
    await database.inTransaction(async (client) => {
      const secondRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary secondary admin role', TRUE, TRUE) RETURNING id`,
        [`integration-secondary-admin-${suffix}`],
      );
      secondAdminRoleId = secondRole.rows[0].id;
      const secondUser = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Postgres Secondary Admin', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [`pg-secondary-admin-${suffix}@example.invalid`],
      );
      secondAdminId = secondUser.rows[0].id;
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [secondAdminId, secondAdminRoleId],
      );
      await client.query(
        `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(secondAdminToken), secondAdminId],
      );
    });
    const secondAdminRequest = (path, { method = 'GET', body } = {}) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Cookie: `admin_session=${secondAdminToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const disableOriginalAdminRole = await request(`/roles/${adminRoleId}/status`, {
      method: 'PATCH',
      body: { is_active: false },
    });
    assert.equal(disableOriginalAdminRole.status, 200);
    assert.equal((await database.runtimeAdapter.query(
      'SELECT id FROM admin_sessions WHERE user_id = $1',
      [adminId],
    )).rowCount, 0, 'disabling the role should invalidate its administrator sessions');
    const otherActiveAdmins = await database.runtimeAdapter.query(
      `SELECT COUNT(DISTINCT u.id)::integer AS total
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
         AND r.id <> $1`,
      [secondAdminRoleId],
    );
    const disableLastAdminRole = await secondAdminRequest(`/roles/${secondAdminRoleId}/status`, {
      method: 'PATCH',
      body: { is_active: false },
    });
    assert.equal(disableLastAdminRole.status, otherActiveAdmins.rows[0].total === 0 ? 409 : 200);
    if (otherActiveAdmins.rows[0].total === 0) {
      assert.match((await disableLastAdminRole.json()).error, /last active Administrator role/i);
      assert.equal((await database.runtimeAdapter.query(
        'SELECT is_active FROM roles WHERE id = $1',
        [secondAdminRoleId],
      )).rows[0].is_active, true);
    }
    profilePhase('remaining admin workflows');
  } finally {
    profilePhase('begin cleanup');
    try {
      if (server?.listening) {
        server.closeAllConnections();
        server.close();
        await once(server, 'close');
      }
    } finally {
      try {
        await database.inTransaction(async (client) => {
          const fixtureUserIds = [
            adminId, secondAdminId, rosterChangeAdminId, userId, invitedVendorId, invitedCustomerId,
          ].filter(Boolean);
          const fixtureRoleIds = [
            adminRoleId, secondAdminRoleId, rosterChangeAdminRoleId, testRoleId,
          ].filter(Boolean);
          if (organizerRoleId && organizerPermissionIds) {
            await client.query('SELECT id FROM roles WHERE id = $1 FOR UPDATE', [organizerRoleId]);
            await client.query('DELETE FROM role_permissions WHERE role_id = $1', [organizerRoleId]);
            for (const permissionId of organizerPermissionIds) {
              await client.query(
                `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
                 ON CONFLICT (role_id, permission_id) DO NOTHING`,
                [organizerRoleId, permissionId],
              );
            }
          }
          if (originalDescription !== undefined) {
            if (originalDescription) {
              const updatedBy = originalDescription.updated_by;
              const updatedByWillRemain = updatedBy !== null
                && !fixtureUserIds.some((id) => String(id) === String(updatedBy))
                && (await client.query('SELECT 1 FROM users WHERE id = $1', [updatedBy])).rowCount > 0;
              await client.query(
                `INSERT INTO system_settings (setting_key, setting_value, updated_by)
                 VALUES ('platform_description', $1, $2)
                 ON CONFLICT (setting_key) DO UPDATE
                 SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
                [originalDescription.setting_value, updatedByWillRemain ? updatedBy : null],
              );
            } else {
              await client.query(
                `DELETE FROM system_settings WHERE setting_key = 'platform_description'`,
              );
            }
          }
          const notificationRows = await client.query(
            `SELECT id FROM notifications
             WHERE user_id = ANY($1::bigint[])
                OR idempotency_key = ANY($2::varchar[])
                OR idempotency_key LIKE ANY($3::varchar[])
                OR (related_entity_type = 'complaint' AND related_entity_id = $4)`,
            [
              fixtureUserIds,
              [ownedReadKey, ownedBulkKey, foreignNotificationKey, foreignRetryKey],
              [`announcement:${inAppAnnouncementKey}:%`, `announcement:${emailAnnouncementKey}:%`],
              complaintId ? String(complaintId) : '',
            ],
          );
          const notificationIds = notificationRows.rows.map((row) => row.id);
          if (fixtureUserIds.length) {
            await client.query(
              'DELETE FROM notification_history WHERE actor_id = ANY($1::bigint[])',
              [fixtureUserIds],
            );
          }
          if (notificationIds.length) {
            await client.query(
              'DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])',
              [notificationIds],
            );
            await client.query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
          }
          if (complaintId) {
            await client.query('DELETE FROM complaint_attachments WHERE complaint_id = $1', [complaintId]);
            await client.query('DELETE FROM complaint_history WHERE complaint_id = $1', [complaintId]);
            await client.query('DELETE FROM complaints WHERE id = $1', [complaintId]);
          }
          if (reviewId) {
            await client.query('DELETE FROM review_history WHERE review_id = $1', [reviewId]);
            await client.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
          }
          if (bookingId) {
            await client.query('DELETE FROM booking_history WHERE booking_id = $1', [bookingId]);
            await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
          }
          if (eventId) await client.query('DELETE FROM events WHERE id = $1', [eventId]);
          if (fixtureUserIds.length) {
            await client.query('DELETE FROM vendor_profiles WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
            await client.query('DELETE FROM password_reset_tokens WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
          }
          if (fixtureUserIds.length) {
            await client.query('DELETE FROM admin_sessions WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
            await client.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
          }
          if (fixtureUserIds.length) {
            await client.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])', [fixtureUserIds]);
          }
          if (fixtureRoleIds.length) {
            await client.query(
              `DELETE FROM audit_logs
               WHERE entity_type = 'role' AND entity_id = ANY($1::varchar[])`,
              [fixtureRoleIds.map(String)],
            );
            await client.query('DELETE FROM role_permissions WHERE role_id = ANY($1::bigint[])', [fixtureRoleIds]);
            await client.query('DELETE FROM user_roles WHERE role_id = ANY($1::bigint[])', [fixtureRoleIds]);
          }
          if (fixtureUserIds.length) {
            await client.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [fixtureUserIds]);
            await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [fixtureUserIds]);
          }
          if (fixtureRoleIds.length) {
            await client.query('DELETE FROM roles WHERE id = ANY($1::bigint[])', [fixtureRoleIds]);
          }
        });
      } finally {
        await database.close();
        profilePhase('cleanup and pool close');
      }
    }
  }
});
