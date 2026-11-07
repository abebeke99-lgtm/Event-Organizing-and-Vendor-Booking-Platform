import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

const app = createApp();
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
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
  await pool.end();
});

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

test('public vendor list and detail return correctly mapped optional data', async (context) => {
  const listResponse = await get('/api/platform/vendors?page=1&limit=1');
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(Array.isArray(list.data));

  if (!list.data.length) {
    context.skip('No verified public vendor exists in the local database.');
    return;
  }

  const vendorId = list.data[0].id;
  const detailResponse = await get(`/api/platform/vendors/${vendorId}`);
  assert.equal(detailResponse.status, 200);
  const { data: vendor } = await detailResponse.json();
  assert.equal(vendor.id, vendorId);
  assert.ok(Array.isArray(vendor.services));
  assert.ok(Array.isArray(vendor.reviews));
  assert.ok(Array.isArray(vendor.availability));
  assert.ok(vendor.ratingDistribution && typeof vendor.ratingDistribution === 'object');

  const [[reviewCount]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     WHERE b.vendor_id = ? AND r.status = 'published'`,
    [vendorId]
  );
  const [[availabilityCount]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM vendor_availability
     WHERE vendor_id = ? AND available_date >= CURDATE()`,
    [vendorId]
  );
  assert.equal(vendor.reviews.length, Math.min(Number(reviewCount.total), 20));
  assert.equal(Object.values(vendor.ratingDistribution).reduce((sum, count) => sum + count, 0), Number(reviewCount.total));
  assert.equal(vendor.availability.length, Math.min(Number(availabilityCount.total), 30));
  for (const review of vendor.reviews) {
    assert.deepEqual(Object.keys(review).sort(), ['comment', 'createdAt', 'customerName', 'rating'].sort());
  }
  for (const entry of vendor.availability) {
    assert.deepEqual(Object.keys(entry).sort(), ['date', 'status'].sort());
  }
});

test('vendor discovery validates filters and accepts availability and recent sorting', async () => {
  const invalid = await get('/api/platform/vendors?minPrice=20000&maxPrice=10000');
  assert.equal(invalid.status, 400);
  const filtered = await get('/api/platform/vendors?availableOnly=true&sort=recently-added&page=1&limit=5');
  assert.equal(filtered.status, 200);
  const body = await filtered.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(body.pagination.page, 1);
});

test('vendor discovery serves featured and popular views from real records', async () => {
  const [featuredRows] = await pool.query(`
    SELECT vp.id
    FROM vendor_profiles vp
    JOIN users u ON u.id = vp.user_id AND u.status = 'active'
    WHERE vp.verification_status = 'verified' AND vp.is_featured = TRUE
    ORDER BY vp.id
    LIMIT 50
  `);
  const response = await get('/api/platform/vendors?filter=featured&sort=popular&page=1&limit=50');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, featuredRows.length);
  assert.deepEqual(new Set(body.data.map((vendor) => Number(vendor.id))), new Set(featuredRows.map((vendor) => Number(vendor.id))));
  assert.ok(body.data.every((vendor) => vendor.isFeatured === true));
});

test('vendor discovery accepts category slugs from public category links', async (context) => {
  const [rows] = await pool.query(`
    SELECT sc.name
    FROM service_categories sc
    JOIN vendor_profiles vp ON vp.category_id = sc.id AND vp.verification_status = 'verified'
    JOIN users u ON u.id = vp.user_id AND u.status = 'active'
    WHERE sc.is_active = TRUE
    GROUP BY sc.id, sc.name
    ORDER BY sc.name
    LIMIT 1
  `);
  if (!rows.length) {
    context.skip('No active category has a verified public vendor in the local database.');
    return;
  }
  const slug = rows[0].name.toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const response = await get(`/api/platform/vendors?category=${encodeURIComponent(slug)}&page=1&limit=12`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.pagination.total > 0);
  assert.ok(body.data.every((vendor) => vendor.category === rows[0].name));
});

test('public categories only expose images uploaded to the database', async () => {
  const [rows] = await pool.query(
    `SELECT id, image_mime
     FROM service_categories
     WHERE is_active = TRUE`,
  );
  const response = await get('/api/platform/categories');
  assert.equal(response.status, 200);
  const body = await response.json();
  const { data, categories } = body;
  assert.ok(Array.isArray(data));
  assert.deepEqual(categories, data);
  assert.deepEqual(data.map((category) => category.name), [...data.map((category) => category.name)].sort((a, b) => a.localeCompare(b)));

  for (const category of data) {
    const record = rows.find((row) => Number(row.id) === category.id);
    assert.ok(record);
    assert.equal(category.image, record.image_mime ? `/api/platform/categories/${category.id}/image` : null);
    assert.equal(category.icon, category.image);
    assert.equal(category.vendor_count, category.vendorCount);
    assert.ok(Number.isInteger(category.vendor_count));
  }
});

