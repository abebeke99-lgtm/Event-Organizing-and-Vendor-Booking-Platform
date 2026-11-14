import assert from 'node:assert/strict';
import test from 'node:test';
import apiClient from '../src/api/axios.js';

function successAdapter(config) {
  return Promise.resolve({
    config,
    data: {},
    headers: {},
    status: 200,
    statusText: 'OK',
  });
}

function unauthorizedAdapter(config) {
  const error = new Error('Unauthorized');
  error.isAxiosError = true;
  error.config = config;
  error.response = {
    config,
    data: { error: 'Authentication required.' },
    headers: {},
    status: 401,
    statusText: 'Unauthorized',
  };
  return Promise.reject(error);
}

test('API requests include cookies and dispatch one invalidation for repeated admin 401s', async () => {
  const previousWindow = globalThis.window;
  const events = [];
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
  };

  try {
    const success = await apiClient.get('/admin/notifications', { adapter: successAdapter });
    assert.equal(success.config.withCredentials, true);

    await assert.rejects(apiClient.get('/admin/users', { adapter: unauthorizedAdapter }), { status: 401 });
    await assert.rejects(apiClient.get('/admin/roles', { adapter: unauthorizedAdapter }), { status: 401 });
    assert.deepEqual(events, ['eventhub:auth-invalidated']);

    await apiClient.post('/auth/login', {}, { adapter: successAdapter });
    await assert.rejects(apiClient.get('/admin/categories', { adapter: unauthorizedAdapter }), { status: 401 });
    assert.deepEqual(events, ['eventhub:auth-invalidated', 'eventhub:auth-invalidated']);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
