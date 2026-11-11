import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthSessionLoader, getRetryAfterMilliseconds } from '../src/authSession.js';
import { getAdministratorRouteRedirect } from '../src/adminAuthentication.js';

function httpError(status, properties = {}) {
  return Object.assign(new Error(`Request failed (${status}).`), { status, ...properties });
}

test('StrictMode effect replay shares one in-flight administrator session request', async () => {
  let adminCalls = 0;
  let platformCalls = 0;
  let resolveAdminSession;
  const adminSession = new Promise((resolve) => { resolveAdminSession = resolve; });
  const loader = createAuthSessionLoader({
    getAdminSession() {
      adminCalls += 1;
      return adminSession;
    },
    async getPlatformSession() {
      platformCalls += 1;
      return { data: { user: null } };
    },
  });

  const firstLoad = loader.load();
  const replayedLoad = loader.load();
  assert.strictEqual(replayedLoad, firstLoad);
  assert.equal(adminCalls, 1);

  resolveAdminSession({ user: { id: 8, role: 'admin' } });
  const [firstResult, replayedResult] = await Promise.all([firstLoad, replayedLoad]);

  assert.equal(firstResult.status, 'authenticated');
  assert.strictEqual(replayedResult, firstResult);
  assert.equal(platformCalls, 1);
  assert.equal(loader.getSnapshot().user.id, 8);
});

test('a refreshed verified administrator session keeps the protected dashboard open', async () => {
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      return { user: { id: 8, email: 'admin@example.test', roles: 'Admin' } };
    },
    async getPlatformSession() {
      return { data: { user: null } };
    },
  });

  const result = await loader.load();

  assert.equal(result.status, 'authenticated');
  assert.equal(result.role, 'admin');
  assert.equal(getAdministratorRouteRedirect('/admin', result.user, result.role), null);
});

test('401 responses resolve to an anonymous state without inventing a user', async () => {
  let adminCalls = 0;
  let platformCalls = 0;
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      adminCalls += 1;
      return { user: null };
    },
    async getPlatformSession() {
      platformCalls += 1;
      return { data: { user: null } };
    },
  });

  const result = await loader.load();

  assert.deepEqual(result, { status: 'unauthenticated', user: null, role: null });
  assert.equal(adminCalls, 1);
  assert.equal(platformCalls, 1);
});

test('guest bootstrap skips the platform session request when no session hint exists', async () => {
  let platformCalls = 0;
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      return { user: null };
    },
    async getPlatformSession() {
      platformCalls += 1;
      return { data: { user: null } };
    },
    hasPlatformSession: () => false,
  });

  const result = await loader.load();

  assert.deepEqual(result, { status: 'unauthenticated', user: null, role: null });
  assert.equal(platformCalls, 0);
});

test('a valid platform session is loaded after the expected administrator 401', async () => {
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      return { user: null };
    },
    async getPlatformSession() {
      return { data: { user: { id: 12, role: 'vendor' } } };
    },
  });

  const result = await loader.load();

  assert.equal(result.status, 'authenticated');
  assert.equal(result.role, 'vendor');
  assert.equal(result.user.id, 12);
});

test('an invalid session cookie returns to the unauthenticated state', async () => {
  let clearedSessions = 0;
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      return { user: null };
    },
    async getPlatformSession() {
      throw httpError(401);
    },
    hasPlatformSession: () => true,
    clearPlatformSession() {
      clearedSessions += 1;
    },
  });

  const result = await loader.load();

  assert.deepEqual(result, { status: 'unauthenticated', user: null, role: null });
  assert.equal(clearedSessions, 1);
});

test('429 responses honor Retry-After and do not retry before the cooldown expires', async () => {
  let currentTime = 1000;
  let adminCalls = 0;
  const loader = createAuthSessionLoader({
    now: () => currentTime,
    async getAdminSession() {
      adminCalls += 1;
      if (adminCalls === 1) throw httpError(429, { retryAfterMs: 5000 });
      return { user: { id: 9 } };
    },
    async getPlatformSession() {
      return { data: { user: null } };
    },
  });

  const limited = await loader.load();
  const stillLimited = await loader.load({ force: true });
  assert.equal(limited.status, 'rate-limited');
  assert.equal(limited.retryAt, 6000);
  assert.strictEqual(stillLimited, limited);
  assert.equal(adminCalls, 1);

  currentTime = 6001;
  const retried = await loader.load();
  assert.equal(retried.status, 'authenticated');
  assert.equal(adminCalls, 2);
});

test('network failures remain recoverable and do not cause automatic retries', async (context) => {
  let adminCalls = 0;
  const loader = createAuthSessionLoader({
    async getAdminSession() {
      adminCalls += 1;
      throw new Error('Network unavailable.');
    },
    async getPlatformSession() {
      return { data: { user: null } };
    },
  });

  await context.test('initial auth probes retry 503 responses with backoff and eventually authenticate', async () => {
    let adminCalls = 0;
    const delays = [];
    const loader = createAuthSessionLoader({
      async getAdminSession() {
        adminCalls += 1;
        if (adminCalls < 3) throw httpError(503);
        return { user: { id: 21, role: 'admin' } };
      },
      async getPlatformSession() {
        return { data: { user: null } };
      },
      sleep: async (milliseconds) => delays.push(milliseconds),
    });

    const result = await loader.load();

    assert.equal(result.status, 'authenticated');
    assert.equal(adminCalls, 3);
    assert.deepEqual(delays, [500, 1000]);
  });

  await context.test('persistent 503 shows waking state and does not clear a platform session hint', async () => {
    let clearedSessions = 0;
    let adminCalls = 0;
    const delays = [];
    const loader = createAuthSessionLoader({
      async getAdminSession() {
        adminCalls += 1;
        throw httpError(503);
      },
      async getPlatformSession() {
        throw httpError(401);
      },
      hasPlatformSession: () => true,
      clearPlatformSession() {
        clearedSessions += 1;
      },
      sleep: async (milliseconds) => delays.push(milliseconds),
    });

    const result = await loader.load();

    assert.equal(result.status, 'waking');
    assert.match(result.message, /Server is waking up/);
    assert.equal(adminCalls, 3);
    assert.deepEqual(delays, [500, 1000]);
    assert.equal(clearedSessions, 0);
  });

  const failed = await loader.load();
  const unchanged = await loader.load();

  assert.equal(failed.status, 'error');
  assert.strictEqual(unchanged, failed);
  assert.equal(adminCalls, 1);
});

test('logout invalidates an authenticated session snapshot', () => {
  const loader = createAuthSessionLoader({
    async getAdminSession() { throw httpError(401); },
    async getPlatformSession() { throw httpError(401); },
  });
  loader.setAuthenticated({ id: 10, role: 'vendor' }, 'vendor');

  loader.setUnauthenticated();

  assert.deepEqual(loader.getSnapshot(), { status: 'unauthenticated', user: null, role: null });
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(getRetryAfterMilliseconds('7', 1000), 7000);
  assert.equal(getRetryAfterMilliseconds(new Date(8000).toUTCString(), 1000), 7000);
  assert.equal(getRetryAfterMilliseconds('invalid', 1000), undefined);
});