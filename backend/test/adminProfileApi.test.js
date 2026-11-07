import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const initialToken = 'admin-profile-test-session';
const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const statements = [];
const auditRecords = [];
const adminSessions = new Set([hashToken(initialToken)]);
let passwordHash;
let emailChangeChallenge = null;
let emailChangeEmail;
let emailDeliveryFailure = false;
const registeredEmails = new Set(['taken@example.test']);
const testEmailOtp = '123456';
let profile = {
  id: 17,
  full_name: 'Profile Administrator',
  email: 'admin@example.test',
  phone: '555-0101',
  preferred_language: 'en',
  status: 'active',
  created_at: '2024-01-02 10:00:00',
  roles: 'Admin',
  profile_photo: null,
  profile_photo_mime: null,
};

async function execute(sql, values = []) {
  statements.push({ sql, values });
  if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.preferred_language, u.password_hash, u.status')) {
    return [[profile.email === values[0] ? {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      preferred_language: profile.preferred_language,
      password_hash: passwordHash,
      status: profile.status,
      has_admin_role: 1,
      has_active_admin_role: 1,
    } : null].filter(Boolean)];
  }
  if (sql.includes('FROM admin_sessions s')) {
    return [adminSessions.has(values[0]) ? [{
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      preferred_language: profile.preferred_language,
      status: profile.status,
      roles: profile.roles,
    }] : []];
  }
  if (sql.startsWith('SELECT id, full_name, email, password_hash FROM users WHERE id = ? FOR UPDATE')) {
    return [[{ id: profile.id, full_name: profile.full_name, email: profile.email, password_hash: passwordHash }]];
  }
  if (sql.startsWith('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?')) {
    return [[registeredEmails.has(String(values[0]).toLowerCase()) ? { id: 21 } : null].filter(Boolean)];
  }
  if (sql.startsWith('DELETE FROM admin_email_change_otp_challenges WHERE expires_at <= NOW()')) {
    if (emailChangeChallenge?.expired || emailChangeChallenge?.consumed) emailChangeChallenge = null;
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT (last_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooldown_active')) {
    return [emailChangeChallenge ? [{ cooldown_active: false }] : []];
  }
  if (sql.startsWith('DELETE FROM admin_email_change_otp_challenges WHERE user_id = ?')) {
    emailChangeChallenge = null;
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('INSERT INTO admin_email_change_otp_challenges')) {
    emailChangeChallenge = {
      id: 44,
      user_id: values[0],
      current_email: values[1],
      pending_email: values[2],
      otp_hash: values[3],
      otp_salt: values[4],
      failed_attempts: 0,
      expired: false,
    };
    return [{ insertId: 44, affectedRows: 1 }];
  }
  if (sql.startsWith('DELETE FROM admin_email_change_otp_challenges WHERE id = ?')) {
    if (emailChangeChallenge?.id === values[0]) emailChangeChallenge = null;
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT id, current_email, pending_email, otp_hash, otp_salt, expires_at, failed_attempts')) {
    return [emailChangeChallenge ? [{ ...emailChangeChallenge, expired: Number(emailChangeChallenge.expired) }] : []];
  }
  if (sql.startsWith('SELECT email FROM users WHERE id = ? FOR UPDATE')) return [[{ email: profile.email }]];
  if (sql.startsWith('UPDATE admin_email_change_otp_challenges SET failed_attempts')) {
    if (emailChangeChallenge) emailChangeChallenge.failed_attempts = values[0];
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE users SET email = ? WHERE id = ?')) {
    profile.email = values[0];
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('DELETE FROM admin_sessions WHERE user_id = ? AND token_hash <> ?')) {
    adminSessions.clear();
    adminSessions.add(values[1]);
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at')) {
    return [[{
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      status: profile.status,
      created_at: profile.created_at,
      roles: profile.roles,
      has_profile_photo: Boolean(profile.profile_photo),
    }]];
  }
  if (sql.startsWith('SELECT id, action, entity_type, entity_id, outcome, severity, request_id')) {
    return [[{
      id: 92,
      action: 'admin.profile_updated',
      entity_type: 'user',
      entity_id: String(profile.id),
      outcome: 'success',
      severity: 'info',
      request_id: 'cf49e334-fb13-46fb-9819-952c19c2690a',
      created_at: '2026-10-30 10:00:00',
    }]];
  }
  if (sql.startsWith('SELECT profile_photo, profile_photo_mime FROM users')) {
    return [[{
      profile_photo: profile.profile_photo,
      profile_photo_mime: profile.profile_photo_mime,
    }]];
  }
  if (sql.startsWith('SELECT id, full_name, phone FROM users')) {
    return [[{ id: profile.id, full_name: profile.full_name, phone: profile.phone }]];
  }
  if (sql.startsWith('UPDATE users SET full_name') || sql.startsWith('UPDATE users SET phone')) {
    const fields = sql.match(/SET (.+) WHERE/)[1].split(', ').map((field) => field.split(' =')[0]);
    fields.forEach((field, index) => { profile[field] = values[index]; });
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT password_hash FROM users')) return [[{ password_hash: passwordHash }]];
  if (sql.startsWith('UPDATE users SET password_hash')) {
    passwordHash = values[0];
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('INSERT INTO admin_sessions')) {
    adminSessions.add(values[0]);
    return [{ insertId: 99, affectedRows: 1 }];
  }
  if (sql.startsWith('DELETE FROM admin_sessions WHERE user_id')) {
    adminSessions.clear();
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('DELETE FROM user_sessions WHERE user_id')) return [{ affectedRows: 1 }];
  if (sql.startsWith('UPDATE users SET profile_photo = ?')) {
    profile.profile_photo = values[0];
    profile.profile_photo_mime = values[1];
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE users SET profile_photo = NULL')) {
    profile.profile_photo = null;
    profile.profile_photo_mime = null;
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('INSERT INTO audit_logs')) {
    auditRecords.push({ sql, values });
    return [{ insertId: auditRecords.length, affectedRows: 1 }];
  }
  return [{ affectedRows: 1 }];
}

const database = {
  execute,
  async query() { return [[], []]; },
  async getConnection() {
    return {
      execute,
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
    };
  },
};
const app = createApp({
  database,
  emailChangeEmailConfigured: () => true,
  emailChangeEmailSender: async (message) => {
    emailChangeEmail = message.email;
    if (emailDeliveryFailure) throw new Error('test delivery failure');
  },
  emailChangeOtpGenerator: () => testEmailOtp,
  emailChangeOtpHasher: async () => ({ hash: 'a'.repeat(128), salt: 'b'.repeat(32) }),
  emailChangeOtpVerifier: async (otp) => otp === testEmailOtp,
  emailChangeNoticeSender: async () => {},
});
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  passwordHash = await bcrypt.hash('CurrentAdminPassword123', 4);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function adminRequest(path, options = {}, token = initialToken) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${token}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

test('administrator profile is scoped to the authenticated session and omits secrets', async () => {
  statements.length = 0;
  const response = await adminRequest('/api/admin/profile?id=999');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.id, profile.id);
  assert.equal(result.data.roles, 'Admin');
  assert.equal(result.data.status, 'active');
  assert.equal('password_hash' in result.data, false);
  assert.equal('profile_photo' in result.data, false);
  const profileQuery = statements.find(({ sql }) => sql.includes('has_profile_photo'));
  assert.deepEqual(profileQuery.values, [profile.id]);
});

