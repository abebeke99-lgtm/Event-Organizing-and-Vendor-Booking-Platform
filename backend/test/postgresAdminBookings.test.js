import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import test from 'node:test';
import { createPostgresAdminBookingsRouter } from '../src/routes/postgresAdminBookings.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const sampleBooking = {
  id: 21,
  event_id: 11,
  vendor_id: 8,
  service_id: 14,
  service_description: 'Photography',
  scheduled_date: '2035-07-14 16:00:00',
  quoted_amount: '500.00',
  currency: 'ETB',
  status: 'requested',
  moderation_reason: null,
  created_at: '2035-01-01 10:00:00',
  start_date: '2035-07-14 16:00:00',
  event_start_date: '2035-07-14 16:00:00',
  event_title: 'Wedding',
  event_type: 'Wedding',
  event_city: 'Addis Ababa',
  event_venue: 'City Hall',
  customer_id: 44,
  customer_name: '=1+1',
  customer_email: 'customer@example.test',
  customer_phone: null,
  vendor_name: 'Bright Photos',
  vendor_user_id: 55,
  vendor_contact_name: 'Vendor Owner',
  vendor_email: 'vendor@example.test',
  vendor_phone: null,
  service_title: 'Photography',
  category_id: 3,
  category_name: 'Photography',
  payment_status: null,
  payment_count: 0,
};

