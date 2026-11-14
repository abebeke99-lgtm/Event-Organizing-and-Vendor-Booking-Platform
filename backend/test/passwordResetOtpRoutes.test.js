import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { createPostgresAuthRouter } from '../src/routes/postgresAuth.js';
import { hashToken } from '../src/lib/authFlow.js';

const otpSecret = 'test-only-reset-otp-secret-with-32-bytes';

function createDatabase() {
  const originalPasswordHash = bcrypt.hashSync('CurrentPassword9', 4);
  const users = new Map([
    ['active@example.test', {
      id: 1, full_name: 'Active User', email: 'active@example.test',
      password_hash: originalPasswordHash, status: 'active', preferred_language: 'en',
    }],
    ['disabled@example.test', {
      id: 2, full_name: 'Disabled User', email: 'disabled@example.test',
      password_hash: originalPasswordHash, status: 'suspended', preferred_language: 'am',
    }],
    ['failure@example.test', {
      id: 3, full_name: 'Mail Failure User', email: 'failure@example.test',
      password_hash: originalPasswordHash, status: 'active', preferred_language: 'en',
    }],
  ]);
  const otps = [];
  const resetSessions = [];
  const userSessions = [{ user_id: 1 }];
  const adminSessions = [{ user_id: 1 }];
  const audits = [];
  let nextOtpId = 1;

  async function query(sql, values = []) {
    if (sql.includes('FROM users WHERE LOWER(email) = $1')) {
      const user = users.get(values[0]);
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes('SELECT id FROM password_reset_otps')) {
      const challenge = [...otps].reverse().find((entry) => entry.userId === values[0]
        && Date.now() - entry.createdAt < 60_000);
      return { rows: challenge ? [{ id: challenge.id }] : [], rowCount: challenge ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE password_reset_otps SET used_at = NOW()') && sql.includes('user_id = $1')) {
      const recent = sql.includes('NOT EXISTS')
        && otps.some((entry) => entry.userId === values[0] && Date.now() - entry.createdAt < 60_000);
      if (recent) return { rows: [], rowCount: 0 };
      for (const challenge of otps) {
        if (challenge.userId === values[0] && challenge.usedAt === null) challenge.usedAt = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE password_reset_sessions SET used_at = NOW()') && sql.includes('user_id = $1')) {
      const recent = sql.includes('NOT EXISTS')
        && otps.some((entry) => entry.userId === values[0] && Date.now() - entry.createdAt < 60_000);
      if (recent) return { rows: [], rowCount: 0 };
      for (const session of resetSessions) {
        if (session.userId === values[0] && session.usedAt === null) session.usedAt = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE password_reset_otp_challenges')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO password_reset_otps')) {
      const [userId, otpHash, expiryMinutes] = values;
      const user = [...users.values()].find((entry) => entry.id === userId && entry.status === 'active');
      const recent = otps.some((entry) => entry.userId === userId && Date.now() - entry.createdAt < 60_000);
      if (!user || recent) return { rows: [], rowCount: 0 };
      const row = {
        id: nextOtpId++, userId, otpHash, attempts: 0, usedAt: null,
        expiresAt: new Date(Date.now() + Number(expiryMinutes) * 60_000),
        createdAt: Date.now(),
      };
      otps.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (sql.includes('FROM password_reset_otps otp')) {
      const user = [...users.values()].find((candidate) => candidate.email === values[0]);
      const challenge = user && [...otps].reverse().find((entry) => entry.userId === user.id);
      const row = challenge && challenge.usedAt === null
        ? {
          id: challenge.id, user_id: challenge.userId, otp_hash: challenge.otpHash,
          expires_at: challenge.expiresAt, attempts: challenge.attempts, status: user.status,
        }
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE password_reset_otps') && sql.includes('SET attempts =')) {
      const [attempts, id] = values;
      const challenge = otps.find((entry) => entry.id === id);
      challenge.attempts = attempts;
      if (attempts >= 5) challenge.usedAt = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE password_reset_otps SET used_at = NOW() WHERE id')) {
      const challenge = otps.find((entry) => entry.id === values[0]);
      if (challenge) challenge.usedAt = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO password_reset_sessions')) {
      const [userId, tokenHash] = values;
      resetSessions.push({
        userId, tokenHash, usedAt: null, expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM password_reset_sessions reset')) {
      const [tokenHash, email] = values;
      const session = resetSessions.find((entry) => entry.tokenHash === tokenHash);
      const user = [...users.values()].find((entry) => entry.email === email);
      const row = session && user && session.userId === user.id && session.usedAt === null
        && session.expiresAt > new Date()
        ? {
          reset_session_id: 1, user_id: user.id, email: user.email,
          full_name: user.full_name, password_hash: user.password_hash,
          status: user.status, preferred_language: user.preferred_language,
        }
        : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE users SET password_hash = $1 WHERE id = $2')) {
      const user = [...users.values()].find((entry) => entry.id === values[1]);
      user.password_hash = values[0];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE password_reset_sessions SET used_at = NOW() WHERE user_id')) {
      for (const session of resetSessions) {
        if (session.userId === values[0] && session.usedAt === null) session.usedAt = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM password_reset_otp_challenges')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('DELETE FROM password_reset_tokens')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('DELETE FROM user_sessions')) {
      userSessions.splice(0, userSessions.length, ...userSessions.filter((row) => row.user_id !== values[0]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM admin_sessions')) {
      adminSessions.splice(0, adminSessions.length, ...adminSessions.filter((row) => row.user_id !== values[0]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      audits.push(values);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL in reset route test: ${sql}`);
  }

  return {
    dialect: 'postgres',
    query,
    inTransaction: (work) => work({ query }),
    users,
    otps,
    resetSessions,
    userSessions,
    adminSessions,
    audits,
    originalPasswordHash,
  };
}

test('PostgreSQL OTP reset is generic, rate-limited, single-use, and invalidates sessions', async (t) => {
  const database = createDatabase();
  const deliveredCodes = [];
  const app = express();
  app.use(express.json());
  app.use('/api/platform', createPostgresAuthRouter({
    database,
    otpHmacSecret: otpSecret,
    otpExpiryMinutes: '10',
    emailConfiguration: {},
    resetOtpEmailSender: async (message) => {
      deliveredCodes.push(message.otp);
      if (message.email === 'failure@example.test') throw new Error(`SMTP rejected OTP ${message.otp}`);
    },
    passwordChangedEmailSender: async () => {},
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform/account/password`;
  const post = (path, body) => fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const requestCode = (email) => post('forgot', { email });

  const unknown = await requestCode('unknown@example.test');
  const unknownBody = await unknown.json();
  assert.equal(unknown.status, 202);
  assert.equal(unknownBody.message, 'If an account exists for this email, a verification code has been sent.');
  assert.equal(deliveredCodes.length, 0);

  const requested = await requestCode('active@example.test');
  const knownBody = await requested.json();
  assert.equal(requested.status, 202);
  assert.deepEqual(knownBody, unknownBody);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveredCodes.length, 1);
  assert.equal(JSON.stringify(knownBody).includes(deliveredCodes[0]), false);
  assert.equal(database.otps[0].otpHash.length, 64);
  assert.equal(JSON.stringify(database.otps).includes(deliveredCodes[0]), false);

  const cooldown = await requestCode('active@example.test');
  assert.equal(cooldown.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveredCodes.length, 1);

  const wrongCode = deliveredCodes[0] === '000000' ? '000001' : '000000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = await post('verify-otp', { email: 'active@example.test', code: wrongCode });
    assert.equal(wrong.status, 400);
    assert.deepEqual(await wrong.json(), { error: 'Invalid or expired code.' });
  }
  assert.equal(database.otps[0].attempts, 5);
  assert.ok(database.otps[0].usedAt);

  database.otps[0].createdAt = Date.now() - 61_000;
  const resent = await requestCode('active@example.test');
  assert.equal(resent.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveredCodes.length, 2);
  database.otps[1].expiresAt = new Date(Date.now() - 1);
  const expired = await post('verify-otp', { email: 'active@example.test', code: deliveredCodes[1] });
  assert.equal(expired.status, 400);

  database.otps[1].createdAt = Date.now() - 61_000;
  const finalRequest = await requestCode('active@example.test');
  assert.equal(finalRequest.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  const code = deliveredCodes[2];
  const verified = await post('verify-otp', { email: 'active@example.test', code });
  const verifiedBody = await verified.json();
  assert.equal(verified.status, 200);
  assert.equal(typeof verifiedBody.resetSessionToken, 'string');
  assert.ok(Buffer.from(verifiedBody.resetSessionToken, 'base64url').length >= 32);
  assert.equal(JSON.stringify(verifiedBody).includes(code), false);
  assert.equal(JSON.stringify(database.resetSessions).includes(verifiedBody.resetSessionToken), false);
  assert.equal(database.resetSessions[0].tokenHash, hashToken(verifiedBody.resetSessionToken));
  const reusedCode = await post('verify-otp', { email: 'active@example.test', code });
  assert.equal(reusedCode.status, 400);

  const resetBody = {
    email: 'active@example.test',
    resetSessionToken: verifiedBody.resetSessionToken,
    newPassword: 'StrongerPassword9',
    confirmPassword: 'StrongerPassword9',
  };
  const weak = await post('reset', { ...resetBody, newPassword: 'weak', confirmPassword: 'weak' });
  assert.equal(weak.status, 400);
  const reusedPassword = await post('reset', {
    ...resetBody,
    newPassword: 'CurrentPassword9',
    confirmPassword: 'CurrentPassword9',
  });
  assert.equal(reusedPassword.status, 400);
  const reset = await post('reset', resetBody);
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { message: 'Password reset successfully. Please sign in.' });
  assert.equal(await bcrypt.compare('StrongerPassword9', database.users.get('active@example.test').password_hash), true);
  assert.equal(database.userSessions.length, 0);
  assert.equal(database.adminSessions.length, 0);
  assert.equal(database.audits.length, 1);
  assert.ok(database.resetSessions.every((session) => session.usedAt));
  const reusedToken = await post('reset', resetBody);
  assert.equal(reusedToken.status, 400);
  const expiredResetSession = database.resetSessions[0];
  expiredResetSession.usedAt = null;
  expiredResetSession.expiresAt = new Date(Date.now() - 1);
  assert.equal((await post('reset', resetBody)).status, 400);
  expiredResetSession.expiresAt = new Date(Date.now() + 60_000);

  const disabled = await requestCode('disabled@example.test');
  assert.equal(disabled.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveredCodes.length, 3);

  const originalConsoleError = console.error;
  const safeLogs = [];
  console.error = (...parts) => safeLogs.push(parts.join(' '));
  try {
    assert.equal((await requestCode('failure@example.test')).status, 202);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(deliveredCodes.length, 4);
  assert.ok(safeLogs.length > 0);
  assert.equal(safeLogs.some((line) => line.includes(deliveredCodes[3])), false);
  assert.equal(safeLogs.some((line) => line.includes('SMTP rejected OTP')), false);
  assert.ok(database.otps.find((entry) => entry.userId === 3)?.usedAt);

  const firstRateLimitedEmail = await requestCode('unknown@example.test');
  assert.equal(firstRateLimitedEmail.status, 202);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await requestCode('unknown@example.test')).status, 202);
  }
  assert.equal((await requestCode('unknown@example.test')).status, 429);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await post('verify-otp', { email: 'active@example.test', code })).status, 400);
  }
  assert.equal((await post('verify-otp', { email: 'active@example.test', code })).status, 429);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalid = await post('reset', {
      ...resetBody,
      resetSessionToken: `invalid-reset-token-${attempt}`.padEnd(32, 'x'),
    });
    assert.equal(invalid.status, 400);
  }
  assert.equal((await post('reset', {
    ...resetBody,
    resetSessionToken: 'invalid-reset-token-rate-limit'.padEnd(32, 'x'),
  })).status, 429);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await requestCode(`unknown-${attempt}@example.test`)).status, 202);
  }
  assert.equal((await requestCode('unknown-ip-limit@example.test')).status, 429);
});