test('administrator profile activity only queries the authenticated actor', async () => {
  statements.length = 0;
  const response = await adminRequest('/api/admin/profile/activity');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].action, 'admin.profile_updated');
  const activityQuery = statements.find(({ sql }) => sql.startsWith('SELECT id, action, entity_type'));
  assert.deepEqual(activityQuery.values, [profile.id]);
  assert.match(activityQuery.sql, /WHERE actor_id = \?/);
});

test('administrator can update only permitted profile fields and changes are audited', async () => {
  const changed = await adminRequest('/api/admin/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Updated Admin', phone: '555-0199' }),
  });
  assert.equal(changed.status, 200);
  const result = await changed.json();
  assert.equal(result.user.full_name, 'Updated Admin');
  assert.equal(result.user.phone, '555-0199');
  assert.ok(auditRecords.some(({ values }) => values[1] === 'admin.profile_updated'));

  const roleChange = await adminRequest('/api/admin/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: 3 }),
  });
  assert.equal(roleChange.status, 400);
});

test('administrator language preference accepts supported locales and rejects invalid values', async () => {
  const saved = await adminRequest('/api/admin/profile/language', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'am' }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).data, { language: 'am' });
  assert.ok(statements.some(({ sql, values }) => sql === 'UPDATE users SET preferred_language = ? WHERE id = ?'
    && values[0] === 'am' && values[1] === profile.id));

  const invalid = await adminRequest('/api/admin/profile/language', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'fr' }),
  });
  assert.equal(invalid.status, 400);

  const anonymous = await adminRequest('/api/admin/profile/language', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: 'en' }),
  }, 'invalid-session');
  assert.equal(anonymous.status, 401);
});

test('administrator profile image validates content and audits successful upload/removal', async () => {
  const invalid = await adminRequest('/api/admin/profile/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('not-an-image'),
  });
  assert.equal(invalid.status, 400);

  const uploaded = await adminRequest('/api/admin/profile/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: imageBytes,
  });
  assert.equal(uploaded.status, 200);
  assert.equal(profile.profile_photo_mime, 'image/png');
  assert.ok(auditRecords.some(({ values }) => values[1] === 'admin.profile_photo_updated'));

  const removed = await adminRequest('/api/admin/profile/photo', { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal(profile.profile_photo, null);
  assert.ok(auditRecords.some(({ values }) => values[1] === 'admin.profile_photo_removed'));
});