function createHarness(database, { authorized = true, actorId = 99 } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { permissions: authorized ? ['admin:*'] : [] };
    req.admin = { id: actorId };
    next();
  });
  app.use('/api/admin', createPostgresAdminBookingsRouter({ database }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({
      error: error.expose ? error.message : 'Internal server error.',
      code: error.expose ? undefined : error.code || null,
    });
  });
  const server = app.listen(0, '127.0.0.1');
  return {
    server,
    async start() {
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}/api/admin`;
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

function createFakeDatabase() {
  const statements = [];
  let booking = { ...sampleBooking };
  let conflict = false;
  let settings = [];
  const database = {
    dialect: 'postgres',
    statements,
    setBooking(values) { booking = { ...booking, ...values }; },
    setConflict(value) { conflict = value; },
    setSettings(rows) { settings = rows; },
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('SELECT COUNT(*) AS total')) return { rows: [{ total: 1 }] };
      if (sql.includes('FROM bookings b') && sql.includes('FOR UPDATE OF b')) return { rows: [{ ...booking }] };
      if (sql.startsWith('SELECT id FROM vendor_profiles')) return { rows: [{ id: booking.vendor_id }] };
      if (sql.includes('FROM vendor_availability') && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('SELECT b.id FROM bookings b') && sql.includes('LIMIT 1')) {
        return { rows: conflict ? [{ id: 81 }] : [] };
      }
      if (sql.includes('FROM system_settings')) return { rows: settings };
      if (sql.includes('FROM bookings b')) return { rows: [{ ...booking }] };
      if (sql.includes('FROM payments') && sql.includes('WHERE booking_id')) return { rows: [] };
      if (sql.includes('FROM refund_requests')) return { rows: [] };
      if (sql.includes('FROM booking_history')) return { rows: [] };
      if (sql.includes('INSERT INTO notifications') && sql.includes('RETURNING id')) return { rows: [{ id: 1 }] };
      if (sql.startsWith('UPDATE bookings SET status')) booking.status = values[0];
      return { rows: [], rowCount: 1 };
    },
    async inTransaction(work) {
      statements.push({ sql: 'BEGIN', values: [] });
      try {
        const result = await work(database);
        statements.push({ sql: 'COMMIT', values: [] });
        return result;
      } catch (error) {
        statements.push({ sql: 'ROLLBACK', values: [] });
        throw error;
      }
    },
  };
  return database;
}

test('PostgreSQL admin booking API enforces access and returns filtered paginated data', async () => {
  const database = createFakeDatabase();
  const unauthorized = createHarness(database, { authorized: false });
  const unauthorizedBase = await unauthorized.start();
  try {
    const response = await fetch(`${unauthorizedBase}/bookings`);
    assert.equal(response.status, 403);
  } finally {
    await unauthorized.stop();
  }

  const harness = createHarness(database);
  const base = await harness.start();
  try {
    const response = await fetch(`${base}/bookings?q=BK-000021&status=requested&categoryId=3&dateFrom=2035-07-01&dateTo=2035-07-30&sortBy=scheduled_date&sortDirection=asc&page=2&pageSize=5`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data[0].reference, 'BK-000021');
    assert.equal(result.data[0].payment_status, 'unpaid');
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.pageSize, 5);
    assert.equal(result.pagination.total, 1);
    const listQuery = database.statements.find(({ sql }) => sql.includes('COALESCE(s.category_id, vp.category_id)') && sql.includes('LIMIT $'));
    assert.match(listQuery.sql, /b\.status = \$\d+/);
    assert.match(listQuery.sql, /::date >= \$\d+::date/);
    assert.ok(listQuery.values.includes(3));
    assert.ok(listQuery.values.includes('21'));
    assert.ok(listQuery.sql.includes('OFFSET $'));
  } finally {
    await harness.stop();
  }
});

test('PostgreSQL admin booking detail and CSV export retain contract and prevent formula injection', async () => {
  const database = createFakeDatabase();
  const harness = createHarness(database);
  const base = await harness.start();
  try {
    const details = await fetch(`${base}/bookings/21`);
    assert.equal(details.status, 200);
    const result = await details.json();
    assert.equal(result.data.reference, 'BK-000021');
    assert.deepEqual(result.data.payments, []);
    assert.deepEqual(result.data.refunds, []);
    assert.deepEqual(result.data.history, []);

    const exported = await fetch(`${base}/bookings/export?status=requested`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /text\/csv/);
    assert.match(await exported.text(), /"'=1\+1"/);

    const invalidSort = await fetch(`${base}/bookings?sortBy=created_at;DROP%20TABLE%20bookings`);
    assert.equal(invalidSort.status, 400);
  } finally {
    await harness.stop();
  }
});

test('PostgreSQL admin booking mutations validate transitions and check availability before confirmation', async () => {
  const database = createFakeDatabase();
  const harness = createHarness(database);
  const base = await harness.start();
  try {
    const invalid = await fetch(`${base}/bookings/21/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    assert.equal(invalid.status, 409);
    assert.equal(database.statements.some(({ sql }) => sql.startsWith('UPDATE bookings')), false);

    database.setConflict(true);
    const unavailable = await fetch(`${base}/bookings/21/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    assert.equal(unavailable.status, 409);
    assert.match((await unavailable.json()).error, /confirmed booking/i);
    assert.equal(database.statements.some(({ sql }) => sql.startsWith('UPDATE bookings')), false);
    assert.ok(database.statements.some(({ sql }) => sql === 'ROLLBACK'));

    database.setBooking({ status: 'accepted' });
    const newDate = new Date(Date.now() + (500 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16);
    const blockedReschedule = await fetch(`${base}/bookings/21/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_date: newDate, reason: 'Venue availability changed' }),
    });
    assert.equal(blockedReschedule.status, 409);
    assert.equal(database.statements.some(({ sql }) => sql.startsWith('UPDATE bookings SET scheduled_date')), false);

    database.setBooking({
      status: 'requested',
      scheduled_date: new Date(Date.now() + (10 * 60 * 60 * 1000)),
      start_date: new Date(Date.now() + (10 * 60 * 60 * 1000)),
    });
    database.setSettings([{ setting_key: 'booking_cancellation_cutoff_hours', setting_value: '24' }]);
    const insideCutoff = await fetch(`${base}/bookings/21/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', reason: 'Customer requested cancellation' }),
    });
    assert.equal(insideCutoff.status, 409);
    assert.match((await insideCutoff.json()).error, /cancellation cutoff/i);
  } finally {
    await harness.stop();
  }
});

test('Neon admin booking list, detail, export, transitions, rescheduling, and availability integration', {
  skip: process.env.RUN_NEON_INTEGRATION === 'true' ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const adminEmail = `booking-admin-${suffix}@example.invalid`;
  const customerEmail = `booking-customer-${suffix}@example.invalid`;
  const vendorEmail = `booking-vendor-${suffix}@example.invalid`;
  const categoryName = `Booking Category ${suffix}`;
  let adminId;
  let customerId;
  let vendorUserId;
  let vendorId;
  let categoryId;
  let eventId;
  let serviceId;
  let bookingId;
  let paymentId;
  let refundId;
  let adminRoleId;
  let harness;

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.equal(identity.database_name, 'eventhub');
    await database.inTransaction(async (tx) => {
      adminRoleId = (await tx.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary admin booking integration role', TRUE, TRUE) RETURNING id`,
        [`booking-admin-${suffix}`],
      )).rows[0].id;
      adminId = (await tx.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Booking Integration Admin', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [adminEmail],
      )).rows[0].id;
      await tx.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [adminId, adminRoleId]);
      customerId = (await tx.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Booking Integration Customer', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [customerEmail],
      )).rows[0].id;
      vendorUserId = (await tx.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Booking Integration Vendor', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [vendorEmail],
      )).rows[0].id;
      categoryId = (await tx.query(
        `INSERT INTO service_categories (name, description, is_active)
         VALUES ($1, 'Temporary booking integration category', TRUE) RETURNING id`,
        [categoryName],
      )).rows[0].id;
      vendorId = (await tx.query(
        `INSERT INTO vendor_profiles (user_id, business_name, category_id, verification_status)
         VALUES ($1, $2, $3, 'verified') RETURNING id`,
        [vendorUserId, `Integration Vendor ${suffix}`, categoryId],
      )).rows[0].id;
      eventId = (await tx.query(
        `INSERT INTO events (organizer_id, title, event_type, start_date, status)
         VALUES ($1, $2, 'Integration Event', NOW() + INTERVAL '15 years', 'active') RETURNING id`,
        [customerId, `Booking Integration Event ${suffix}`],
      )).rows[0].id;
      serviceId = (await tx.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
         VALUES ($1, $2, 'Integration Photography', 'Temporary service', 500, 'ETB', 'active') RETURNING id`,
        [vendorId, categoryId],
      )).rows[0].id;
      bookingId = (await tx.query(
        `INSERT INTO bookings (event_id, vendor_id, service_id, scheduled_date, service_description, quoted_amount, currency, status)
         SELECT $1, $2, $3, start_date, 'Integration Photography', 500, 'ETB', 'requested'
         FROM events WHERE id = $1 RETURNING id`,
        [eventId, vendorId, serviceId],
      )).rows[0].id;
      paymentId = (await tx.query(
        `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status, verified_at)
         VALUES ($1, 500, 'ETB', 'integration', $2, 'paid', NOW()) RETURNING id`,
        [bookingId, `integration-${suffix}`],
      )).rows[0].id;
      refundId = (await tx.query(
        `INSERT INTO refund_requests
           (payment_id, requester_id, amount, currency, reason, status, idempotency_key)
         VALUES ($1, $2, 500, 'ETB', 'Integration refund was not accepted by a provider', 'failed', $3)
         RETURNING id`,
        [paymentId, customerId, `integration-${suffix}`],
      )).rows[0].id;
    });

    harness = createHarness(database.runtimeAdapter, { actorId: Number(adminId) });
    const base = await harness.start();
    const request = (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const list = await request(`/bookings?q=BK-${String(bookingId).padStart(6, '0')}&categoryId=${categoryId}&paymentStatus=paid&page=1&pageSize=1`);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(Number(listBody.pagination.total), 1);
    assert.equal(listBody.data[0].reference, `BK-${String(bookingId).padStart(6, '0')}`);

    const details = await request(`/bookings/${bookingId}`);
    assert.equal(details.status, 200);
    const detail = (await details.json()).data;
    assert.equal(Number(detail.payments[0].id), Number(paymentId));
    assert.equal(Number(detail.refunds[0].id), Number(refundId));

    const csv = await request(`/bookings/export?categoryId=${categoryId}`);
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), new RegExp(`BK-${String(bookingId).padStart(6, '0')}`));

    const accept = await request(`/bookings/${bookingId}/status`, {
      method: 'PATCH', body: { status: 'accepted' },
    });
    assert.equal(accept.status, 200, JSON.stringify(await accept.json()));
    const reservationDate = new Date(Date.now() + (16 * 365 * 24 * 60 * 60 * 1000));
    const newScheduledDate = new Date(reservationDate.getTime() + (24 * 60 * 60 * 1000));
    const toLocalInput = (date) => {
      const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
      return local.toISOString().slice(0, 16);
    };
    const reschedule = await request(`/bookings/${bookingId}/reschedule`, {
      method: 'POST',
      body: { scheduled_date: toLocalInput(newScheduledDate), reason: 'Integration schedule change' },
    });
    assert.equal(reschedule.status, 200);
    const cancellation = await request(`/bookings/${bookingId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', reason: 'Integration cancellation' },
    });
    assert.equal(cancellation.status, 200);
    const history = await database.runtimeAdapter.query(
      'SELECT action FROM booking_history WHERE booking_id = $1 ORDER BY id',
      [bookingId],
    );
    assert.deepEqual(history.rows.map(({ action }) => action), ['status_changed', 'rescheduled', 'status_changed']);
    const remainingReservation = await database.runtimeAdapter.query(
      `SELECT status, note FROM vendor_availability
       WHERE vendor_id = $1 AND note = $2`,
      [vendorId, `Booking #${bookingId}`],
    );
    assert.equal(remainingReservation.rows.length, 0);
  } finally {
    if (harness) await harness.stop();
    if (bookingId) {
      await database.inTransaction(async (tx) => {
        await tx.query(
          `DELETE FROM notification_history WHERE notification_id IN
             (SELECT id FROM notifications WHERE related_entity_type = 'booking' AND related_entity_id = $1)`,
          [String(bookingId)],
        );
        await tx.query(
          "DELETE FROM notifications WHERE related_entity_type = 'booking' AND related_entity_id = $1",
          [String(bookingId)],
        );
        await tx.query("DELETE FROM audit_logs WHERE entity_type = 'booking' AND entity_id = $1", [String(bookingId)]);
        await tx.query('DELETE FROM booking_history WHERE booking_id = $1', [bookingId]);
        if (refundId) await tx.query('DELETE FROM refund_requests WHERE id = $1', [refundId]);
        if (paymentId) {
          await tx.query('DELETE FROM payment_history WHERE payment_id = $1', [paymentId]);
          await tx.query('DELETE FROM payments WHERE id = $1', [paymentId]);
        }
        await tx.query('DELETE FROM vendor_availability WHERE vendor_id = $1', [vendorId]);
        await tx.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
        await tx.query('DELETE FROM services WHERE id = $1', [serviceId]);
        await tx.query('DELETE FROM events WHERE id = $1', [eventId]);
        await tx.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
        await tx.query('DELETE FROM user_roles WHERE user_id = $1', [adminId]);
        await tx.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
        await tx.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [[adminId, customerId, vendorUserId]]);
        await tx.query('DELETE FROM roles WHERE id = $1', [adminRoleId]);
      });
    }
  }
});
