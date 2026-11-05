import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const sessionToken = 'customer-bookings-test-session';
const customer = {
  id: 21,
  full_name: 'Booking Customer',
  email: 'booking-customer@example.test',
  phone: null,
  preferred_language: 'en',
  status: 'active',
  role: 'customer',
};
const bookingRow = {
  id: 21,
  event_id: 11,
  vendor_id: 8,
  service_id: 14,
  service_description: 'Full-day photography',
  service_title: 'Wedding Photography',
  scheduled_date: '2099-07-14 16:00:00',
  quoted_amount: '500.00',
  currency: 'ETB',
  status: 'requested',
  moderation_reason: null,
  created_at: '2099-01-01 10:00:00',
  event_start_date: '2099-07-14 15:00:00',
  event_title: 'Wedding',
  event_city: 'Addis Ababa',
  event_venue: 'City Hall',
  customer_name: customer.full_name,
  vendor_name: 'Bright Photos',
  payment_status: 'pending',
  can_cancel: 1,
  can_reschedule: 1,
};
const historicalRows = Array.from({ length: 12 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0');
  const status = ['completed', 'cancelled', 'rejected', 'accepted', 'quoted', 'under_review', 'requested'][index % 7];
  return {
    ...bookingRow,
    id: 21 + index,
    status,
    event_start_date: `2020-01-${day} 16:00:00`,
    scheduled_date: `2020-01-${day} 16:00:00`,
    event_title: `History Event ${index + 1}`,
    vendor_name: `History Vendor ${index + 1}`,
    service_title: `History Service ${index + 1}`,
    quoted_amount: String(100 + index),
    payment_status: index % 2 ? 'paid' : 'refunded',
    can_review: status === 'completed' && index !== 0 ? 1 : 0,
    has_review: status === 'completed' && index === 0 ? 1 : 0,
  };
});

function filterHistoricalRows(sql, values) {
  let valueIndex = 1;
  let rows = historicalRows;
  if (sql.includes('b.status = ?')) {
    const status = values[valueIndex++];
    rows = rows.filter((row) => row.status === status);
  }
  if (sql.includes('e.start_date >= ?')) {
    const dateFrom = String(values[valueIndex++]);
    rows = rows.filter((row) => row.event_start_date.slice(0, 10) >= dateFrom);
  }
  if (sql.includes('e.start_date < DATE_ADD(?, INTERVAL 1 DAY)')) {
    const dateTo = String(values[valueIndex++]);
    rows = rows.filter((row) => row.event_start_date.slice(0, 10) <= dateTo);
  }
  if (sql.includes("CONCAT('BK-', LPAD(b.id, 6, '0'))")) {
    const search = String(values[valueIndex]).replaceAll('%', '').toLowerCase();
    rows = rows.filter((row) => [
      `BK-${String(row.id).padStart(6, '0')}`,
      String(row.id),
      row.vendor_name,
      row.service_title,
      row.event_title,
    ].some((value) => value.toLowerCase().includes(search)));
  }
  return rows;
}

