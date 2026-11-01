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
  assert.equal(vendor.availability.length, Math.min(Number(availabilityCount.total), 30));
  for (const review of vendor.reviews) {
    assert.deepEqual(Object.keys(review).sort(), ['comment', 'createdAt', 'customerName', 'rating'].sort());
  }
  for (const entry of vendor.availability) {
    assert.deepEqual(Object.keys(entry).sort(), ['date', 'status'].sort());
  }
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
  assert.ok(Array.isArray(service.packages));
  assert.ok(Array.isArray(service.reviews));
  assert.ok(Array.isArray(service.availability));
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
