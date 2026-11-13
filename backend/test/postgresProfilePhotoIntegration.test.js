import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL profile photo routes persist, return, and remove image bytes', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 60000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const token = randomUUID() + randomUUID();
  const adminToken = randomUUID() + randomUUID();
  const email = `pg-profile-photo-${suffix}@example.invalid`;
  const adminEmail = `pg-profile-photo-admin-${suffix}@example.invalid`;
  let userId;
  let adminUserId;
  let server;

  try {
    const role = (await database.runtimeAdapter.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'customer' AND is_active = TRUE LIMIT 1`,
    )).rows[0];
    assert.ok(role, 'seeded customer role must exist');
    const adminRole = (await database.runtimeAdapter.query(
      'SELECT id FROM roles WHERE is_admin = TRUE AND is_active = TRUE LIMIT 1',
    )).rows[0];
    assert.ok(adminRole, 'an active administrator role must exist');
    userId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon profile photo integration', email, 'integration-only-not-a-password'],
    )).rows[0].id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, role.id],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [hashToken(token), userId],
    );
    adminUserId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon admin profile photo integration', adminEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [adminUserId, adminRole.id],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [hashToken(adminToken), adminUserId],
    );

    server = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform/profile/photo`;
    const headers = { Cookie: `platform_session=${token}` };
    const adminUrl = `http://127.0.0.1:${server.address().port}/api/admin/profile/photo`;
    const adminHeaders = { Cookie: `admin_session=${adminToken}` };

    assert.equal((await fetch(baseUrl)).status, 401);
    assert.equal((await fetch(baseUrl, { headers })).status, 204);
    assert.equal((await fetch(adminUrl)).status, 401);
    assert.equal((await fetch(adminUrl, { headers })).status, 403);
    assert.equal((await fetch(adminUrl, { headers: adminHeaders })).status, 204);

    const photo = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
    const invalidUpload = await fetch(baseUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'image/png' },
      body: photo,
    });
    assert.equal(invalidUpload.status, 400);

    const upload = await fetch(baseUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
      body: photo,
    });
    assert.equal(upload.status, 200);
    const savedPhoto = await fetch(baseUrl, { headers });
    assert.equal(savedPhoto.status, 200);
    assert.match(savedPhoto.headers.get('cache-control'), /private/);
    assert.equal(savedPhoto.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await savedPhoto.arrayBuffer()), photo);

    assert.equal((await fetch(baseUrl, { method: 'DELETE', headers })).status, 204);
    assert.equal((await fetch(baseUrl, { headers })).status, 204);

    const adminUpload = await fetch(adminUrl, {
      method: 'PUT',
      headers: { ...adminHeaders, 'Content-Type': 'image/jpeg' },
      body: photo,
    });
    assert.equal(adminUpload.status, 200);
    const savedAdminPhoto = await fetch(adminUrl, { headers: adminHeaders });
    assert.equal(savedAdminPhoto.status, 200);
    assert.equal(savedAdminPhoto.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await savedAdminPhoto.arrayBuffer()), photo);
    assert.equal((await fetch(adminUrl, { method: 'DELETE', headers: adminHeaders })).status, 204);
    assert.equal((await fetch(adminUrl, { headers: adminHeaders })).status, 204);
    const auditRows = (await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE actor_id = $1 AND action IN ('admin.profile_photo_updated', 'admin.profile_photo_removed')
       ORDER BY action`,
      [adminUserId],
    )).rows;
    assert.deepEqual(auditRows.map(({ action }) => action), [
      'admin.profile_photo_removed',
      'admin.profile_photo_updated',
    ]);
    console.log('Neon profile photo integration passed: customer and admin authorization, persistence, audit, and deletion.');
  } finally {
    try {
      if (server?.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
    } finally {
      try {
        if (userId) {
          await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
          await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
          await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
        }
        if (adminUserId) {
          await database.runtimeAdapter.query('DELETE FROM admin_sessions WHERE user_id = $1', [adminUserId]);
          await database.runtimeAdapter.query('DELETE FROM audit_logs WHERE actor_id = $1', [adminUserId]);
          await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = $1', [adminUserId]);
          await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [adminUserId]);
        }
      } finally {
        await database.close();
      }
    }
  }
});
