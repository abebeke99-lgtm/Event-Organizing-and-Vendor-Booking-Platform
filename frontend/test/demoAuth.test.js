import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDemoSession,
  DEMO_ACCOUNT_STORAGE_KEY,
  DEMO_LOGIN_CREDENTIALS,
  DEMO_SESSION_STORAGE_KEY,
  findDemoLogin,
  isValidDemoPassword,
  readDemoSession,
  saveDemoAccount,
  saveDemoSession,
} from '../src/utils/demoAuth.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('demo password validation enforces 12 to 16 characters and complexity', () => {
  assert.equal(isValidDemoPassword('StrongPass12'), true);
  assert.equal(isValidDemoPassword('StrongPassword12'), true);
  assert.equal(isValidDemoPassword('ShortPass1'), false);
  assert.equal(isValidDemoPassword('StrongPassword123'), false);
  assert.equal(isValidDemoPassword('alllowercase12'), false);
  assert.equal(isValidDemoPassword('ALLUPPERCASE12'), false);
  assert.equal(isValidDemoPassword('NoNumbersHere'), false);
});

test('predefined demo credentials resolve only for exact mock passwords', () => {
  assert.equal(DEMO_LOGIN_CREDENTIALS.length, 4);
  assert.equal(findDemoLogin('ADMIN@DEMO.EVENTHUB', 'AdminDemo123')?.role, 'admin');
  assert.equal(findDemoLogin('admin', 'AdminDemo123')?.role, 'admin');
  assert.equal(findDemoLogin('CUSTOMER@DEMO.EVENTHUB', 'CustomerDemo12')?.role, 'customer');
  assert.equal(findDemoLogin('customer', 'CustomerDemo12')?.role, 'customer');
  assert.equal(findDemoLogin('organizer@demo.eventhub', 'Organizer12Ab')?.role, 'organizer');
  assert.equal(findDemoLogin('organizer', 'Organizer12Ab')?.role, 'organizer');
  assert.equal(findDemoLogin('vendor@demo.eventhub', 'VendorDemo12')?.role, 'vendor');
  assert.equal(findDemoLogin('vendor', 'VendorDemo12')?.role, 'vendor');
  assert.equal(findDemoLogin('vendor@demo.eventhub', 'wrong-password'), null);
});

test('demo storage persists only non-sensitive account and session profile fields', () => {
  const storage = createStorage();
  const profile = {
    name: ' Demo User ',
    email: 'DEMO@example.com',
    role: 'customer',
    password: 'NeverStoreThis12',
    token: 'never-store-this-token',
  };

  saveDemoAccount(profile, storage);
  saveDemoSession(profile, storage);

  const storedAccountData = storage.getItem(DEMO_ACCOUNT_STORAGE_KEY);
  const storedSessionData = storage.getItem(DEMO_SESSION_STORAGE_KEY);
  assert.deepEqual(JSON.parse(storedAccountData), [{ name: 'Demo User', email: 'demo@example.com', role: 'customer' }]);
  assert.deepEqual(readDemoSession(storage), { name: 'Demo User', email: 'demo@example.com', role: 'customer' });
  assert.doesNotMatch(`${storedAccountData}${storedSessionData}`, /password|token/i);
  assert.throws(() => saveDemoAccount(profile, storage), /already exists/);
  clearDemoSession(storage);
  assert.equal(readDemoSession(storage), null);
});
