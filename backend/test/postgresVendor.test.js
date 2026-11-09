import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';
const vendorToken = 'postgres-vendor-route-parity-session';
const roleTokens = new Map([
  [hashToken(vendorToken), 'vendor'],
  [hashToken('postgres-customer-session'), 'customer'],
  [hashToken('postgres-organizer-session'), 'organizer'],
  [hashToken('postgres-admin-session'), 'admin'],
]);

function createDatabase() {
  const statements = [];
  return {
    statements,
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM user_sessions s')) {
        const role = roleTokens.get(values[0]);
        if (!role || role === 'admin') return { rows: [] };
        return { rows: [{
          id: 44,
          full_name: 'Postgres Vendor',
          email: 'pg-vendor@example.test',
          phone: null,
          status: 'active',
          role,
          permission_keys: ['services.manage_own', 'bookings.view_own'],
        }] };
      }
      if (sql.includes('FROM vendor_profiles vp') && sql.includes('WHERE vp.user_id = $1')) {
        return { rows: [{
          id: 10,
          user_id: 44,
          business_name: 'Postgres Test Vendor',
          category_id: null,
          category_name: null,
          city: 'Addis Ababa',
          address: null,
          service_areas: [],
          operating_hours: {},
          website: null,
          notification_preferences: {},
          booking_preferences: {},
          description: 'Fixture profile',
          verification_status: 'verified',
          verification_reason: null,
          verified_at: new Date('2026-01-01T00:00:00Z'),
          created_at: new Date('2026-01-01T00:00:00Z'),
          full_name: 'Postgres Vendor',
          email: 'pg-vendor@example.test',
          phone: null,
          status: 'active',
        }] };
      }
      if (sql.includes('FROM vendor_profiles WHERE user_id = $1')) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes('AS total_services') && sql.includes('AS unread_notifications')) {
        return { rows: [{
          total_services: '3',
          active_services: '2',
          inactive_services: '1',
          pending_bookings: '4',
          confirmed_bookings: '5',
          completed_bookings: '2',
          total_bookings: '11',
          total_customers: '6',
          upcoming_bookings: '3',
          upcoming_dates: '7',
          pending_quotations: '2',
          total_earnings: '1250.50',
          pending_payouts: '300.00',
          average_rating: '4.75',
          unread_messages: '2',
          unread_notifications: '4',
        }] };
      }
      return { rows: [] };
    },
    async inTransaction(work) {
      return work(this);
    },
  };
}

