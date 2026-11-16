import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const accounts = [
  { id: 21, role: 'customer', token: 'avatar-customer-session' },
  { id: 22, role: 'organizer', token: 'avatar-organizer-session' },
  { id: 23, role: 'vendor', token: 'avatar-vendor-session' },
];
const sessions = new Map(accounts.map((account) => [hashToken(account.token), account]));
const profiles = new Map(accounts.map(({ id }) => [id, { profile_photo: null, profile_photo_mime: null }]));
let profileQueryError;

async function execute(sql, values = []) {
  if (sql.startsWith('SELECT profile_photo, profile_photo_mime FROM users')) {
    if (profileQueryError) throw profileQueryError;
    return [[profiles.get(values[0]) || { profile_photo: null, profile_photo_mime: null }]];
  }
  if (sql.startsWith('UPDATE users SET profile_photo = $1')) {
    const profile = profiles.get(values[2]);
    profile.profile_photo = values[0];
    profile.profile_photo_mime = values[1];
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE users SET profile_photo = NULL')) {
    const profile = profiles.get(values[0]);
    profile.profile_photo = null;
    profile.profile_photo_mime = null;
    return [{ affectedRows: 1 }];
  }
  if (sql.includes('FROM user_sessions s')) {
    const account = sessions.get(values[0]);
    return [account ? [{
      id: account.id,
      full_name: `${account.role} account`,
      email: `${account.role}@example.test`,
      phone: null,
      status: 'active',
      role: account.role,
      permission_keys: '',
    }] : []];
  }
  return [{ affectedRows: 1 }];
}

const app = createApp({ database: { execute } });
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function avatarRequest(account, options = {}) {
  const headers = new Headers(options.headers || {});
  if (account) headers.set('Cookie', `platform_session=${account.token}`);
  return fetch(`${baseUrl}/api/users/me/avatar`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('shared avatar reads only the authenticated account photo and returns 204 when missing', async () => {
  const customerPhoto = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  profiles.get(accounts[0].id).profile_photo = customerPhoto;
  profiles.get(accounts[0].id).profile_photo_mime = 'image/png';

  const customerRead = await avatarRequest(accounts[0]);
  assert.equal(customerRead.status, 200);
  assert.equal(customerRead.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await customerRead.arrayBuffer()), customerPhoto);

  const otherAccountRead = await avatarRequest(accounts[1]);
  assert.equal(otherAccountRead.status, 204);
  const missingRead = await avatarRequest(accounts[2]);
  assert.equal(missingRead.status, 204);

  const unauthorizedRead = await avatarRequest(null);
  assert.equal(unauthorizedRead.status, 401);
});

test('shared avatar exposes database read failures as server errors', async () => {
  profileQueryError = new Error('database unavailable');
  try {
    const response = await avatarRequest(accounts[0]);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { message: 'The request could not be completed.' });
  } finally {
    profileQueryError = undefined;
  }
});

test('multipart avatars are isolated to the authenticated customer, organizer, or vendor', async () => {
  for (const account of accounts) {
    for (const profile of profiles.values()) {
      profile.profile_photo = null;
      profile.profile_photo_mime = null;
    }
    const form = new FormData();
    form.append('avatar', new Blob([pngBytes], { type: 'image/png' }), `${account.role}.png`);
    const response = await avatarRequest(account, { method: 'POST', body: form });
    assert.equal(response.status, 200, account.role);
    assert.deepEqual(profiles.get(account.id).profile_photo, pngBytes, account.role);
    for (const other of accounts.filter((candidate) => candidate.id !== account.id)) {
      assert.equal(profiles.get(other.id).profile_photo, null, `${other.role} profile stays unchanged`);
    }
  }
});

test('shared avatar endpoint rejects unsupported MIME types and mismatched image data', async () => {
  const unsupported = new FormData();
  unsupported.append('avatar', new Blob(['not an image'], { type: 'text/plain' }), 'avatar.txt');
  const unsupportedResponse = await avatarRequest(accounts[0], { method: 'POST', body: unsupported });
  assert.equal(unsupportedResponse.status, 400);

  const mismatched = new FormData();
  mismatched.append('avatar', new Blob(['not a png'], { type: 'image/png' }), 'avatar.png');
  const mismatchedResponse = await avatarRequest(accounts[0], { method: 'POST', body: mismatched });
  assert.equal(mismatchedResponse.status, 400);
});