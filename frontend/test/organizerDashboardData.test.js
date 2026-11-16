import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrganizerDashboardOverviewRequests } from '../src/organizerDashboardData.js';

test('organizer overview starts its independent dashboard reads before the summary resolves', async () => {
  const paths = [];
  const pending = new Map();
  const requestDashboardData = (api, owner, path, signal) => {
    paths.push(path);
    return new Promise((resolve, reject) => {
      pending.set(path, { resolve, reject, owner, signal });
    });
  };
  const signal = new AbortController().signal;
  const requests = createOrganizerDashboardOverviewRequests(
    'api',
    'organizer:42',
    signal,
    requestDashboardData,
  );

  assert.deepEqual(paths, [
    '/platform/organizer/overview',
    '/platform/events/mine',
    '/platform/vendors?page=1&limit=4&sort=recommended',
    '/platform/bookings',
  ]);
  assert.equal(pending.size, 4);
  assert.equal(pending.get('/platform/organizer/overview').owner, 'organizer:42');
  assert.equal(pending.get('/platform/organizer/overview').signal, signal);

  pending.get('/platform/organizer/overview').resolve({ data: { totalEvents: 1 } });
  for (const [path, endpoint] of [
    ['/platform/events/mine', 'events'],
    ['/platform/vendors?page=1&limit=4&sort=recommended', 'vendors'],
    ['/platform/bookings', 'bookings'],
  ]) {
    pending.get(path).resolve({ data: [endpoint] });
  }
  assert.deepEqual(await requests.overview, { data: { totalEvents: 1 } });
  assert.equal(requests.secondaryEndpoints.join(','), 'events,vendors,bookings');
  assert.ok((await requests.secondary).every((result) => result.status === 'fulfilled'));
});

test('organizer overview stays critical while independent dashboard failures settle', async () => {
  const requestDashboardData = (_api, _owner, path) => (
    path === '/platform/organizer/overview'
      ? Promise.reject(new Error('overview unavailable'))
      : path.includes('/vendors')
        ? Promise.reject(new Error('vendors unavailable'))
        : Promise.resolve({ data: [] })
  );
  const requests = createOrganizerDashboardOverviewRequests(
    'api',
    'organizer:42',
    undefined,
    requestDashboardData,
  );

  await assert.rejects(requests.overview, /overview unavailable/);
  const secondaryResults = await requests.secondary;
  assert.equal(secondaryResults.length, 3);
  assert.equal(secondaryResults[1].status, 'rejected');
  assert.match(secondaryResults[1].reason.message, /vendors unavailable/);
});
