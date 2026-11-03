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

async function execute(sql, values = []) {
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
  if (sql.startsWith('SELECT profile_photo, profile_photo_mime FROM users')) {
    return [[profiles.get(values[0]) || { profile_photo: null, profile_photo_mime: null }]];
  }
  if (sql.startsWith('UPDATE users SET profile_photo = ?')) {
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
  headers.set('Cookie', `platform_session=${account.token}`);
  return fetch(`${baseUrl}/api/users/me/avatar`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

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