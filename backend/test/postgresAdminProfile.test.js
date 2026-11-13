import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import { once } from 'node:events';
import test from 'node:test';
import { createPostgresAdminProfileRouter } from '../src/routes/postgresAdminProfile.js';
import { hashToken } from '../src/lib/security.js';

const initialToken = 'postgres-admin-profile-test-session';
const otpValue = '123456';

test('PostgreSQL administrator profile, password, and email APIs preserve the legacy contracts', async (t) => {
  const profile = {
    id: 17,
    full_name: 'Profile Administrator',
    email: 'admin@example.test',
    phone: '555-0101',
    status: 'active',
    created_at: '2024-01-02T10:00:00.000Z',
    has_profile_photo: false,
    roles: 'Admin',
  };
  const sessions = new Set([hashToken(initialToken)]);
  const statements = [];
  const audits = [];
  let passwordHash = await bcrypt.hash('CurrentAdminPassword123', 4);
  let challenge = null;
  let emailConfigured = true;
  let emailDeliveryFails = false;

  const query = async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes('STRING_AGG(DISTINCT r.name')) return { rows: [{ ...profile }] };
    if (sql.startsWith('SELECT id, full_name, phone FROM users')) {
      return { rows: [{ id: profile.id, full_name: profile.full_name, phone: profile.phone }] };
    }
    if (sql.startsWith('SELECT password_hash FROM users')) return { rows: [{ password_hash: passwordHash }] };
    if (sql.startsWith('SELECT id, full_name, email, password_hash FROM users')) {
      return {
        rows: [{
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          password_hash: passwordHash,
        }],
      };
    }
    if (sql.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
      return { rows: values[0] === 'taken@example.test' ? [{ id: 21 }] : [] };
    }
    if (sql.startsWith('SELECT last_sent_at >')) return { rows: [] };
    if (sql.startsWith('SELECT email FROM users')) return { rows: [{ email: profile.email }] };
    if (sql.startsWith('SELECT id, current_email, pending_email')) {
      return {
        rows: challenge ? [{
          ...challenge,
          expired: false,
        }] : [],
      };
    }
    if (sql.startsWith('UPDATE users SET full_name') || sql.startsWith('UPDATE users SET phone')) {
      const fieldNames = [...sql.matchAll(/([a-z_]+) = \$\d+/g)].map((match) => match[1]);
      fieldNames.forEach((field, index) => {
        if (field !== 'id') profile[field] = values[index];
      });
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE users SET password_hash')) {
      passwordHash = values[0];
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE users SET email')) {
      profile.email = values[0];
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM admin_email_change_otp_challenges WHERE user_id')) {
      challenge = null;
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM admin_email_change_otp_challenges WHERE id =')) {
      challenge = null;
      return { rows: [] };
    }
    if (sql.includes('WHERE expires_at <= NOW()')) {
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO admin_email_change_otp_challenges')) {
      challenge = {
        id: 44,
        current_email: values[1],
        pending_email: values[2],
        otp_hash: values[3],
        otp_salt: values[4],
        failed_attempts: 0,
      };
      return { rows: [{ id: challenge.id }] };
    }
    if (sql.startsWith('UPDATE admin_email_change_otp_challenges SET failed_attempts')) {
      challenge.failed_attempts = values[0];
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM admin_sessions')) {
      if (sql.includes('token_hash <>')) sessions.delete(values[1]);
      else sessions.clear();
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO admin_sessions')) {
      sessions.add(values[0]);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM user_sessions')) return { rows: [] };
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audits.push(values);
      return { rows: [] };
    }
    if (sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE SAVEPOINT')) return { rows: [] };
    throw new Error(`Unexpected SQL in profile API test: ${sql}`);
  };

  const database = {
    query,
    async inTransaction(work) {
      return work({ query });
    },
  };
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.admin = { id: profile.id };
    next();
  });
  app.locals.adminEmailChange = {
    emailConfigured: () => emailConfigured,
    emailSender: async () => {
      if (emailDeliveryFails) throw new Error('test delivery failure');
    },
    noticeSender: async () => {},
    otpGenerator: () => otpValue,
    otpHasher: async () => ({ hash: 'a'.repeat(128), salt: 'b'.repeat(32) }),
    otpVerifier: async (otp) => otp === otpValue,
  };
  app.use('/api/admin', createPostgresAdminProfileRouter({ database }));
  app.use((_error, _req, res, _next) => res.status(500).json({ error: 'Request failed.' }));
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  const request = (path, options = {}, token = initialToken) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Cookie: `admin_session=${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  const loaded = await request('/profile');
  assert.equal(loaded.status, 200);
  const loadedBody = await loaded.json();
  assert.equal(loadedBody.data.email, profile.email);
  assert.equal(loadedBody.data.roles, 'Admin');
  assert.equal('password_hash' in loadedBody.data, false);

  const patched = await request('/profile', {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Updated Profile', phone: null }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).user.full_name, 'Updated Profile');
  assert.equal(profile.phone, null);
  assert.ok(audits.some((values) => values[1] === 'admin.profile_updated'));

  const invalidPassword = await request('/profile/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'CurrentAdminPassword123', newPassword: 'weak' }),
  });
  assert.equal(invalidPassword.status, 400);
  const wrongPassword = await request('/profile/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'StrongPass123!' }),
  });
  assert.equal(wrongPassword.status, 400);

  const changedPassword = await request('/profile/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'CurrentAdminPassword123', newPassword: 'StrongPass123!' }),
  });
  assert.equal(changedPassword.status, 200);
  const cookie = changedPassword.headers.get('set-cookie');
  const rotatedToken = decodeURIComponent(cookie.match(/admin_session=([^;]+)/)[1]);
  assert.equal(sessions.has(hashToken(initialToken)), false);
  assert.equal(sessions.has(hashToken(rotatedToken)), true);
  assert.equal(await bcrypt.compare('StrongPass123!', passwordHash), true);

  emailConfigured = false;
  const unavailableEmail = await request('/profile/email-change', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-sent@example.test', currentPassword: 'StrongPass123!' }),
  }, rotatedToken);
  assert.equal(unavailableEmail.status, 503);
  assert.equal(challenge, null);
  emailConfigured = true;
  emailDeliveryFails = true;
  const undeliveredEmail = await request('/profile/email-change', {
    method: 'POST',
    body: JSON.stringify({ email: 'undelivered@example.test', currentPassword: 'StrongPass123!' }),
  }, rotatedToken);
  assert.equal(undeliveredEmail.status, 503);
  assert.equal(challenge, null);
  emailDeliveryFails = false;

  const duplicateEmail = await request('/profile/email-change', {
    method: 'POST',
    body: JSON.stringify({ email: 'taken@example.test', currentPassword: 'StrongPass123!' }),
  }, rotatedToken);
  assert.equal(duplicateEmail.status, 409, await duplicateEmail.text());

  const requestedEmail = await request('/profile/email-change', {
    method: 'POST',
    body: JSON.stringify({ email: 'NEW@example.test', currentPassword: 'StrongPass123!' }),
  }, rotatedToken);
  assert.equal(requestedEmail.status, 202);
  const requestedBody = await requestedEmail.json();
  assert.doesNotMatch(JSON.stringify(requestedBody), /123456|otp|hash/i);
  assert.equal(profile.email, 'admin@example.test');

  const wrongOtp = await request('/profile/email-change/verify', {
    method: 'POST',
    body: JSON.stringify({ otp: '000000' }),
  }, rotatedToken);
  assert.equal(wrongOtp.status, 400);
  const verified = await request('/profile/email-change/verify', {
    method: 'POST',
    body: JSON.stringify({ otp: otpValue }),
  }, rotatedToken);
  assert.equal(verified.status, 200);
  assert.deepEqual((await verified.json()).data, { email: 'new@example.test' });
  assert.equal(profile.email, 'new@example.test');
  assert.ok(audits.some((values) => values[1] === 'admin.password_changed'));
  assert.ok(audits.some((values) => values[1] === 'admin.profile_email_changed'));
  assert.ok(statements.every(({ sql }) => !/\?/.test(sql)), 'route SQL uses PostgreSQL placeholders');
  assert.ok(audits.every((values) => !values.some((value) => String(value).includes(otpValue))));
});