async function withServer(run) {
  const database = createDatabase();
  const app = createApp({ database, databaseDialect: 'postgres' });
  app.locals.platformSettingsCache = {
    values: { platform_status: 'open', maintenance_mode: false, maintenance_message: '' },
    expiresAt: Date.now() + 60_000,
  };
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`, database);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

test('PostgreSQL vendor dashboard exposes every frontend data endpoint and profile photo route', async () => {
  await withServer(async (baseUrl, database) => {
    const cookie = `platform_session=${vendorToken}`;
    const paths = [
      '/api/vendor/notifications',
      '/api/vendor/profile',
      '/api/vendor/overview',
      '/api/vendor/pricing',
      '/api/vendor/tasks',
      '/api/vendor/history',
      '/api/vendor/verification',
      '/api/vendor/services',
      '/api/vendor/messages',
      '/api/vendor/reports',
      '/api/vendor/categories',
      '/api/vendor/payments',
      '/api/vendor/account',
      '/api/vendor/packages',
      '/api/vendor/media',
      '/api/vendor/reviews',
      '/api/vendor/availability',
      '/api/vendor/booking-requests',
      '/api/vendor/bookings',
      '/api/vendor/quotations',
    ];

    let overviewData;
    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, `${path} should be routed`);
      const body = await response.json();
      assert.ok(body && typeof body === 'object', `${path} should return its JSON payload`);
      assert.ok(Object.hasOwn(body, 'data'), `${path} should preserve the frontend response envelope`);
      if (path === '/api/vendor/overview') overviewData = body.data;
    }
    const overviewQuery = database.statements.filter(({ sql }) => sql.includes('AS total_services'));
    assert.equal(overviewQuery.length, 1, 'vendor overview should use one aggregate query');
    assert.deepEqual(overviewQuery[0].values, [10, 44]);
    assert.equal(overviewData.totalServices, 3);
    assert.equal(overviewData.totalEarnings, 1250.5);
    assert.equal(overviewData.averageRating, 4.75);
    assert.equal(overviewData.unreadNotifications, 4);

    const photo = await fetch(`${baseUrl}/api/platform/profile/photo`, { headers: { Cookie: cookie } });
    assert.equal(photo.status, 204);
    assert.ok(database.statements.some(({ sql }) => sql.includes('FROM users WHERE id = $1')));
    assert.ok(database.statements.length >= paths.length);
    for (const { sql } of database.statements) assert.doesNotMatch(sql, /\?/);
  });
});

test('PostgreSQL vendor dashboard denies unauthenticated and non-vendor roles', async () => {
  await withServer(async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/vendor/overview`);
    assert.equal(unauthenticated.status, 401);

    for (const token of ['postgres-customer-session', 'postgres-organizer-session']) {
      const response = await fetch(`${baseUrl}/api/vendor/overview`, {
        headers: { Cookie: `platform_session=${token}` },
      });
      assert.equal(response.status, 403);
    }

    const administrator = await fetch(`${baseUrl}/api/vendor/overview`, {
      headers: { Cookie: 'platform_session=postgres-admin-session' },
    });
    assert.equal(administrator.status, 401);
  });
});

