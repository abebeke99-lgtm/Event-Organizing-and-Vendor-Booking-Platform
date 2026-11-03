import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDataService, DEMO_DATA_STORAGE_KEY } from '../src/demoData.js';

function createStorage(initialValue = null) {
  const values = new Map(initialValue === null ? [] : [[DEMO_DATA_STORAGE_KEY, initialValue]]);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('demo catalogs return seeded records and honor search and pagination', () => {
  const service = createDemoDataService({ storage: createStorage() });
  const result = service.request('/customer/services?search=photography&page=1&limit=1');

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, 'Wedding Photography');
  assert.deepEqual(result.pagination, { page: 1, total: 2, totalPages: 2, limit: 1 });
});

test('demo booking requests are reflected in subsequent reads', () => {
  const service = createDemoDataService({
    storage: createStorage(),
    getSession: () => ({ name: 'Demo Customer', role: 'customer' }),
    now: () => 1710000000000,
  });

  const created = service.request('/platform/bookings', {
    method: 'POST',
    body: JSON.stringify({ eventId: 301, serviceId: 101 }),
  });
  const bookings = service.request('/customer/bookings').data;

  assert.equal(created.data.status, 'requested');
  assert.equal(created.data.serviceTitle, 'Wedding Photography');
  assert.ok(bookings.some((booking) => booking.reference === created.data.reference));
});

test('demo favorites persist to browser storage and are returned by the customer API', () => {
  const storage = createStorage();
  const service = createDemoDataService({ storage });

  service.request('/customer/favorites', {
    method: 'POST',
    body: JSON.stringify({ vendorId: 2 }),
  });

  const reloadedService = createDemoDataService({ storage });
  assert.deepEqual(reloadedService.request('/customer/favorites').data.map((vendor) => vendor.id), [1, 2, 3]);
});

test('corrupt persisted demo data fails explicitly', () => {
  const service = createDemoDataService({ storage: createStorage('{') });

  assert.throws(() => service.request('/customer/services'), /Saved demo application data is invalid/);
});