test('service navigation exposes the ordered categories and filters public services by stable category slug', async () => {
  const expectedNames = [
    'Catering Services',
    'Photography & Videography',
    'Decoration & Florists',
    'Wedding Planning',
    'Venue & Event Spaces',
    'Music & Entertainment',
    'Sound & Lighting',
    'Transportation',
    'Makeup & Beauty',
    'Rental Equipment',
    'Cakes & Bakery',
    'Printing & Invitations',
    'Security Services',
    'Other Services',
  ];
  const response = await get('/api/platform/categories?scope=services');
  assert.equal(response.status, 200);
  const { categories } = await response.json();
  assert.deepEqual(categories.map((category) => category.name), expectedNames);

  for (const category of categories) {
    const servicesResponse = await get(`/api/platform/services?category=${encodeURIComponent(category.slug)}&page=1&limit=50`);
    assert.equal(servicesResponse.status, 200, category.name);
    const result = await servicesResponse.json();
    assert.ok(result.data.every((service) => service.categoryId === category.id), category.name);
    assert.equal(category.serviceCount, result.pagination.total, category.name);
  }
});

test('service listings validate filters and support search, vendor, newest sort, and pagination', async () => {
  const invalidCases = [
    '?sort=unknown',
    '?page=0',
    '?limit=51',
    '?minPrice=200&maxPrice=100',
    '?vendorId=not-a-number',
    '?unexpected=true',
  ];
  for (const query of invalidCases) {
    const response = await get(`/api/platform/services${query}`);
    assert.equal(response.status, 400, query);
  }

  const response = await get('/api/platform/services?search=service&vendor=event&location=addis&sort=newest&page=1&limit=5');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(Array.isArray(result.data));
  assert.ok(result.data.every((service) => service.status === 'active' && service.published === true));
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.limit, 5);
});

test('public categories return an empty array when the active category table is empty', async () => {
  app.locals.database = {
    async query(sql, values) {
      assert.match(sql, /FROM service_categories sc/);
      assert.deepEqual(values, []);
      return [[], []];
    },
  };
  try {
    const response = await get('/api/platform/categories');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { categories: [], data: [] });
  } finally {
    delete app.locals.database;
  }
});

test('public category images allow embedding from the frontend origin', async (context) => {
  const [[category]] = await pool.query(
    `SELECT id
     FROM service_categories
     WHERE is_active = TRUE AND image IS NOT NULL
     ORDER BY id
     LIMIT 1`,
  );
  if (!category) {
    context.skip('No active category image exists in the local database.');
    return;
  }

  const response = await get(`/api/platform/categories/${category.id}/image`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.match(response.headers.get('content-type') || '', /^image\//);
});

test('public service packages and detail return correctly mapped optional data', async (context) => {
  const listResponse = await get('/api/platform/services?page=1&limit=1');
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(Array.isArray(list.data));

  if (!list.data.length) {
    context.skip('No published vendor service exists in the local database.');
    return;
  }

  const serviceId = list.data[0].id;
  const detailResponse = await get(`/api/platform/services/${serviceId}`);
  assert.equal(detailResponse.status, 200);
  const { data: service } = await detailResponse.json();
  assert.equal(service.id, serviceId);
  assert.ok(service.vendorId > 0);
  assert.ok(service.vendorName);
  assert.ok(Array.isArray(service.packages));
  assert.ok(Array.isArray(service.reviews));
  assert.ok(Array.isArray(service.availability));

  const comparisonResponse = await get(`/api/platform/services?ids=${serviceId}&limit=4`);
  assert.equal(comparisonResponse.status, 200);
  const comparison = await comparisonResponse.json();
  assert.deepEqual(comparison.data.map((item) => item.id), [serviceId]);
});

test('public service comparison accepts bounded IDs and rejects malformed filters', async () => {
  const validResponse = await get('/api/platform/services?ids=1&limit=4');
  assert.equal(validResponse.status, 200);
  const validResult = await validResponse.json();
  assert.ok(Array.isArray(validResult.data));
  assert.ok(validResult.data.every((service) => service.id === 1));

  const response = await get('/api/platform/services?ids=1,1');
  assert.equal(response.status, 400);
});

test('vendor detail distinguishes invalid IDs from unknown vendor IDs', async () => {
  const invalidResponse = await get('/api/platform/vendors/not-a-number');
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: 'Invalid vendor ID.' });

  const unknownResponse = await get('/api/platform/vendors/9007199254740991');
  assert.equal(unknownResponse.status, 404);
  assert.deepEqual(await unknownResponse.json(), { error: 'Vendor not found.' });
});

test('vendor-only profile and dashboard APIs reject anonymous requests', async () => {
  for (const path of [
    '/api/vendor/overview',
    '/api/vendor/profile',
    '/api/vendor/services',
    '/api/vendor/availability',
    '/api/vendor/reviews',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 401, path);
  }
});