function createDatabase() {
  const statements = [];
  let bookingStatus = 'requested';
  let insideCutoff = false;
  let reschedulingEnabled = true;
  let ownerId = 21;
  let committed = false;
  let rolledBack = false;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM user_sessions s')) {
      return [values[0] === hashToken(sessionToken) ? [{ ...customer, permission_keys: '' }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total') && sql.includes('FROM bookings b')) {
      return [[{ total: filterHistoricalRows(sql, values).length }], []];
    }
    if (sql.includes('ORDER BY COALESCE(b.scheduled_date, e.start_date) DESC')) {
      const filtered = filterHistoricalRows(sql, values);
      const limit = Number(values.at(-2));
      const offset = Number(values.at(-1));
      return [filtered.slice().reverse().slice(offset, offset + limit), []];
    }
    if (sql.trimStart().startsWith('SELECT b.id, b.event_id, b.vendor_id, b.service_description')) {
      const requestedOwner = Number(values[0]);
      const requestedId = values[1] == null ? null : Number(values[1]);
      return [[requestedOwner === ownerId && (requestedId == null || requestedId === bookingRow.id) ? { ...bookingRow } : {}]
        .filter((row) => row.id), []];
    }
    if (sql.startsWith('SELECT b.id, b.status, b.vendor_id, b.scheduled_date')
      && sql.includes('WHERE b.id = ? LIMIT 1 FOR UPDATE')) {
      return [[{
        ...bookingRow,
        status: bookingStatus,
        start_date: bookingRow.event_start_date,
        organizer_id: ownerId,
        vendor_user_id: 88,
        vendor_verification_status: 'verified',
      }], []];
    }
    if (sql.startsWith('SELECT b.id, b.status, b.vendor_id, b.scheduled_date')) {
      const requestedId = Number(values[0]);
      const requestedOwner = Number(values[1]);
      return [[requestedId === bookingRow.id && requestedOwner === ownerId
        ? { ...bookingRow, status: bookingStatus, start_date: bookingRow.event_start_date, organizer_id: ownerId, vendor_user_id: 88 }
        : {}].filter((row) => row.id), []];
    }
    if (sql.startsWith('SELECT id FROM vendor_profiles WHERE id = ? FOR UPDATE')) return [[{ id: 8 }], []];
    if (sql.startsWith('SELECT setting_key, setting_value FROM system_settings')) {
      return [[
        { setting_key: 'booking_rescheduling_enabled', setting_value: reschedulingEnabled ? 'true' : 'false' },
        { setting_key: 'booking_reschedule_cutoff_hours', setting_value: '24' },
      ], []];
    }
    if (sql.startsWith('SELECT ? <= NOW() AS booking_in_past')) {
      const previousDate = String(values[0]).replace('T', ' ').slice(0, 19);
      const requestedDate = String(values[2]).replace('T', ' ').slice(0, 19);
      return [[{
        booking_in_past: false,
        same_datetime: previousDate === requestedDate,
        same_day: previousDate.slice(0, 10) === String(values[4]).slice(0, 10),
      }], []];
    }
    if (sql.startsWith('SELECT ? <= DATE_ADD(NOW(), INTERVAL ? HOUR)')) return [[{ inside_cutoff: insideCutoff }], []];
    if (sql.startsWith('SELECT status, note FROM vendor_availability')) return [[], []];
    if (sql.startsWith('SELECT b.id FROM bookings b')) return [[], []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ insertId: 7, affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  }

  return {
    statements,
    setBookingStatus(status) { bookingStatus = status; },
    setInsideCutoff(value) { insideCutoff = value; },
    setReschedulingEnabled(value) { reschedulingEnabled = value; },
    setOwnerId(value) { ownerId = value; },
    resetTransactionState() { committed = false; rolledBack = false; },
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async execute(...args) { return execute(...args); },
    async query() { return [[], []]; },
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() { committed = true; },
        async rollback() { rolledBack = true; },
        release() {},
      };
    },
  };
}

const database = createDatabase();
const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60000,
};
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

