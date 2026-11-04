import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { isEventOpenForBookings, parseAdminEventInput } from '../src/lib/adminEvents.js';

const adminToken = 'admin-events-test-session';
const adminId = 1;
const organizer = { id: 44, full_name: 'Event Organizer', email: 'organizer@example.test' };
const eventRecord = (overrides = {}) => ({
  id: 11,
  organizer_id: 77,
  title: 'Review Event',
  event_type: 'Music',
  description: 'Live performances',
  city: 'Addis Ababa',
  venue: 'City Hall',
  cover_image_url: 'https://example.test/cover.jpg',
  gallery_images: '["https://example.test/gallery.jpg"]',
  start_date: '2030-07-14 16:00:00',
  end_date: '2030-07-14 20:00:00',
  budget: '1000.00',
  capacity: 200,
  guest_count: 150,
  status: 'pending_approval',
  rejection_reason: null,
  published_at: null,
  notes: null,
  created_at: '2030-01-01 10:00:00',
  organizer_name: 'Existing Organizer',
  organizer_email: 'existing@example.test',
  ...overrides,
});

function createDatabase() {
  const events = new Map([
    [11, eventRecord()],
    [12, eventRecord({ id: 12, status: 'draft', organizer_id: 77, title: 'Draft Event' })],
    [13, eventRecord({ id: 13, status: 'active', organizer_id: 78, title: 'Booked Event' })],
  ]);
  const bookings = new Map([[13, [{
    id: 51,
    event_id: 13,
    vendor_id: 9,
    service_description: 'Catering',
    quoted_amount: '500.00',
    currency: 'ETB',
    status: 'accepted',
    vendor_name: 'Good Food',
    vendor_contact: 'Vendor Owner',
    category: 'Catering',
  }]]]);
  const ticketBookings = new Map([[13, [{
    id: 61,
    booking_reference: 'EVT-ABC123',
    customer_id: 90,
    customer_name: 'Ticket Customer',
    customer_email: 'ticket-customer@example.test',
    ticket_name: 'General admission',
    quantity: 2,
    unit_price: '20.00',
    total_amount: '40.00',
    payment_status: 'paid',
    booking_status: 'confirmed',
    created_at: '2030-07-01 10:00:00',
  }]]]);
  const notifications = [];
  const history = [];
  const audit = [];
  const statements = [];
  let nextId = 30;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: adminId,
        full_name: 'Platform Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : [], []];
    }
    if (sql.startsWith('SELECT DISTINCT u.id, u.full_name, u.email')) return [[organizer], []];
    if (sql.startsWith('SELECT id, name FROM service_categories')) return [[{ id: 1, name: 'Music' }, { id: 2, name: 'Catering' }], []];
    if (sql.startsWith('SELECT COUNT(*) AS total FROM events e')) return [[{ total: events.size }], []];
    if (sql.startsWith('SELECT e.id, e.organizer_id, e.title')) {
      return [[...events.values()].map((event) => ({
        ...event,
        booking_count: (bookings.get(event.id) || []).length,
        vendor_booking_count: (bookings.get(event.id) || []).length,
        ticket_booking_count: 0,
        vendor_names: (bookings.get(event.id) || []).map((booking) => booking.vendor_name).join(', ') || null,
      })), []];
    }
    if (sql.includes('SELECT u.id FROM users u') && sql.includes("LOWER(r.name) IN ('organizer', 'customer')")) {
      return [Number(values[0]) === organizer.id ? [{ id: organizer.id }] : [], []];
    }
    if (sql.startsWith('SELECT id FROM users WHERE id = ? FOR UPDATE')) return [[{ id: values[0] }], []];
    if (sql.includes('SELECT id, title FROM events') && sql.includes('organizer_id = ?')) {
      const [organizerId, requestedEnd, requestedStart, , excludingId] = values;
      const start = new Date(requestedStart).getTime();
      const end = requestedEnd ? new Date(requestedEnd).getTime() : start + 1000;
      const match = [...events.values()].find((event) => {
        if (Number(event.organizer_id) !== Number(organizerId)
          || ['cancelled', 'completed'].includes(event.status)
          || Number(event.id) === Number(excludingId)) return false;
        const existingStart = new Date(event.start_date).getTime();
        const existingEnd = event.end_date ? new Date(event.end_date).getTime() : existingStart + 1000;
        return existingStart < end && existingEnd > start;
      });
      return [match ? [{ id: match.id, title: match.title }] : [], []];
    }
    if (sql.startsWith('INSERT INTO events')) {
      const id = nextId++;
      const fields = ['organizer_id', 'title', 'event_type', 'description', 'city', 'venue', 'cover_image_url', 'gallery_images', 'start_date', 'end_date', 'budget', 'capacity', 'guest_count', 'notes'];
      const event = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
      events.set(id, { ...eventRecord(), ...event, id, status: 'draft', rejection_reason: null });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO event_history')) {
      history.push({ sql, values });
      return [{ insertId: history.length, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audit.push({ sql, values });
      return [{ insertId: audit.length, affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      notifications.push(values);
      return [{ insertId: notifications.length, affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT e.*, u.full_name AS organizer_name')) {
      const event = events.get(Number(values[0]));
      return [event ? [{ ...event }] : [], []];
    }
    if (sql.startsWith('SELECT b.id, b.event_id, b.vendor_id')) {
      return [bookings.get(Number(values[0])) || [], []];
    }
    if (sql.startsWith('SELECT etb.id, etb.booking_reference')) return [ticketBookings.get(Number(values[0])) || [], []];
    if (sql.startsWith('SELECT etb.customer_id AS user_id')) return [[{ user_id: 90 }, { user_id: 91 }], []];
    if (sql.startsWith('SELECT h.id, h.actor_id')) return [[], []];
    if (sql.startsWith('SELECT a.id, a.actor_id')) return [[], []];
    if (sql.startsWith('SELECT id, organizer_id, title, status, start_date, end_date, capacity')) {
      const event = events.get(Number(values[0]));
      return [event ? [{ ...event }] : [], []];
    }
    if (sql.startsWith('SELECT id, organizer_id, title, status, start_date, end_date FROM events')) {
      const event = events.get(Number(values[0]));
      return [event ? [{ ...event }] : [], []];
    }
    if (sql.startsWith('SELECT COALESCE(SUM(tt.sold_quantity)')) return [[{ sold: 0, reserved: 0 }], []];
    if (sql.includes('SET status = ?') && sql.includes('rejection_reason')) {
      const event = events.get(Number(values[4]));
      if (event) {
        event.status = values[0];
        event.rejection_reason = values[2] === 'rejected' ? values[3] : null;
        if (values[1] === 'active') event.published_at ||= '2030-01-01 10:00:00';
      }
      return [{ affectedRows: event ? 1 : 0 }, []];
    }
    if (sql.startsWith('UPDATE events SET')) {
      const event = events.get(Number(values.at(-1)));
      const fields = [...sql.matchAll(/`([^`]+)` = \?/g)].map((match) => match[1]);
      if (event) fields.forEach((field, index) => { event[field] = values[index]; });
      return [{ affectedRows: event ? 1 : 0 }, []];
    }
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }

  const database = {
    events,
    bookings,
    ticketBookings,
    notifications,
    history,
    audit,
    statements,
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
  return database;
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

function eventBody(overrides = {}) {
  return {
    organizer_id: organizer.id,
    title: 'New Organizer Event',
    event_type: 'Music',
    description: 'A new event',
    city: 'Addis Ababa',
    venue: 'City Hall',
    cover_image_url: '',
    gallery_images: [],
    start_date: '2030-08-10T10:00',
    end_date: '2030-08-10T12:00',
    budget: 1200,
    capacity: 200,
    guest_count: 150,
    notes: '',
    ...overrides,
  };
}

test('administrator event endpoints require an authenticated admin', async () => {
  const response = await fetch(`${baseUrl}/api/admin/events`);
  assert.equal(response.status, 401);
});

test('administrator event form options return active organizers and shared categories', async () => {
  const response = await adminRequest('/api/admin/events/options');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.organizers, [organizer]);
  assert.deepEqual(data.categories, [{ id: 1, name: 'Music' }, { id: 2, name: 'Catering' }]);
});

test('administrator creates and edits events with server-side schedule validation', async () => {
  const created = await adminRequest('/api/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody()),
  });
  assert.equal(created.status, 201);
  const { data: createdEvent } = await created.json();
  assert.equal(createdEvent.status, 'draft');
  assert.ok(database.history.some((entry) => entry.values[0] === createdEvent.id));

  const overlap = await adminRequest('/api/admin/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody({ title: 'Overlapping', start_date: '2030-08-10T11:00', end_date: '2030-08-10T13:00' })),
  });
  assert.equal(overlap.status, 409);

  const invalidDate = await adminRequest(`/api/admin/events/${createdEvent.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: '2030-08-10T14:00', end_date: '2030-08-10T12:00' }),
  });
  assert.equal(invalidDate.status, 400);
  assert.equal(database.events.get(createdEvent.id).title, 'New Organizer Event');

  const edited = await adminRequest(`/api/admin/events/${createdEvent.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Updated Organizer Event' }),
  });
  assert.equal(edited.status, 200);
  assert.equal(database.events.get(createdEvent.id).title, 'Updated Organizer Event');
});

test('administrator publishes events and approves pending events with notifications', async () => {
  const publish = await adminRequest('/api/admin/events/12/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'publish' }),
  });
  assert.equal(publish.status, 200);
  assert.equal(database.events.get(12).status, 'active');

  const approve = await adminRequest('/api/admin/events/11/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  });
  assert.equal(approve.status, 200);
  assert.equal(database.events.get(11).status, 'active');
  assert.equal(database.notifications.length, 2);
  assert.ok(database.history.some((entry) => entry.values.includes('event.approve')));
});

test('rejection requires a reason and cancellation preserves existing bookings', async () => {
  database.events.set(11, eventRecord({ id: 11, status: 'pending_approval' }));
  const rejectedWithoutReason = await adminRequest('/api/admin/events/11/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reject' }),
  });
  assert.equal(rejectedWithoutReason.status, 400);

  const rejected = await adminRequest('/api/admin/events/11/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reject', reason: 'Missing required event details' }),
  });
  assert.equal(rejected.status, 200);
  assert.equal(database.events.get(11).status, 'rejected');
  assert.equal(database.events.get(11).rejection_reason, 'Missing required event details');

  const cancelled = await adminRequest('/api/admin/events/13/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel', reason: 'Venue unavailable' }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal(database.events.get(13).status, 'cancelled');
  assert.equal(database.bookings.get(13).length, 1);
  assert.deepEqual(database.notifications.slice(-3).map(([userId]) => userId).sort((a, b) => a - b), [78, 90, 91]);
});

test('event details return their booking and vendor relationships', async () => {
  const response = await adminRequest('/api/admin/events/13');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.vendorBookings[0].vendor_name, 'Good Food');
  assert.equal(data.ticketBookings[0].customer_name, 'Ticket Customer');
});

test('only published events accept bookings', () => {
  assert.equal(isEventOpenForBookings('active'), true);
  assert.equal(isEventOpenForBookings('published'), true);
  for (const status of ['draft', 'pending_approval', 'rejected', 'cancelled', 'completed', 'unpublished']) {
    assert.equal(isEventOpenForBookings(status), false);
  }
});

test('admin event updates accept a boolean featured flag only', () => {
  assert.deepEqual(parseAdminEventInput({ is_featured: true }, { partial: true }), {
    success: true,
    data: { is_featured: true },
  });
  assert.equal(parseAdminEventInput({ is_featured: 'true' }, { partial: true }).success, false);
});

test('featuring an event changes only its featured flag', async () => {
  const original = eventRecord({
    id: 11,
    status: 'active',
    start_date: '2030-10-10 10:00:00',
    end_date: '2030-10-10 12:00:00',
  });
  database.events.set(11, original);
  const response = await adminRequest('/api/admin/events/11', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_featured: true }),
  });

  assert.equal(response.status, 200);
  const updated = database.events.get(11);
  assert.equal(updated.is_featured, true);
  assert.equal(updated.title, original.title);
  assert.equal(updated.description, original.description);
  assert.equal(updated.city, original.city);
  const update = database.statements.findLast(({ sql }) => sql.startsWith('UPDATE events SET'));
  assert.equal(update.sql, 'UPDATE events SET `is_featured` = ? WHERE id = ?');
  assert.deepEqual(update.values, [true, 11]);
});

test('event search covers organizer, customer, ID, vendor category, and location fields', async () => {
  const response = await adminRequest('/api/admin/events?q=festival&status=published');
  assert.equal(response.status, 200);
  const searchQuery = database.statements.findLast(({ sql }) => sql.includes('CAST(e.id AS CHAR) = ?'));
  assert.ok(searchQuery);
  assert.match(searchQuery.sql, /customer\.full_name/);
  assert.match(searchQuery.sql, /u\.full_name/);
  assert.match(searchQuery.sql, /vp\.business_name/);
  assert.match(searchQuery.sql, /category\.name/);
  assert.match(searchQuery.sql, /COALESCE\(e\.venue/);
});
