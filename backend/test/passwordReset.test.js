import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const genericResponse = {
  message: 'If an account exists with this email, a verification code will be sent.',
};
const strongPassword = 'StrongPass1234';

function createHarness({ emailConfigured = true, emailSender = async () => {}, role = 'vendor' } = {}) {
  const state = {
    user: {
      id: 42,
      full_name: 'Ada Lovelace',
      email: 'ada@example.test',
      role,
      password_hash: bcrypt.hashSync('OldPassword1234', 4),
    },
    challenge: null,
    userSessionsDeleted: 0,
    adminSessionsDeleted: 0,
    auditEntries: [],
    emailCount: 0,
    userLookupCount: 0,
    otpSequence: 0,
  };
  const database = {
    async execute(statement, values = []) {
      if (statement.includes('FROM users WHERE email = ?')) {
        state.userLookupCount += 1;
        return [values[0] === state.user.email ? [{ ...state.user }] : [], []];
      }
      if (statement.includes('DELETE FROM password_reset_tokens')) return [{ affectedRows: 1 }, []];
      if (statement.includes('UPDATE password_reset_otp_challenges')) {
        if (state.challenge?.userId === values[0] && state.challenge.otpHash === values[1]) {
          state.challenge.expiresAt = new Date(Date.now() - 1000);
          state.challenge.consumedAt = new Date();
        }
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected database query in password reset test: ${statement}`);
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(statement, values = []) {
          if (statement.startsWith('SELECT id FROM users WHERE id =')) {
            return [state.user.id === values[0] ? [{ id: state.user.id }] : [], []];
          }
          if (statement.includes('SELECT id, (last_sent_at')) {
            const cooldownActive = state.challenge?.userId === values[0]
              && state.challenge.lastSentAt > Date.now() - 60_000;
            return [cooldownActive ? [{ id: 1, cooldown_active: 1 }] : [], []];
          }
          if (statement.startsWith('INSERT INTO password_reset_otp_challenges')) {
            state.challenge = {
              id: 1,
              userId: values[0],
              otpHash: values[1],
              otpSalt: values[2],
              expiresAt: new Date(Date.now() + 5 * 60_000),
              failedAttempts: 0,
              consumedAt: null,
              resetTokenHash: null,
              resetTokenExpiresAt: null,
              resetTokenUsedAt: null,
              lastSentAt: Date.now(),
            };
            return [{ affectedRows: 1 }, []];
          }
          if (statement.includes('SELECT id, otp_hash')) {
            const challenge = state.challenge;
            if (challenge?.userId !== values[0]) return [[], []];
            return [[{
              id: challenge.id,
              otp_hash: challenge.otpHash,
              otp_salt: challenge.otpSalt,
              failed_attempts: challenge.failedAttempts,
              consumed_at: challenge.consumedAt,
              is_unexpired: challenge.expiresAt > Date.now() ? 1 : 0,
            }], []];
          }
          if (statement.startsWith('UPDATE password_reset_otp_challenges SET failed_attempts')) {
            state.challenge.failedAttempts += 1;
            return [{ affectedRows: 1 }, []];
          }
          if (statement.includes('SET consumed_at = NOW(), reset_token_hash')) {
            state.challenge.consumedAt = new Date();
            state.challenge.resetTokenHash = values[0];
            state.challenge.resetTokenExpiresAt = new Date(Date.now() + 10 * 60_000);
            return [{ affectedRows: 1 }, []];
          }
          if (statement.includes('SELECT user_id FROM password_reset_otp_challenges')) {
            const challenge = state.challenge;
            const valid = challenge?.resetTokenHash === values[0]
              && !challenge.resetTokenUsedAt
              && challenge.resetTokenExpiresAt > Date.now();
            return [valid ? [{ user_id: challenge.userId }] : [], []];
          }
          if (statement.includes('SELECT MAX(r.is_admin = TRUE) AS has_admin_role')) {
            return [[{ has_admin_role: state.user.role === 'admin' ? 1 : 0 }], []];
          }
          if (statement.startsWith('UPDATE users SET password_hash')) {
            if (state.user.id !== values[1]) return [{ affectedRows: 0 }, []];
            state.user.password_hash = values[0];
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith('DELETE FROM password_reset_otp_challenges')) {
            if (state.challenge?.userId === values[0]) state.challenge = null;
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith('DELETE FROM password_reset_tokens')) return [{ affectedRows: 1 }, []];
          if (statement.startsWith('DELETE FROM user_sessions')) {
            state.userSessionsDeleted += 1;
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith('DELETE FROM admin_sessions')) {
            state.adminSessionsDeleted += 1;
            return [{ affectedRows: 1 }, []];
          }
          if (statement.startsWith('INSERT INTO audit_logs')) {
            state.auditEntries.push(values);
            return [{ affectedRows: 1 }, []];
          }
          throw new Error(`Unexpected SQL in password reset test: ${statement}`);
        },
      };
    },
  };
  const app = createApp({
    database,
    emailConfigured: () => emailConfigured,
    otpGenerator: () => {
      state.otpSequence += 1;
      return state.otpSequence === 1 ? '123456' : '654321';
    },
    emailSender: async (message) => {
      state.emailCount += 1;
      state.sentEmail = message;
      return emailSender(message);
    },
  });

  return { app, state };
}

async function withServer(harness, run) {
  const server = harness.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`, harness.state);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

async function post(baseUrl, route, body, headers = {}) {
  return fetch(`${baseUrl}/api/auth/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function waitForEmailCount(state, count) {
  for (let attempt = 0; attempt < 50 && state.emailCount < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(state.emailCount, count);
}

async function requestOtp(baseUrl, email = 'ada@example.test') {
  return post(baseUrl, 'forgot-password/otp', { email });
}

test('administrator password resets enforce the 12-to-16-character policy and allow any characters', async () => {
  const harness = createHarness({ role: 'admin' });
  await withServer(harness, async (baseUrl, state) => {
    await requestOtp(baseUrl);
    await waitForEmailCount(state, 1);
    const verification = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
    const resetCookie = verification.headers.get('set-cookie').split(';', 1)[0];
    const rejected = await post(baseUrl, 'reset-password', { newPassword: 'short' }, { Cookie: resetCookie });
    assert.equal(rejected.status, 400);
    assert.equal(state.userSessionsDeleted, 0);

    const tooLong = await post(baseUrl, 'reset-password', { newPassword: '12345678901234567' }, { Cookie: resetCookie });
    assert.equal(tooLong.status, 400);
    assert.equal(state.userSessionsDeleted, 0);

    const accepted = await post(baseUrl, 'reset-password', { newPassword: '!@#$%^&*()_+' }, { Cookie: resetCookie });
    assert.equal(accepted.status, 200);
    assert.equal(await bcrypt.compare('!@#$%^&*()_+', state.user.password_hash), true);
  });
});

test('OTP requests use generic responses and send mail only for registered accounts', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl, state) => {
    const registered = await requestOtp(baseUrl, 'ADA@example.test');
    const registeredBody = await registered.json();
    await waitForEmailCount(state, 1);
    const unknown = await requestOtp(baseUrl, 'unknown@example.test');
    const unknownBody = await unknown.json();

    assert.equal(registered.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(registeredBody, genericResponse);
    assert.deepEqual(unknownBody, genericResponse);
    assert.equal(state.sentEmail.otp, '123456');
    assert.equal(state.challenge.otpHash.length, 128);
    assert.notEqual(state.challenge.otpHash, state.sentEmail.otp);
    assert.equal(JSON.stringify(registeredBody).includes(state.sentEmail.otp), false);
  });
});

test('OTP verification grants a single-use HttpOnly reset authorization and resets passwords', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl, state) => {
    await requestOtp(baseUrl);
    await waitForEmailCount(state, 1);
    const verification = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
    const verificationBody = await verification.json();
    const cookieHeader = verification.headers.get('set-cookie');
    assert.equal(verification.status, 200);
    assert.deepEqual(verificationBody, { success: true, message: 'Verification successful.' });
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /Path=\/api\/auth/i);
    const resetCookie = cookieHeader.split(';', 1)[0];
    const rawAuthorizationToken = resetCookie.split('=').slice(1).join('=');
    assert.equal(state.challenge.resetTokenHash, hashToken(rawAuthorizationToken));
    assert.equal(JSON.stringify(verificationBody).includes(rawAuthorizationToken), false);

    const response = await post(baseUrl, 'reset-password', { newPassword: strongPassword }, { Cookie: resetCookie });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, message: 'Password reset successful.' });
    assert.equal(await bcrypt.compare(strongPassword, state.user.password_hash), true);
    assert.equal(await bcrypt.compare('OldPassword1234', state.user.password_hash), false);
    assert.equal(state.challenge, null);
    assert.equal(state.userSessionsDeleted, 1);
    assert.equal(state.adminSessionsDeleted, 1);
    assert.equal(state.user.role, 'vendor');
    assert.equal(state.auditEntries[0][1], 'auth.password_reset');

    const reused = await post(baseUrl, 'reset-password', { newPassword: strongPassword }, { Cookie: resetCookie });
    assert.equal(reused.status, 400);
    assert.equal(state.userSessionsDeleted, 1);
  });

  await test('OTP verification supports every account role without changing role assignments', async () => {
    for (const role of ['admin', 'customer', 'vendor', 'organizer', 'staff']) {
      const harness = createHarness({ role });
      await withServer(harness, async (baseUrl, state) => {
        await requestOtp(baseUrl);
        await waitForEmailCount(state, 1);
        const response = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
        assert.equal(response.status, 200, role);
        assert.equal(state.user.role, role);
      });
    }
  });

  await test('expired reset authorization cannot update the account password', async () => {
    const harness = createHarness();
    await withServer(harness, async (baseUrl, state) => {
      await requestOtp(baseUrl);
      await waitForEmailCount(state, 1);
      const verification = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
      const resetCookie = verification.headers.get('set-cookie').split(';', 1)[0];
      state.challenge.resetTokenExpiresAt = new Date(Date.now() - 1000);

      const response = await post(baseUrl, 'reset-password', { newPassword: strongPassword }, { Cookie: resetCookie });
      assert.equal(response.status, 400);
      assert.equal(await bcrypt.compare('OldPassword1234', state.user.password_hash), true);
      assert.equal(state.challenge !== null, true);
    });
  });
});

test('expired OTPs and incorrect OTPs cannot authorize password reset', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl, state) => {
    await requestOtp(baseUrl);
    await waitForEmailCount(state, 1);
    state.challenge.expiresAt = new Date(Date.now() - 1000);
    const expired = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
    assert.equal(expired.status, 400);
    assert.equal(state.challenge.resetTokenHash, null);

    state.challenge.lastSentAt = Date.now() - 61_000;
    const second = await post(baseUrl, 'resend-reset-otp', { email: state.user.email });
    assert.equal(second.status, 202);
    await waitForEmailCount(state, 2);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invalid = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: '000000' });
      assert.equal(invalid.status, 400);
    }
    const correctAfterLockout = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
    assert.equal(correctAfterLockout.status, 400);
    assert.equal(state.challenge.failedAttempts, 5);
    assert.equal(state.challenge.resetTokenHash, null);
  });
});

test('resending invalidates the previous OTP and enforces a cooldown', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl, state) => {
    await requestOtp(baseUrl);
    await waitForEmailCount(state, 1);
    const firstOtp = state.sentEmail.otp;
    const cooldownResponse = await post(baseUrl, 'resend-reset-otp', { email: state.user.email });
    assert.equal(cooldownResponse.status, 202);
    assert.equal(state.emailCount, 1);

    state.challenge.lastSentAt = Date.now() - 61_000;
    const resent = await post(baseUrl, 'resend-reset-otp', { email: state.user.email });
    assert.equal(resent.status, 202);
    await waitForEmailCount(state, 2);
    assert.notEqual(state.sentEmail.otp, firstOtp);
    const oldOtp = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: firstOtp });
    assert.equal(oldOtp.status, 400);
    const newOtp = await post(baseUrl, 'verify-reset-otp', { email: state.user.email, otp: state.sentEmail.otp });
    assert.equal(newOtp.status, 200);
  });
});

test('unconfigured SMTP returns the same service error without looking up accounts', async () => {
  const harness = createHarness({ emailConfigured: false });
  await withServer(harness, async (baseUrl, state) => {
    const registered = await requestOtp(baseUrl, state.user.email);
    const unknown = await requestOtp(baseUrl, 'unknown@example.test');
    assert.equal(registered.status, 503);
    assert.equal(unknown.status, 503);
    assert.deepEqual(await registered.json(), await unknown.json());
    assert.equal(state.userLookupCount, 0);
    assert.equal(state.emailCount, 0);
    assert.equal(state.challenge, null);
  });
});

test('SMTP delivery failures invalidate the code and do not reveal account status', async () => {
  const harness = createHarness({
    emailSender: async () => {
      throw Object.assign(new Error('SMTP delivery rejected.'), { code: 'SMTP_REJECTED' });
    },
  });
  await withServer(harness, async (baseUrl, state) => {
    const response = await requestOtp(baseUrl);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), genericResponse);
    await waitForEmailCount(state, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(state.challenge.expiresAt < new Date());
    assert.ok(state.challenge.consumedAt);
  });
});

test('OTP request rate limit rejects repeated requests', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await requestOtp(baseUrl, 'unknown@example.test'));
    }
    assert.deepEqual(responses.slice(0, 5).map((response) => response.status), [202, 202, 202, 202, 202]);
    assert.equal(responses[5].status, 429);
  });
});

test('reset endpoint enforces the registered password policy and reset authorization', async () => {
  const harness = createHarness();
  await withServer(harness, async (baseUrl) => {
    const weakPassword = await post(baseUrl, 'reset-password', { newPassword: 'weak' });
    assert.equal(weakPassword.status, 400);
    const noAuthorization = await post(baseUrl, 'reset-password', { newPassword: strongPassword });
    assert.equal(noAuthorization.status, 400);
  });
});
