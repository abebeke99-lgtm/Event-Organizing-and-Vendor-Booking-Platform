import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readDemoProfilePhoto,
  removeDemoProfilePhoto,
  saveDemoProfilePhoto,
} from '../src/utils/demoProfileStorage.js';

function createIndexedDb() {
  const photos = new Map();
  let hasStore = false;
  const database = {
    objectStoreNames: { contains: () => hasStore },
    createObjectStore() { hasStore = true; },
    transaction() {
      const transaction = {
        objectStore: () => ({
          get(key) {
            return createRequest(transaction, () => photos.get(key));
          },
          put(value, key) {
            return createRequest(transaction, () => photos.set(key, value));
          },
          delete(key) {
            return createRequest(transaction, () => photos.delete(key));
          },
        }),
      };
      return transaction;
    },
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function createRequest(transaction, execute) {
  const request = {};
  queueMicrotask(() => {
    try {
      request.result = execute();
      request.onsuccess?.();
      transaction.oncomplete?.();
    } catch (error) {
      request.error = error;
      request.onerror?.();
      transaction.onerror?.();
    }
  });
  return request;
}

test('demo profile photos persist separately per account and can be removed', async () => {
  const indexedDB = createIndexedDb();
  const photo = new Blob(['test image'], { type: 'image/png' });
  await saveDemoProfilePhoto('ADMIN@DEMO.EVENTHUB', photo, indexedDB);

  assert.equal((await readDemoProfilePhoto('admin@demo.eventhub', indexedDB)).type, 'image/png');
  assert.equal(await readDemoProfilePhoto('customer@demo.eventhub', indexedDB), null);
  await removeDemoProfilePhoto('admin@demo.eventhub', indexedDB);
  assert.equal(await readDemoProfilePhoto('admin@demo.eventhub', indexedDB), null);
});

test('demo profile photo storage reports unsupported browser storage', async () => {
  await assert.rejects(readDemoProfilePhoto('admin@demo.eventhub', null), /unavailable/);
});
