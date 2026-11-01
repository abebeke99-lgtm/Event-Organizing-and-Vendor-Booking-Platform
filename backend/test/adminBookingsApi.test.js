import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'admin-bookings-test-session';
const booking = {
  id: 21,
  event_id: 11,
  vendor_id: 8,
  service_id: 14,
  service_description: 'Photography',
  scheduled_date: '2030-07-14 16:00:00',
  quoted_amount: '500.00',
  currency: 'ETB',
  status: 'requested',
  moderation_reason: null,
  created_at: '2030-01-01 10:00:00',
  start_date: '2030-07-14 16:00:00',
  event_start_date: '2030-07-14 16:00:00',
  event_title: 'Wedding',
  event_city: 'Addis Ababa',
  event_venue: 'City Hall',
  customer_id: 44,
  customer_name: 'Event Customer',
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

function createDatabase() {
  const statements = [];
  let currentBooking = { ...booking };
  let insideCutoff = false;
  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: 1,
        full_name: 'Platform Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : []];
    }
    if (sql.startsWith('SELECT ? <= DATE_ADD(NOW(), INTERVAL ? HOUR)')) {
      return [[{ inside_cutoff: insideCutoff }]];
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM bookings b')) return [[{ total: 1 }]];
    if (sql.startsWith('SELECT b.id FROM bookings b')) return [[]];
    if (sql.startsWith('SELECT id FROM vendor_profiles')) return [[{ id: 8 }]];
    if (sql.startsWith('SELECT status, note FROM vendor_availability')) return [[]];
    if (sql.startsWith('SELECT b.id, b.event_id, b.vendor_id, b.service_id')) return [[currentBooking]];
    if (sql.startsWith("UPDATE bookings SET status = 'accepted'")) {
      currentBooking = { ...currentBooking, status: 'accepted', scheduled_date: values[0] };
    } else if (sql.startsWith('UPDATE bookings SET status = ?')) {
      currentBooking = { ...currentBooking, status: values[0] };
    }
    return [[]];
  }
  return {
    statements,
    resetBooking() { currentBooking = { ...booking }; },
    setBooking(values) { currentBooking = { ...booking, ...values }; },
    setInsideCutoff(value) { insideCutoff = value; },
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
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('administrator booking routes require an authenticated administrator', async () => {
  const response = await fetch(`${baseUrl}/api/admin/bookings`);
  assert.equal(response.status, 401);
});

test('administrator booking list supports category, status, date, and search filters', async () => {
  const response = await adminRequest('/api/admin/bookings?q=BK-000021&status=requested&categoryId=3&dateFrom=2030-07-01&dateTo=2030-07-30&sortBy=scheduled_date&sortDirection=asc');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].reference, 'BK-000021');
  assert.equal(result.data[0].payment_status, 'unpaid');
  assert.equal(result.data[0].can_complete, false);
  assert.equal(result.pagination.total, 1);
  const listQuery = database.statements.find(({ sql }) => sql.startsWith('SELECT b.id, b.event_id, b.vendor_id, b.service_id'));
  assert.match(listQuery.sql, /b\.status = \?/);
  assert.match(listQuery.sql, /COALESCE\(s\.category_id, vp\.category_id\) = \?/);
  assert.match(listQuery.sql, /DATE\(COALESCE\(b\.scheduled_date, e\.start_date\)\) >= \?/);
  assert.ok(listQuery.values.some((value) => String(value) === '000021'));
  assert.ok(listQuery.values.includes(3));
});

test('administrator cannot complete an accepted booking before its scheduled date', async () => {
  database.setBooking({ status: 'accepted' });
  const updatesBefore = database.statements.filter(({ sql }) => sql.startsWith('UPDATE bookings SET status = ?')).length;
  try {
    const response = await adminRequest('/api/admin/bookings/21/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /before its scheduled date/i);
    const updatesAfter = database.statements.filter(({ sql }) => sql.startsWith('UPDATE bookings SET status = ?')).length;
    assert.equal(updatesAfter, updatesBefore);
  } finally {
    database.resetBooking();
  }
});

test('administrator booking list rejects invalid status filters', async () => {
  const response = await adminRequest('/api/admin/bookings?status=unknown');
  assert.equal(response.status, 400);
});

test('administrator confirms only after availability validation and requires cancellation reasons', async () => {
  const missingReason = await adminRequest('/api/admin/bookings/21/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  assert.equal(missingReason.status, 400);

  const confirmed = await adminRequest('/api/admin/bookings/21/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(confirmed.status, 200);
  assert.match(database.statements.find(({ sql }) => sql.startsWith('SELECT status, note FROM vendor_availability')).sql, /FOR UPDATE/);
  assert.ok(database.statements.some(({ sql }) => sql.includes("INSERT INTO vendor_availability (vendor_id, available_date, status, note)")));

  const cancelled = await adminRequest('/api/admin/bookings/21/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled', reason: 'Customer requested cancellation' }),
  });
  assert.equal(cancelled.status, 200);
  assert.ok(database.statements.some(({ sql }) => sql.includes("INSERT INTO booking_history")));
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO notifications')));
  database.resetBooking();
});

test('administrator cancellations respect the configured cutoff', async () => {
  database.setInsideCutoff(true);
  const updatesBefore = database.statements.filter(({ sql }) => sql.startsWith('UPDATE bookings SET status = ?')).length;
  try {
    const response = await adminRequest('/api/admin/bookings/21/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', reason: 'Customer requested cancellation' }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /cancellation cutoff/i);
    const updatesAfter = database.statements.filter(({ sql }) => sql.startsWith('UPDATE bookings SET status = ?')).length;
    assert.equal(updatesAfter, updatesBefore);
  } finally {
    database.setInsideCutoff(false);
  }
});

test('administrator can inspect payment/history records and export filtered reports', async () => {
  const details = await adminRequest('/api/admin/bookings/21');
  assert.equal(details.status, 200);
  const result = await details.json();
  assert.equal(result.data.reference, 'BK-000021');
  assert.deepEqual(result.data.payments, []);
  assert.deepEqual(result.data.refunds, []);
  assert.deepEqual(result.data.history, []);

  const exported = await adminRequest('/api/admin/bookings/export?status=requested');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  assert.match(await exported.text(), /BK-000021/);
});

test('administrator rescheduling requires a reason and writes booking history', async () => {
  const date = new Date(Date.now() + (500 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 16);
  const response = await adminRequest('/api/admin/bookings/21/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduled_date: date, reason: 'Venue availability changed' }),
  });
  assert.equal(response.status, 200);
  assert.ok(database.statements.some(({ sql }) => sql.includes("'rescheduled'")));
  assert.ok(database.statements.some(({ sql }) => sql.includes('INSERT INTO notifications')));
  database.resetBooking();
});
