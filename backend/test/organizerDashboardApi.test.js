import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const organizerToken = 'organizer-dashboard-api-session';
const customerToken = 'organizer-dashboard-customer-session';
const organizerId = 44;
const writes = [];

async function execute(sql, values = []) {
  if (sql.includes('FROM system_settings')) return [[], []];
  if (sql.includes('FROM user_sessions s')) {
    const role = values[0] === hashToken(organizerToken) ? 'organizer'
      : values[0] === hashToken(customerToken) ? 'customer' : null;
    return [role ? [{
      id: role === 'organizer' ? organizerId : 55,
      full_name: 'Organizer Test',
      email: 'organizer@example.test',
      phone: null,
      status: 'active',
      role,
      permission_keys: '',
    }] : [], []];
  }
  if (sql.includes('FROM events WHERE organizer_id = ?')) {
    return [[{ total_events: 2, upcoming_events: 1, ongoing_events: 0, allocated_budget: '10000.00' }], []];
  }
  if (sql.includes('FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?')) {
    return [[{ total_bookings: 4, pending_bookings: 1, confirmed_bookings: 1, completed_bookings: 2 }], []];
  }
  if (sql.includes('FROM event_expenses x JOIN events e')) return [[{ planned_expenses: '2500.00', actual_expenses: '1500.00' }], []];
  if (sql.includes('AS unread_messages')) return [[{ unread_messages: 3 }], []];
  if (sql.includes('AS unread_notifications')) return [[{ unread_notifications: 2 }], []];
  if (sql.startsWith('SELECT id, title, budget, start_date, end_date FROM events')) {
    return [Number(values[1]) === organizerId && Number(values[0]) === 11
      ? [{ id: 11, title: 'Private Event', budget: '10000.00', start_date: '2030-02-01 10:00:00', end_date: null }]
      : [], []];
  }
  if (sql.startsWith('SELECT id FROM event_budget_categories')) return [[{ id: Number(values[0]) }], []];
  if (sql.startsWith('SELECT b.id, b.vendor_id FROM bookings')) {
    return [Number(values[0]) === 31 && Number(values[1]) === 11 && Number(values[2]) === organizerId
      ? [{ id: 31, vendor_id: 8 }]
      : [], []];
  }
  if (sql.startsWith('SELECT b.id, b.status, b.vendor_id, vp.user_id')) {
    return [Number(values[0]) === 31 && Number(values[1]) === 11
      ? [{ id: 31, status: 'accepted', vendor_id: 8, vendor_user_id: 77, business_name: 'Bright Photos' }]
      : [], []];
  }
  if (sql.startsWith('SELECT id FROM vendor_profiles')) return [[{ id: Number(values[0]) }], []];
  if (sql.startsWith('INSERT INTO event_vendor_tasks')) {
    writes.push({ kind: 'task', values });
    return [{ insertId: 81, affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO notifications')) {
    writes.push({ kind: 'notification', values });
    return [{ insertId: 91, affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO notification_history') || sql.startsWith('INSERT INTO audit_logs')) {
    writes.push({ kind: 'history' });
    return [{ insertId: 1, affectedRows: 1 }, []];
  }
  if (sql.startsWith('INSERT INTO event_expenses')) {
    writes.push({ kind: 'expense', values });
    return [{ insertId: 71, affectedRows: 1 }, []];
  }
  if (sql.startsWith('SELECT id, name, budget_limit')) return [[], []];
  if (sql.startsWith('SELECT x.id, x.category_id')) return [[], []];
  throw new Error(`Unexpected organizer dashboard SQL: ${sql}`);
}

const database = {
  async execute(...args) { return execute(...args); },
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

function request(path, token = organizerToken, options = {}) {
  return fetch(`${baseUrl}/api/platform/organizer${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Cookie: `platform_session=${token}` } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(8000),
  });
}

test('organizer routes require an organizer platform session', async () => {
  assert.equal((await request('/overview', null)).status, 401);
  assert.equal((await request('/overview', customerToken)).status, 403);
});

test('organizer overview returns only scoped aggregate records and actual budget totals', async () => {
  const response = await request('/overview');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    totalEvents: 2,
    upcomingEvents: 1,
    ongoingEvents: 0,
    totalBookings: 4,
    pendingBookings: 1,
    confirmedBookings: 1,
    completedBookings: 2,
    budget: { allocated: 10000, plannedExpenses: 2500, actualExpenses: 1500, remaining: 8500 },
    unreadMessages: 3,
    unreadNotifications: 2,
  });
});

test('organizer cannot read another account event budget', async () => {
  assert.equal((await request('/events/99/budget')).status, 404);
});

test('organizer expense validation requires a nonnegative amount', async () => {
  const response = await request('/events/11/expenses', organizerToken, {
    method: 'POST',
    body: JSON.stringify({ description: 'Catering deposit', plannedAmount: -1 }),
  });
  assert.equal(response.status, 400);
});

test('organizer expenses can link only bookings owned by the event organizer', async () => {
  const response = await request('/events/11/expenses', organizerToken, {
    method: 'POST',
    body: JSON.stringify({ description: 'Vendor deposit', actualAmount: 100, bookingId: 31 }),
  });
  assert.equal(response.status, 201);
  const expenseWrite = writes.find((entry) => entry.kind === 'expense');
  assert.ok(expenseWrite);
  assert.equal(expenseWrite.values[2], 31);
});

test('vendor coordination tasks require a booking on the organizer event and notify the vendor', async () => {
  const response = await request('/events/11/tasks', organizerToken, {
    method: 'POST',
    body: JSON.stringify({ bookingId: 31, title: 'Confirm setup time', details: 'Send arrival estimate.' }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.id, 81);
  assert.ok(writes.some((entry) => entry.kind === 'notification'));

  const foreignBooking = await request('/events/11/tasks', organizerToken, {
    method: 'POST',
    body: JSON.stringify({ bookingId: 32, title: 'Other event task' }),
  });
  assert.equal(foreignBooking.status, 404);
});