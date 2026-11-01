import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const organizerToken = 'platform-booking-test-session';
const organizerId = 44;
const eventDate = new Date(Date.now() + (400 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 19).replace('T', ' ');
const bookings = [];
let nextBookingId = 1;
let transactionTail = Promise.resolve();
let requireVendorCity = false;

async function execute(sql, values = []) {
  if (sql.includes('FROM system_settings')) {
    const rows = values
      .filter((key) => key === 'vendor_require_city' && requireVendorCity)
      .map((setting_key) => ({ setting_key, setting_value: 'true' }));
    return [rows, []];
  }
  if (sql.includes('FROM user_sessions s')) {
    return [values[0] === hashToken(organizerToken) ? [{
      id: organizerId,
      full_name: 'Event Organizer',
      email: 'organizer@example.test',
      phone: null,
      status: 'active',
      role: 'organizer',
      permission_keys: '',
    }] : []];
  }
  if (sql.includes('FROM events WHERE id = ?')) {
    return [[{
      id: 11,
      organizer_id: organizerId,
      status: 'active',
      start_date: eventDate,
      title: 'Future Wedding',
    }]];
  }
  if (sql.startsWith('SELECT s.id, s.vendor_id')) {
    return [[{
      id: 14,
      vendor_id: 8,
      title: 'Photography',
      price: '500.00',
      currency: 'ETB',
      vendor_user_id: 55,
      vendor_name: 'Bright Photos',
    }]];
  }
  if (sql.startsWith('SELECT id FROM vendor_profiles')) return [[{ id: 8 }]];
  if (sql.startsWith('SELECT status FROM vendor_availability')) return [[]];
  if (sql.startsWith('SELECT id FROM bookings')) {
    return [bookings
      .filter((booking) => booking.event_id === values[0] && booking.service_id === values[1])
      .filter((booking) => ['requested', 'under_review', 'quoted', 'accepted'].includes(booking.status))];
  }
  if (sql.startsWith('INSERT INTO bookings')) {
    const id = nextBookingId++;
    bookings.push({
      id,
      event_id: values[0],
      vendor_id: values[1],
      service_id: values[2],
      status: 'requested',
    });
    return [{ insertId: id }];
  }
  return [{ affectedRows: 1 }];
}

const database = {
  async execute(...args) { return execute(...args); },
  async getConnection() {
    let unlock;
    return {
      execute,
      async beginTransaction() {
        const previous = transactionTail;
        transactionTail = new Promise((resolve) => { unlock = resolve; });
        await previous;
      },
      async commit() { unlock?.(); },
      async rollback() { unlock?.(); },
      release() {},
    };
  },
};

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

function createBooking() {
  return fetch(`${baseUrl}/api/platform/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `platform_session=${organizerToken}`,
    },
    body: JSON.stringify({ eventId: 11, serviceId: 14 }),
    signal: AbortSignal.timeout(8000),
  });
}

test('concurrent booking requests for the same event service cannot create duplicates', async () => {
  const responses = await Promise.all([createBooking(), createBooking()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(bookings.length, 1);
});

test('vendor application enforces the configured business information requirements', async () => {
  requireVendorCity = true;
  try {
    const response = await fetch(`${baseUrl}/api/platform/vendor-application`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `platform_session=${organizerToken}`,
      },
      body: JSON.stringify({
        businessName: 'Bright Events',
        categoryId: 3,
        city: '',
        description: '',
      }),
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /required by the current vendor policy/i);
  } finally {
    requireVendorCity = false;
  }
});
