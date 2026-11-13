import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDashboardData } from '../src/dashboardRequests.js';

test('shares only in-flight dashboard requests for the same account', async () => {
  const resolvers = [];
  let calls = 0;
  const api = () => {
    calls += 1;
    return new Promise((resolve) => { resolvers.push(resolve); });
  };
  const first = requestDashboardData(api, 'vendor:7', '/vendor/overview');
  const second = requestDashboardData(api, 'vendor:7', '/vendor/overview');
  await Promise.resolve();

  assert.equal(calls, 1);
  resolvers[0]({ data: { totalServices: 3 } });
  assert.deepEqual(await first, { data: { totalServices: 3 } });
  assert.deepEqual(await second, { data: { totalServices: 3 } });

  const otherAccount = requestDashboardData(api, 'vendor:8', '/vendor/overview');
  await Promise.resolve();
  assert.equal(calls, 2);
  resolvers[1]({ data: { totalServices: 4 } });
  assert.deepEqual(await otherAccount, { data: { totalServices: 4 } });

  const freshRequest = requestDashboardData(api, 'vendor:7', '/vendor/overview');
  await Promise.resolve();
  assert.equal(calls, 3, 'settled data is not cached');
  resolvers[2]({ data: { totalServices: 5 } });
  assert.deepEqual(await freshRequest, { data: { totalServices: 5 } });
});

test('a cancelled StrictMode subscriber does not abort a replacement subscriber', async () => {
  let resolveRequest;
  let calls = 0;
  const api = (_path, { signal }) => {
    calls += 1;
    signal.addEventListener('abort', () => {
      rejectRequest(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    }, { once: true });
    return new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
  };
  let rejectRequest;
  const firstController = new AbortController();
  const first = requestDashboardData(api, 'customer:12', '/customer/overview', firstController.signal);
  const firstResult = first.catch((error) => error.name);
  firstController.abort();
  const second = requestDashboardData(api, 'customer:12', '/customer/overview');

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRequest({ data: { totalBookings: 2 } });
  assert.equal(await firstResult, 'AbortError');
  assert.deepEqual(await second, { data: { totalBookings: 2 } });
});
