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
}, async (context) => {
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
  let notificationEmailConfigured = false;
  let deliveryCalls = 0;
  let notificationEmailSender = async () => ({ messageId: `notification-${suffix}` });
  const ownedReadKey = `admin-notification-read-${suffix}`;
  const ownedBulkKey = `admin-notification-bulk-${suffix}`;
  const foreignNotificationKey = `admin-notification-foreign-${suffix}`;
  const foreignRetryKey = `admin-notification-retry-foreign-${suffix}`;
  const inAppAnnouncementKey = `announcement-inapp-${suffix}`;
  const emailAnnouncementKey = `announcement-email-${suffix}`;

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

    const app = createApp({
      database: database.runtimeAdapter,
      databaseDialect: 'postgres',
      notificationEmailConfigured: () => notificationEmailConfigured,
      notificationEmailSender: (...args) => notificationEmailSender(...args),
    });
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

    const activeAdminRecipients = await database.runtimeAdapter.query(
      `SELECT COUNT(DISTINCT u.id)::integer AS count
       FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
    );
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
      const duplicate = await request('/notifications/announcements', { method: 'POST', body: inAppAnnouncement });
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).data.created, 0);

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
      const failed = await request('/notifications/announcements', { method: 'POST', body: emailAnnouncement });
      assert.equal(failed.status, 201);
      const failedResult = (await failed.json()).data;
      assert.equal(failedResult.created, activeAdminRecipients.rows[0].count);
      assert.ok(failedResult.deliveries.every((delivery) => delivery.deliveryStatus === 'failed'));
      assert.equal(deliveryCalls, activeAdminRecipients.rows[0].count);
      const duplicateEmail = await request('/notifications/announcements', { method: 'POST', body: emailAnnouncement });
      assert.equal(duplicateEmail.status, 200);
      assert.equal((await duplicateEmail.json()).data.created, 0);
      assert.equal(deliveryCalls, activeAdminRecipients.rows[0].count);
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
        const notificationRows = await client.query(
          `SELECT id FROM notifications
           WHERE idempotency_key = ANY($1::varchar[]) OR idempotency_key LIKE ANY($2::varchar[])`,
          [
            [ownedReadKey, ownedBulkKey, foreignNotificationKey, foreignRetryKey],
            [`announcement:${inAppAnnouncementKey}:%`, `announcement:${emailAnnouncementKey}:%`],
          ],
        );
        const notificationIds = notificationRows.rows.map((row) => row.id);
        if (notificationIds.length) {
          await client.query(
            'DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])',
            [notificationIds],
          );
          await client.query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
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
