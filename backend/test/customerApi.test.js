import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const sessionToken = 'customer-api-test-session';
const user = {
  id: 21,
  full_name: 'Customer Test',
  email: 'customer-test@example.test',
  phone: null,
  preferred_language: 'en',
  status: 'active',
  role: 'customer',
};

const vendorRows = [
  { id: 10, user_id: 110, business_name: 'Aster Catering', city: 'Addis Ababa', description: 'Wedding meals', verification_status: 'verified', category: 'Catering', min_price: 20000, rating: 4.8, review_count: 12 },
  { id: 11, user_id: 111, business_name: 'Blue Photo', city: 'Bahir Dar', description: 'Event photography', verification_status: 'verified', category: 'Photography', min_price: 10000, rating: 4.5, review_count: 8 },
  { id: 12, user_id: 112, business_name: 'Cedar Catering', city: 'Addis Ababa', description: 'Corporate catering', verification_status: 'verified', category: 'Catering', min_price: 30000, rating: 4.9, review_count: 20 },
];

const serviceRows = [
  { id: 100, vendor_id: 10, title: 'Wedding Buffet', description: 'Wedding meals', price: 20000, currency: 'ETB', business_name: 'Aster Catering', city: 'Addis Ababa', verification_status: 'verified', category: 'Catering', rating: 4.8, review_count: 12 },
  { id: 101, vendor_id: 11, title: 'Event Photography', description: 'Photo coverage', price: 10000, currency: 'ETB', business_name: 'Blue Photo', city: 'Bahir Dar', verification_status: 'verified', category: 'Photography', rating: 4.5, review_count: 8 },
  { id: 102, vendor_id: 12, title: 'Corporate Lunch', description: 'Corporate catering', price: 30000, currency: 'ETB', business_name: 'Cedar Catering', city: 'Addis Ababa', verification_status: 'verified', category: 'Catering', rating: 4.9, review_count: 20 },
];