function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = {};
  if (authenticated) headers.Cookie = `platform_session=${sessionToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

test('customer bookings list returns booking fields scoped to the logged-in customer', async () => {
  const response = await request('/api/customer/bookings');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].reference, 'BK-000021');
  assert.equal(result.data[0].vendorName, 'Bright Photos');
  assert.equal(result.data[0].serviceTitle, 'Wedding Photography');
  assert.equal(result.data[0].location, 'City Hall, Addis Ababa');
  assert.equal(result.data[0].paymentStatus, 'pending');
  assert.equal(result.data[0].canCancel, true);
  assert.equal(result.data[0].canReschedule, true);
  assert.match(database.statements.find(({ sql }) => sql.includes('LEFT JOIN services s')).sql, /e\.organizer_id = \?/);
});

test('booking detail is available only to its owning customer', async () => {
  const ownResponse = await request('/api/customer/bookings/21');
  assert.equal(ownResponse.status, 200);
  assert.equal((await ownResponse.json()).data.id, 21);

  database.setOwnerId(99);
  const otherResponse = await request('/api/customer/bookings/21');
  assert.equal(otherResponse.status, 404);
  assert.deepEqual((await otherResponse.json()).error, 'Booking not found.');
  database.setOwnerId(21);
});

test('booking detail and rescheduling require a customer session and valid input', async () => {
  assert.equal((await request('/api/customer/bookings/21', { authenticated: false })).status, 401);
  const invalidDate = await request('/api/customer/bookings/21/reschedule', {
    method: 'PATCH',
    body: { scheduledDate: '2099-02-31T14:00', reason: 'Scheduling conflict' },
  });
  assert.equal(invalidDate.status, 400);
  const pastDate = await request('/api/customer/bookings/21/reschedule', {
    method: 'PATCH',
    body: { scheduledDate: '2000-02-01T14:00', reason: 'Scheduling conflict' },
  });
  assert.equal(pastDate.status, 400);
});

test('a customer cannot cancel another customer booking through the platform status endpoint', async () => {
  database.setOwnerId(99);
  const response = await request('/api/platform/bookings/21/status', {
    method: 'PATCH',
    body: { status: 'cancelled' },
  });
  assert.equal(response.status, 403);
  assert.equal(database.statements.some(({ sql }) => sql.startsWith('UPDATE bookings SET status = ?')), false);
  database.setOwnerId(21);
});

test('customer rescheduling enforces ownership, status, policy, and cutoff rules', async () => {
  const body = { scheduledDate: '2099-08-14T16:00', reason: 'Our event plans changed' };
  database.setBookingStatus('completed');
  assert.equal((await request('/api/customer/bookings/21/reschedule', { method: 'PATCH', body })).status, 409);

  database.setBookingStatus('requested');
  database.setReschedulingEnabled(false);
  assert.equal((await request('/api/customer/bookings/21/reschedule', { method: 'PATCH', body })).status, 409);

  database.setReschedulingEnabled(true);
  database.setInsideCutoff(true);
  assert.equal((await request('/api/customer/bookings/21/reschedule', { method: 'PATCH', body })).status, 409);

  database.setInsideCutoff(false);
  database.setOwnerId(99);
  assert.equal((await request('/api/customer/bookings/21/reschedule', { method: 'PATCH', body })).status, 404);
  database.setOwnerId(21);
});

test('customer rescheduling updates and audits the booking in a transaction', async () => {
  database.setBookingStatus('requested');
  database.setInsideCutoff(false);
  database.setReschedulingEnabled(true);
  database.resetTransactionState();
  const response = await request('/api/customer/bookings/21/reschedule', {
    method: 'PATCH',
    body: { scheduledDate: '2099-08-14T16:00', reason: 'Our event plans changed' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    id: 21,
    scheduled_date: '2099-08-14 16:00:00',
    status: 'requested',
  });
  assert.equal(database.committed, true);
  assert.equal(database.rolledBack, false);
  assert.ok(database.statements.some(({ sql }) => sql.includes("action = 'rescheduled'") || sql.includes("'rescheduled'")));
  assert.ok(database.statements.some(({ values }) => values.includes('customer.booking_rescheduled')));
});

test('accepted rescheduling preserves same-day availability and releases a changed day', async () => {
  database.setBookingStatus('accepted');
  database.setInsideCutoff(false);
  database.setReschedulingEnabled(true);
  database.resetTransactionState();
  const sameDayResponse = await request('/api/customer/bookings/21/reschedule', {
    method: 'PATCH',
    body: { scheduledDate: '2099-07-14T18:00', reason: 'The service time has changed' },
  });
  assert.equal(sameDayResponse.status, 200);
  assert.ok(database.statements.some(({ sql }) => sql.startsWith("INSERT INTO vendor_availability")));
  assert.equal(database.statements.some(({ sql }) => sql.includes("SET status = 'available'")), false);

  database.statements.length = 0;
  database.resetTransactionState();
  const changedDayResponse = await request('/api/customer/bookings/21/reschedule', {
    method: 'PATCH',
    body: { scheduledDate: '2099-08-14T16:00', reason: 'The event date has changed' },
  });
  assert.equal(changedDayResponse.status, 200);
  assert.ok(database.statements.some(({ sql }) => sql.includes("SET status = 'available'")));
  database.setBookingStatus('requested');
});

test('customer history filters historical statuses and paginates only owned records', async () => {
  const response = await request('/api/customer/history?page=2&limit=5');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
  assert.deepEqual(result.data.map((booking) => booking.id), [27, 26, 25, 24, 23]);
  assert.equal(result.data[0].paymentStatus, 'refunded');
  assert.ok(database.statements.some(({ sql, values }) => sql.includes('e.organizer_id = ?') && Number(values[0]) === customer.id));
});

test('customer history applies status, date, and search filters and exposes review eligibility', async () => {
  const response = await request('/api/customer/history?status=accepted&dateFrom=2020-01-04&dateTo=2020-01-04&search=History%20Vendor%204');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pagination.total, 1);
  assert.equal(result.data[0].id, 24);
  assert.equal(result.data[0].status, 'accepted');

  const completed = await request('/api/customer/history?status=completed');
  const completedResult = await completed.json();
  assert.equal(completedResult.data.some((booking) => booking.id === 28 && booking.canReview), true);
  assert.equal(completedResult.data.some((booking) => booking.id === 21 && booking.hasReview && !booking.canReview), true);
});

test('customer history rejects invalid status, dates, and date ranges', async () => {
  assert.equal((await request('/api/customer/history?status=pending')).status, 400);
  assert.equal((await request('/api/customer/history?dateFrom=2020-02-31')).status, 400);
  assert.equal((await request('/api/customer/history?dateFrom=2020-02-10&dateTo=2020-02-01')).status, 400);
  assert.equal((await request('/api/customer/history', { authenticated: false })).status, 401);
});
