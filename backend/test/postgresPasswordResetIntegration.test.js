import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import bcrypt from 'bcryptjs';
import { test } from 'node:test';
import { createPostgresAuthRouter } from '../src/routes/postgresAuth.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL password reset verifies OTP, changes the password, and invalidates sessions', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const database = createPostgresDatabase(await loadNeonTestEnvironment());
  const email = `pg-reset-${randomUUID()}@example.invalid`;
  const otpHmacSecret = randomBytes(32).toString('hex');
  let userId;
  let deliveredOtp;
  let resolveOtpDelivery;
  const otpDelivery = new Promise((resolve) => {
    resolveOtpDelivery = resolve;
  });
  let server;

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.match(identity.server_version, /^PostgreSQL 18\b/);
    assert.equal(identity.database_name, 'eventhub');

    const user = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      ['Neon reset integration fixture', email, await bcrypt.hash('InitialPass123', 4)],
    );
    userId = user.rows[0].id;
    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [hashToken(randomBytes(32).toString('hex')), userId],
    );

    const app = express();
    app.use(express.json());
    app.use('/api/platform', createPostgresAuthRouter({
      database: database.runtimeAdapter,
      otpHmacSecret,
      otpExpiryMinutes: '10',
      emailConfiguration: { test: true },
      resetOtpEmailSender: async ({ otp }) => {
        deliveredOtp = otp;
        resolveOtpDelivery();
      },
      passwordChangedEmailSender: async () => {},
    }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform/account/password`;
    const post = (path, body) => fetch(`${baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const request = await post('forgot', { email });
    assert.equal(request.status, 202);
    let deliveryTimeout;
    try {
      await Promise.race([
        otpDelivery,
        new Promise((_, reject) => {
          deliveryTimeout = setTimeout(() => reject(new Error('OTP delivery callback timed out.')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(deliveryTimeout);
    }
    assert.match(deliveredOtp, /^\d{6}$/);

    const verification = await post('verify-otp', { email, code: deliveredOtp });
    assert.equal(verification.status, 200);
    const { resetSessionToken } = await verification.json();
    assert.equal(typeof resetSessionToken, 'string');
    assert.equal((await post('verify-otp', { email, code: deliveredOtp })).status, 400);

    const reset = await post('reset', {
      email,
      resetSessionToken,
      newPassword: 'ChangedPass456',
      confirmPassword: 'ChangedPass456',
    });
    assert.equal(reset.status, 200);

    const persisted = await database.runtimeAdapter.query(
      `SELECT password_hash,
              (SELECT COUNT(*) FROM user_sessions WHERE user_id = $1)::integer AS sessions,
              (SELECT COUNT(*) FROM audit_logs
               WHERE actor_id = $1 AND action = 'auth.password_reset')::integer AS audits
       FROM users WHERE id = $1`,
      [userId],
    );
    assert.equal(await bcrypt.compare('ChangedPass456', persisted.rows[0].password_hash), true);
    assert.equal(persisted.rows[0].sessions, 0);
    assert.equal(persisted.rows[0].audits, 1);
    assert.equal((await post('reset', {
      email,
      resetSessionToken,
      newPassword: 'AnotherPass789',
      confirmPassword: 'AnotherPass789',
    })).status, 400);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    try {
      if (userId) {
        await database.runtimeAdapter.query(
          "DELETE FROM audit_logs WHERE actor_id = $1 AND action = 'auth.password_reset'",
          [userId],
        );
        await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
      }
    } finally {
      await database.close();
    }
  }
});