function createDatabase() {
  const favorites = [{ id: 7, user_id: 99, vendor_id: 11 }];
  const statements = [];
  let permissionKeys = ['favorites.manage_own', 'bookings.view_own'];
  let nextFavoriteId = 8;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM user_sessions s')) {
      return [values[0] === hashToken(sessionToken) ? [{ ...user, permission_keys: permissionKeys.join(',') }] : [], []];
    }
    if (sql.startsWith('UPDATE users SET preferred_language = ?')) return [{ affectedRows: 1 }, []];
    if (sql === 'SELECT b.status FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?') {
      return [[{ status: 'confirmed' }, { status: 'requested' }, { status: 'completed' }], []];
    }
    if (sql.startsWith('SELECT id FROM events WHERE organizer_id = ?')) return [[{ id: 1 }], []];
    if (sql.startsWith('SELECT q.status FROM quotations q')) return [[{ status: 'draft' }], []];
    if (sql.startsWith('SELECT p.status, p.amount FROM payments p')) return [[{ status: 'pending', amount: '25.50' }], []];
    if (sql.startsWith('SELECT id FROM messages WHERE recipient_id = ?')) return [[{ id: 1 }], []];
    if (sql.startsWith("SELECT id FROM notifications WHERE user_id = ?")) return [[{ id: 1 }], []];
    if (sql === "SELECT id FROM vendor_profiles WHERE id = ? AND verification_status = 'verified'") {
      return [vendorRows.some((vendor) => vendor.id === Number(values[0])) ? [{ id: Number(values[0]) }] : [], []];
    }
    if (sql === 'INSERT INTO favorites (user_id, vendor_id) VALUES (?, ?)') {
      if (favorites.some((favorite) => favorite.user_id === Number(values[0]) && favorite.vendor_id === Number(values[1]))) {
        throw Object.assign(new Error('Duplicate favorite'), { code: 'ER_DUP_ENTRY' });
      }
      const favorite = { id: nextFavoriteId++, user_id: Number(values[0]), vendor_id: Number(values[1]) };
      favorites.push(favorite);
      return [{ insertId: favorite.id, affectedRows: 1 }, []];
    }
    if (sql === 'DELETE FROM favorites WHERE user_id = ? AND vendor_id = ?') {
      const index = favorites.findIndex((favorite) => favorite.user_id === Number(values[0]) && favorite.vendor_id === Number(values[1]));
      if (index < 0) return [{ affectedRows: 0 }, []];
      favorites.splice(index, 1);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('FROM favorites f')) {
      return [favorites
        .filter((favorite) => favorite.user_id === Number(values[0]))
        .map((favorite) => {
          const vendor = vendorRows.find((row) => row.id === favorite.vendor_id);
          return {
            id: vendor.id,
            business_name: vendor.business_name,
            city: vendor.city,
            description: vendor.description,
            verification_status: vendor.verification_status,
            category: vendor.category,
          };
        }), []];
    }
      if (sql.includes('FROM service_packages p') || sql.includes('FROM vendor_media')) return [[], []];
    if (sql.includes('FROM vendor_availability')) return [[{ vendor_id: 10 }, { vendor_id: 12 }], []];
    throw new Error(`Unexpected test SQL: ${sql}`);
  }

  async function query(sql) {
    statements.push({ sql, values: [] });
    if (sql.includes('FROM vendor_profiles vp')) return [vendorRows.map((row) => ({ ...row })), []];
    if (sql.includes('FROM services s')) return [serviceRows.map((row) => ({ ...row })), []];
    if (sql.includes('FROM service_categories')) {
      return [[
        { id: 3, name: 'Catering', description: 'Food services', is_active: 1 },
        { id: 4, name: 'Photography', description: 'Photo services', is_active: 1 },
      ], []];
    }
    throw new Error(`Unexpected test query: ${sql}`);
  }

  return {
    favorites,
    statements,
    execute,
    query,
    setPermissionKeys(keys) { permissionKeys = keys; },
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

async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = {};
  if (authenticated) headers.Cookie = `platform_session=${sessionToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('customer overview qualifies booking status and returns dashboard counts', async () => {
  const response = await request('/api/customer/overview');

  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    totalBookings: 3,
    pendingBookings: 1,
    confirmedBookings: 1,
    completedBookings: 1,
    upcomingEvents: 1,
    pendingQuotations: 1,
    unreadMessages: 1,
    unreadNotifications: 1,
    outstandingPayments: 25.5,
  });
  assert.ok(database.statements.some(({ sql }) => sql.startsWith('SELECT b.status FROM bookings b')));
});

test('customer marketplace filters and sorts vendors with pagination metadata', async () => {
  const response = await request('/api/customer/vendors?category=Catering&location=Addis&page=2&limit=1&sort=price-low');

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].business_name, 'Cedar Catering');
  assert.deepEqual(result.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
});

test('customer marketplace filters and sorts services with pagination metadata', async () => {
  const response = await request('/api/customer/services?search=catering&minPrice=15000&sort=price-low&page=1&limit=1');

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, 'Wedding Buffet');
  assert.deepEqual(result.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.ok(database.statements.some(({ sql }) => sql.includes("COALESCE(NULLIF(TRIM(s.currency), ''), 'ETB') AS currency")));
});

test('customer marketplace filters services to vendors with future availability', async () => {
  const response = await request('/api/customer/services?availableOnly=true&limit=10');

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.data.map((service) => service.id), [102, 100]);
});

test('customer catalog rejects malformed query parameters', async () => {
  const badPage = await request('/api/customer/vendors?page=0');
  assert.equal(badPage.status, 400);

  const reversedPrices = await request('/api/customer/services?minPrice=20000&maxPrice=10000');
  assert.equal(reversedPrices.status, 400);
});

test('customer can add, read, and remove only their own favorite', async () => {
  const create = await request('/api/customer/favorites', {
    method: 'POST',
    body: { vendorId: 10 },
  });
  assert.equal(create.status, 201);
  assert.equal(database.favorites.some((favorite) => favorite.user_id === user.id && favorite.vendor_id === 10), true);

  const list = await request('/api/customer/favorites');
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.deepEqual(listBody.data.map((vendor) => vendor.id), [10]);

  const duplicate = await request('/api/customer/favorites', {
    method: 'POST',
    body: { vendorId: 10 },
  });
  assert.equal(duplicate.status, 409);

  const remove = await request('/api/customer/favorites/10', { method: 'DELETE' });
  assert.equal(remove.status, 204);
  assert.equal(database.favorites.some((favorite) => favorite.user_id === user.id && favorite.vendor_id === 10), false);
  assert.equal(database.favorites.some((favorite) => favorite.user_id === 99 && favorite.vendor_id === 11), true);
});

test('customer favorites require authentication and a verified vendor', async () => {
  const unauthenticated = await request('/api/customer/favorites', { method: 'POST', authenticated: false, body: { vendorId: 10 } });
  assert.equal(unauthenticated.status, 401);

  const invalidVendor = await request('/api/customer/favorites', { method: 'POST', body: { vendorId: 999 } });
  assert.equal(invalidVendor.status, 404);

  const invalidBody = await request('/api/customer/favorites', { method: 'POST', body: { vendorId: 10, userId: 99 } });
  assert.equal(invalidBody.status, 400);
});

test('customer cannot remove a favorite belonging to another user', async () => {
  const response = await request('/api/customer/favorites/11', { method: 'DELETE' });

  assert.equal(response.status, 404);
  assert.equal(database.favorites.some((favorite) => favorite.user_id === 99 && favorite.vendor_id === 11), true);
});

test('revoking a role permission blocks the protected customer operation on the next request', async () => {
  database.setPermissionKeys(['bookings.view_own']);
  const response = await request('/api/customer/favorites');
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: 'Access denied. The required permission is not assigned to this account.',
  });
  database.setPermissionKeys(['favorites.manage_own', 'bookings.view_own']);
});

test('authenticated platform users can persist supported language preferences', async () => {
  const saved = await request('/api/platform/preferences/language', {
    method: 'PATCH',
    body: { language: 'am' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).data, { language: 'am' });
  assert.ok(database.statements.some(({ sql, values }) => sql === 'UPDATE users SET preferred_language = ? WHERE id = ?'
    && values[0] === 'am' && values[1] === user.id));

  const invalid = await request('/api/platform/preferences/language', {
    method: 'PATCH',
    body: { language: 'fr' },
  });
  assert.equal(invalid.status, 400);

  const anonymous = await request('/api/platform/preferences/language', {
    method: 'PATCH',
    authenticated: false,
    body: { language: 'en' },
  });
  assert.equal(anonymous.status, 401);
});