test('Neon PostgreSQL vendor dashboard queries, ownership, and mutations', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const token = randomBytes(32).toString('hex');
  const emailSuffix = randomUUID();
  let fixture;
  let server;

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.match(identity.server_version, /^PostgreSQL 18\b/);
    assert.equal(identity.database_name, 'eventhub');

    fixture = await database.inTransaction(async (tx) => {
      const vendorRole = (await tx.query(
        "SELECT id FROM roles WHERE LOWER(name) = 'vendor' AND is_active = TRUE LIMIT 1",
      )).rows[0];
      assert.ok(vendorRole, 'vendor role is seeded');
      const servicePermission = (await tx.query(
        "SELECT id FROM permissions WHERE permission_key = 'services.manage_own'",
      )).rows[0];
      assert.ok(servicePermission, 'vendor dashboard permissions migration is applied');

      const vendorUser = (await tx.query(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ('Postgres Dashboard Vendor', $1, 'integration-only-not-a-login-hash') RETURNING id`,
        [`vendor-${emailSuffix}@example.invalid`],
      )).rows[0];
      const organizer = (await tx.query(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ('Postgres Dashboard Organizer', $1, 'integration-only-not-a-login-hash') RETURNING id`,
        [`organizer-${emailSuffix}@example.invalid`],
      )).rows[0];
      await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [vendorUser.id, vendorRole.id]);
      await tx.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [vendorRole.id, servicePermission.id],
      );
      const vendor = (await tx.query(
        `INSERT INTO vendor_profiles (user_id, business_name, verification_status, city)
         VALUES ($1, 'Postgres Dashboard Vendor', 'pending', 'Addis Ababa') RETURNING id`,
        [vendorUser.id],
      )).rows[0];
      const category = (await tx.query(
        `INSERT INTO service_categories (name, description)
         VALUES ($1, 'Temporary dashboard integration category') RETURNING id`,
        [`Dashboard ${emailSuffix}`],
      )).rows[0];
      await tx.query(
        `INSERT INTO vendor_profiles (id, user_id, business_name, category_id, verification_status, city)
         VALUES ($1, $2, 'Postgres Dashboard Vendor', $3, 'pending', 'Addis Ababa')
         ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id`,
        [vendor.id, vendorUser.id, category.id],
      );
      const service = (await tx.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
         VALUES ($1, $2, 'Integration Service', 'Real vendor service fixture', 1250.00, 'ETB', 'active')
         RETURNING id`,
        [vendor.id, category.id],
      )).rows[0];
      const event = (await tx.query(
        `INSERT INTO events (organizer_id, title, event_type, city, start_date)
         VALUES ($1, 'Integration Event', 'Integration', 'Addis Ababa', CURRENT_TIMESTAMP + INTERVAL '30 days')
         RETURNING id`,
        [organizer.id],
      )).rows[0];
      const booking = (await tx.query(
        `INSERT INTO bookings
           (event_id, vendor_id, service_id, service_description, quoted_amount, currency, status, scheduled_date)
         VALUES ($1, $2, $3, 'Integration Service', 1250.00, 'ETB', 'accepted', CURRENT_TIMESTAMP + INTERVAL '30 days')
         RETURNING id`,
        [event.id, vendor.id, service.id],
      )).rows[0];
      const review = (await tx.query(
        `INSERT INTO reviews (booking_id, rating, comment)
         VALUES ($1, 5, 'Integration review') RETURNING id`,
        [booking.id],
      )).rows[0];
      const payment = (await tx.query(
        `INSERT INTO payments (booking_id, amount, currency, provider, status)
         VALUES ($1, 1250.00, 'ETB', 'integration', 'paid') RETURNING id`,
        [booking.id],
      )).rows[0];
      const message = (await tx.query(
        `INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body)
         VALUES ($1, $2, $3, 'Integration message', 'Private vendor conversation')
         RETURNING id`,
        [organizer.id, vendorUser.id, booking.id],
      )).rows[0];
      const notification = (await tx.query(
        `INSERT INTO notifications (user_id, title, message)
         VALUES ($1, 'Integration notification', 'Unread fixture') RETURNING id`,
        [vendorUser.id],
      )).rows[0];
      const task = (await tx.query(
        `INSERT INTO event_vendor_tasks (event_id, booking_id, title, created_by)
         VALUES ($1, $2, 'Integration task', $3) RETURNING id`,
        [event.id, booking.id, organizer.id],
      )).rows[0];
      await tx.query(
        `INSERT INTO vendor_availability (vendor_id, available_date, status, note)
         VALUES ($1, CURRENT_DATE + 60, 'available', 'Integration availability')`,
        [vendor.id],
      );
      await tx.query(
        `INSERT INTO quotations (vendor_id, customer_id, event_id, service_description, amount, currency, status)
         VALUES ($1, $2, $3, 'Integration service quote', 1250.00, 'ETB', 'sent')`,
        [vendor.id, organizer.id, event.id],
      );
      await tx.query('INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')', [
        hashToken(token), vendorUser.id,
      ]);
      return {
        vendorUserId: vendorUser.id,
        organizerId: organizer.id,
        vendorId: vendor.id,
        categoryId: category.id,
        serviceId: service.id,
        eventId: event.id,
        bookingId: booking.id,
        reviewId: review.id,
        paymentId: payment.id,
        messageId: message.id,
        notificationId: notification.id,
        taskId: task.id,
      };
    });

    const app = createApp({
      database: {
        dialect: 'postgres',
        async query(sql, values = []) {
          try {
            return await database.runtimeAdapter.query(sql, values);
          } catch (error) {
            console.error('Neon vendor query failed:', sql, error.stack || error);
            throw error;
          }
        },
        inTransaction: (work) => database.inTransaction(work),
      },
      databaseDialect: 'postgres',
    });
    app.locals.platformSettingsCache = {
      values: { platform_status: 'open', maintenance_mode: false, maintenance_message: '' },
      expiresAt: Date.now() + 60_000,
    };
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = { Cookie: `platform_session=${token}` };
    const request = async (path, { method = 'GET', body, contentType = 'application/json' } = {}) => {
      const requestHeaders = { ...headers };
      if (contentType) requestHeaders['Content-Type'] = contentType;
      return fetch(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
      });
    };

    const dashboardPaths = [
      '/api/vendor/notifications', '/api/vendor/profile', '/api/vendor/overview',
      '/api/vendor/pricing', '/api/vendor/tasks', '/api/vendor/history',
      '/api/vendor/verification', '/api/vendor/services', '/api/vendor/messages',
      '/api/vendor/reports', '/api/vendor/categories', '/api/vendor/payments',
      '/api/vendor/account', '/api/vendor/packages', '/api/vendor/media',
      '/api/vendor/reviews', '/api/vendor/availability', '/api/vendor/booking-requests',
      '/api/vendor/bookings', '/api/vendor/quotations',
    ];
    for (const path of dashboardPaths) {
      const response = await request(path);
      assert.equal(response.status, 200, `${path} should execute against PostgreSQL`);
      assert.ok(Object.hasOwn(await response.json(), 'data'), `${path} should preserve its response envelope`);
    }

    const overview = await (await request('/api/vendor/overview')).json();
    assert.equal(overview.data.totalServices, 1);
    assert.equal(overview.data.totalBookings, 1);
    assert.equal(overview.data.totalEarnings, 1250);
    assert.equal(overview.data.unreadNotifications, 1);
    const services = await (await request('/api/vendor/services')).json();
    assert.equal(services.data[0].id, Number(fixture.serviceId));
    const payments = await (await request('/api/vendor/payments')).json();
    assert.equal(payments.data.transactions[0].status, 'paid');
    const messages = await (await request('/api/vendor/messages')).json();
    assert.equal(messages.data[0].body, 'Private vendor conversation');

    const verificationDocument = Buffer.from('%PDF-1.7\nPostgreSQL vendor verification fixture');
    const documentResponse = await request('/api/vendor/verification/documents?filename=proof.pdf', {
      method: 'POST', body: verificationDocument, contentType: 'application/pdf',
    });
    assert.equal(documentResponse.status, 201);
    const document = (await documentResponse.json()).data;
    const downloadedDocument = await request(`/api/vendor/verification/documents/${document.id}`);
    assert.equal(downloadedDocument.status, 200);
    assert.deepEqual(Buffer.from(await downloadedDocument.arrayBuffer()), verificationDocument);
    await database.runtimeAdapter.query(
      "UPDATE vendor_profiles SET verification_status = 'verified' WHERE id = $1",
      [fixture.vendorId],
    );

    const profilePatch = await request('/api/vendor/profile', {
      method: 'PATCH', body: { city: 'Bahir Dar', categoryId: Number(fixture.categoryId) },
    });
    assert.equal(profilePatch.status, 200);
    assert.equal((await (await request('/api/vendor/profile')).json()).data.serviceLocation, 'Bahir Dar');

    const taskUpdate = await request(`/api/vendor/tasks/${fixture.taskId}/status`, {
      method: 'PATCH', body: { status: 'completed' },
    });
    assert.equal(taskUpdate.status, 200);
    const messageRead = await request(`/api/vendor/messages/${fixture.messageId}/read`, { method: 'POST' });
    assert.equal(messageRead.status, 200);
    const notificationRead = await request(`/api/vendor/notifications/${fixture.notificationId}/read`, { method: 'POST' });
    assert.equal(notificationRead.status, 200);

    const serviceCreated = await request('/api/vendor/services', {
      method: 'POST',
      body: { title: 'Created integration service', categoryId: Number(fixture.categoryId), price: 99.5, currency: 'ETB', status: 'draft' },
    });
    assert.equal(serviceCreated.status, 201);
    const createdServiceId = (await serviceCreated.json()).data.id;
    const packageCreated = await request(`/api/vendor/services/${createdServiceId}/packages`, {
      method: 'POST', body: { name: 'Integration package', price: 100.25, currency: 'ETB' },
    });
    assert.equal(packageCreated.status, 201);
    const packageId = (await packageCreated.json()).data.id;
    assert.ok((await (await request('/api/vendor/packages')).json()).data.some((item) => item.id === packageId));
    assert.equal((await request(`/api/vendor/services/${createdServiceId}/packages/${packageId}`, {
      method: 'PATCH', body: { price: 125.75 },
    })).status, 200);
    assert.equal((await request(`/api/vendor/services/${createdServiceId}/packages/${packageId}`, {
      method: 'DELETE',
    })).status, 204);
    assert.equal((await request(`/api/vendor/services/${createdServiceId}`, { method: 'DELETE' })).status, 204);

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const photoSaved = await request('/api/platform/profile/photo', { method: 'PUT', body: png, contentType: 'image/png' });
    assert.equal(photoSaved.status, 200);
    const photoLoaded = await request('/api/platform/profile/photo');
    assert.equal(photoLoaded.status, 200);
    assert.deepEqual(Buffer.from(await photoLoaded.arrayBuffer()), png);
    assert.equal((await request('/api/platform/profile/photo', { method: 'DELETE', contentType: null })).status, 204);

    const persisted = await database.runtimeAdapter.query(
      'SELECT city FROM vendor_profiles WHERE id = $1',
      [fixture.vendorId],
    );
    assert.equal(persisted.rows[0].city, 'Bahir Dar');
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    if (fixture) {
      await database.inTransaction(async (tx) => {
        await tx.query(
          `DELETE FROM notification_history WHERE notification_id IN (
             SELECT id FROM notifications WHERE user_id = ANY($1::bigint[])
               OR related_entity_id = ANY($2::text[])
           )`,
          [
            [fixture.vendorUserId, fixture.organizerId],
            [String(fixture.eventId), String(fixture.bookingId), String(fixture.reviewId)],
          ],
        );
        await tx.query(
          `DELETE FROM notifications WHERE user_id = ANY($1::bigint[])
             OR related_entity_id = ANY($2::text[])`,
          [
            [fixture.vendorUserId, fixture.organizerId],
            [String(fixture.eventId), String(fixture.bookingId), String(fixture.reviewId)],
          ],
        );
        await tx.query(
          'DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])',
          [[fixture.vendorUserId, fixture.organizerId]],
        );
        await tx.query('DELETE FROM vendor_media WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM vendor_verification_documents WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM vendor_verification_history WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM notification_history WHERE actor_id = ANY($1::bigint[])', [[fixture.vendorUserId, fixture.organizerId]]);
        await tx.query('DELETE FROM event_vendor_tasks WHERE event_id = $1', [fixture.eventId]);
        await tx.query('DELETE FROM messages WHERE sender_id = ANY($1::bigint[]) OR recipient_id = ANY($1::bigint[])', [[fixture.vendorUserId, fixture.organizerId]]);
        await tx.query('DELETE FROM reviews WHERE booking_id = $1', [fixture.bookingId]);
        await tx.query('DELETE FROM payments WHERE booking_id = $1', [fixture.bookingId]);
        await tx.query('DELETE FROM booking_history WHERE booking_id = $1', [fixture.bookingId]);
        await tx.query('DELETE FROM bookings WHERE id = $1', [fixture.bookingId]);
        await tx.query('DELETE FROM quotations WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM vendor_availability WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM service_packages WHERE service_id IN (SELECT id FROM services WHERE vendor_id = $1)', [fixture.vendorId]);
        await tx.query('DELETE FROM services WHERE vendor_id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM events WHERE id = $1', [fixture.eventId]);
        await tx.query('DELETE FROM vendor_profiles WHERE id = $1', [fixture.vendorId]);
        await tx.query('DELETE FROM service_categories WHERE id = $1', [fixture.categoryId]);
        await tx.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [[fixture.vendorUserId, fixture.organizerId]]);
        await tx.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [[fixture.vendorUserId, fixture.organizerId]]);
      });
    }
    await database.close();
  }
});