test('shared avatar endpoint stores and removes the authenticated administrator photo', async () => {
  const form = new FormData();
  form.append('avatar', new Blob([imageBytes], { type: 'image/png' }), 'avatar.png');
  const uploaded = await adminRequest('/api/users/me/avatar', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  assert.deepEqual(profile.profile_photo, imageBytes);
  assert.equal(profile.profile_photo_mime, 'image/png');

  const fetched = await adminRequest('/api/users/me/avatar');
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), imageBytes);

  const removed = await adminRequest('/api/users/me/avatar', { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal(profile.profile_photo, null);
});

test('password change requires the current password and rotates administrator sessions', async () => {
  const tooShortPassword = await adminRequest('/api/admin/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'CurrentAdminPassword123', newPassword: 'NewAdminPass123' }),
  });
  assert.equal(tooShortPassword.status, 400);

  const tooManyBytes = await adminRequest('/api/admin/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: 'CurrentAdminPassword123',
      newPassword: `A${'a'.repeat(14)}1${'é'.repeat(30)}`,
    }),
  });
  assert.equal(tooManyBytes.status, 400);

  const wrongPassword = await adminRequest('/api/admin/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'AdminPass1234567' }),
  });
  assert.equal(wrongPassword.status, 400);

  const invalidPassword = await adminRequest('/api/admin/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'CurrentAdminPassword123', newPassword: 'weak' }),
  });
  assert.equal(invalidPassword.status, 400);

  const changed = await adminRequest('/api/admin/profile/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'CurrentAdminPassword123', newPassword: 'AdminPass1234567' }),
  });
  assert.equal(changed.status, 200);
  const renewedCookie = changed.headers.get('set-cookie');
  assert.match(renewedCookie, /admin_session=/);
  assert.match(renewedCookie, /HttpOnly/i);
  assert.equal(adminSessions.has(hashToken(initialToken)), false);
  const rotatedToken = decodeURIComponent(renewedCookie.match(/admin_session=([^;]+)/)[1]);
  assert.equal(adminSessions.has(hashToken(rotatedToken)), true);
  assert.equal(await bcrypt.compare('AdminPass1234567', passwordHash), true);

  const oldSession = await adminRequest('/api/admin/profile', {}, initialToken);
  assert.equal(oldSession.status, 401);
  const newSession = await adminRequest('/api/admin/profile', {}, rotatedToken);
  assert.equal(newSession.status, 200);
  assert.ok(auditRecords.some(({ values }) => values[1] === 'admin.password_changed'));
});

test('administrator email changes stay pending until OTP verification and then use the new login identity', async () => {
  adminSessions.add(hashToken(initialToken));
  emailChangeChallenge = null;
  emailChangeEmail = '';

  const unauthenticated = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', currentPassword: 'AdminPass1234567' }),
  }, 'invalid-session');
  assert.equal(unauthenticated.status, 401);

  const invalidAddress = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', currentPassword: 'AdminPass1234567' }),
  });
  assert.equal(invalidAddress.status, 400);

  const wrongPassword = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', currentPassword: 'wrong-password' }),
  });
  assert.equal(wrongPassword.status, 400);

  const duplicate = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'taken@example.test', currentPassword: 'AdminPass1234567' }),
  });
  assert.equal(duplicate.status, 409);

  const requested = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ' NEW@example.test ', currentPassword: 'AdminPass1234567' }),
  });
  assert.equal(requested.status, 202);
  assert.doesNotMatch(JSON.stringify(await requested.json()), /123456/);
  assert.equal(profile.email, 'admin@example.test');
  assert.equal(emailChangeEmail, 'new@example.test');
  assert.notEqual(emailChangeChallenge.otp_hash, testEmailOtp);
  assert.equal(emailChangeChallenge.pending_email, 'new@example.test');

  const wrongOtp = await adminRequest('/api/admin/profile/email-change/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp: '000000' }),
  });
  assert.equal(wrongOtp.status, 400);
  assert.equal(profile.email, 'admin@example.test');

  const verified = await adminRequest('/api/admin/profile/email-change/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp: testEmailOtp }),
  });
  assert.equal(verified.status, 200);
  assert.deepEqual((await verified.json()).data, { email: 'new@example.test' });
  assert.equal(profile.email, 'new@example.test');
  assert.equal(adminSessions.has(hashToken(initialToken)), true);

  const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', password: 'AdminPass1234567' }),
  });
  assert.equal(newLogin.status, 200);
  assert.equal((await newLogin.json()).user.email, 'new@example.test');

  const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'AdminPass1234567' }),
  });
  assert.equal(oldLogin.status, 401);
  assert.ok(auditRecords.some(({ values }) => values[1] === 'admin.profile_email_changed'));

  emailDeliveryFailure = true;
  const undelivered = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'undelivered@example.test', currentPassword: 'AdminPass1234567' }),
  });
  assert.equal(undelivered.status, 503);
  assert.equal(emailChangeChallenge, null);
  assert.equal(profile.email, 'new@example.test');

  emailDeliveryFailure = false;
  const expiredRequest = await adminRequest('/api/admin/profile/email-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'expired@example.test', currentPassword: 'AdminPass1234567' }),
  });
  assert.equal(expiredRequest.status, 202);
  emailChangeChallenge.expired = true;
  const expiredOtp = await adminRequest('/api/admin/profile/email-change/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp: testEmailOtp }),
  });
  assert.equal(expiredOtp.status, 400);
  assert.equal(profile.email, 'new@example.test');
  assert.equal(emailChangeChallenge, null);
});
