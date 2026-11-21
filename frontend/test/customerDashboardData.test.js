import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCustomerDashboardOverviewRequests,
  getCustomerDashboardEndpoints,
} from '../src/customerDashboardData.js';

test('customer dashboard loads only the active section data', () => {
  assert.deepEqual(getCustomerDashboardEndpoints('payments'), ['payments', 'refunds']);
  assert.deepEqual(getCustomerDashboardEndpoints('bookings'), []);
  assert.deepEqual(getCustomerDashboardEndpoints('support'), ['complaints', 'bookings']);
  assert.deepEqual(getCustomerDashboardEndpoints('unknown'), []);
});

test('customer overview starts the summary and all section reads concurrently', async () => {
  const paths = [];
  const pending = new Map();
  const requestDashboardData = (api, owner, path, signal) => {
    paths.push(path);
    return new Promise((resolve, reject) => {
      pending.set(path, { resolve, reject, api, owner, signal });
    });
  };
  const signal = new AbortController().signal;
  const requests = createCustomerDashboardOverviewRequests('api', 'customer:42', signal, requestDashboardData);

  assert.deepEqual(paths, [
    '/customer/overview',
    '/customer/vendors',
    '/customer/services',
    '/customer/bookings',
    '/customer/events',
    '/customer/messages',
    '/customer/notifications',
  ]);
  assert.equal(pending.size, 7);
  assert.equal(pending.get('/customer/overview').owner, 'customer:42');
  assert.equal(pending.get('/customer/overview').signal, signal);

  pending.get('/customer/overview').resolve({ data: { totalBookings: 1 } });
  for (const endpoint of requests.secondaryEndpoints) {
    pending.get(`/customer/${endpoint}`).resolve({ data: [] });
  }
  assert.deepEqual(await requests.overview, { data: { totalBookings: 1 } });
  assert.ok((await requests.secondary).every((result) => result.status === 'fulfilled'));
});

test('customer overview failure remains critical while secondary failures stay settled', async () => {
  const requestDashboardData = (api, owner, path) => (
    path === '/customer/overview'
      ? Promise.reject(new Error('overview unavailable'))
      : path === '/customer/services'
        ? Promise.reject(new Error('services unavailable'))
        : Promise.resolve({ data: [] })
  );
  const requests = createCustomerDashboardOverviewRequests('api', 'customer:42', undefined, requestDashboardData);

  await assert.rejects(requests.overview, /overview unavailable/);
  const secondaryResults = await requests.secondary;
  assert.equal(secondaryResults.length, 6);
  assert.equal(secondaryResults[1].status, 'rejected');
  assert.match(secondaryResults[1].reason.message, /services unavailable/);
});
