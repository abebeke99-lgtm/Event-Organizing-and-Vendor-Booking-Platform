import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon administrator profile APIs update profiles, rotate passwords, and verify email changes', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const token = randomUUID() + randomUUID();
  const email = `pg-admin-profile-${suffix}@example.invalid`;
  const nextEmail = `pg-admin-profile-new-${suffix}@example.invalid`;
  const otp = '123456';
  let userId;
  let server;

  try {
    const adminRole = (await database.runtimeAdapter.query(
      'SELECT id FROM roles WHERE is_admin = TRUE AND is_active = TRUE LIMIT 1',
    )).rows[0];
    assert.ok(adminRole, 'an active administrator role must exist');

    userId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Neon administrator profile integration', email, await bcrypt.hash('CurrentPass123!', 12)],
    )).rows[0].id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, adminRole.id],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [hashToken(token), userId],
    );

    const app = createApp({
      database: database.runtimeAdapter,
      databaseDialect: 'postgres',
      emailChangeEmailConfigured: () => true,
      emailChangeEmailSender: async () => {},
      emailChangeNoticeSender: async () => {},
      emailChangeOtpGenerator: () => otp,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
    const request = (path, options = {}, sessionToken = token) => fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Cookie: `admin_session=${sessionToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    });

    const loaded = await request('/profile');
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).data.email, email);

    const patched = await request('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ full_name: 'Updated Neon Administrator', phone: '555-0199' }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).user.phone, '555-0199');

    const changedPassword = await request('/profile/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'CurrentPass123!', newPassword: 'NewPass12345!' }),
    });
    assert.equal(changedPassword.status, 200);
    const nextToken = decodeURIComponent(
      changedPassword.headers.get('set-cookie').match(/admin_session=([^;]+)/)[1],
    );
    assert.equal((await request('/profile', {}, token)).status, 401);
    assert.equal((await request('/profile', {}, nextToken)).status, 200);

    const emailChange = await request('/profile/email-change', {
      method: 'POST',
      body: JSON.stringify({ email: nextEmail, currentPassword: 'NewPass12345!' }),
    }, nextToken);
    assert.equal(emailChange.status, 202);
    assert.doesNotMatch(JSON.stringify(await emailChange.json()), new RegExp(otp));

    const verified = await request('/profile/email-change/verify', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    }, nextToken);
    assert.equal(verified.status, 200);
    assert.deepEqual((await verified.json()).data, { email: nextEmail });
    assert.equal((await request('/profile', {}, nextToken)).status, 200);

    const actions = (await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE actor_id = $1 AND action IN (
         'admin.profile_updated', 'admin.password_changed',
         'admin.profile_email_change_requested', 'admin.profile_email_changed'
       )
       ORDER BY id`,
      [userId],
    )).rows.map(({ action }) => action);
    assert.deepEqual(actions, [
      'admin.profile_updated',
      'admin.password_changed',
      'admin.profile_email_change_requested',
      'admin.profile_email_changed',
    ]);
  } finally {
    try {
      if (server?.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
    } finally {
      if (userId) {
        await database.runtimeAdapter.query(
          'DELETE FROM admin_email_change_otp_challenges WHERE user_id = $1',
          [userId],
        );
        await database.runtimeAdapter.query('DELETE FROM admin_sessions WHERE user_id = $1', [userId]);
        await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        await database.runtimeAdapter.query('DELETE FROM audit_logs WHERE actor_id = $1', [userId]);
        await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await database.close();
    }
  }
});
