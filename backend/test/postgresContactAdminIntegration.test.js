import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon admin contact workflows enforce authorization and persist PostgreSQL state', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const token = `${randomUUID()}${randomUUID()}`;
  const email = `pg-contact-admin-${suffix}@example.invalid`;
  const reference = `EH-${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
  const subject = `Support ${suffix}`;
  let userId;
  let messageId;
  let server;

  try {
    const adminRole = (await database.runtimeAdapter.query(
      'SELECT id FROM roles WHERE is_admin = TRUE AND is_active = TRUE LIMIT 1',
    )).rows[0];
    assert.ok(adminRole, 'an active administrator role must exist');

    userId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      ['Neon contact administrator integration', email, 'integration-only'],
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
    messageId = (await database.runtimeAdapter.query(
      `INSERT INTO contact_messages
       (reference_id, full_name, email, subject, inquiry_type, message, status)
       VALUES ($1, $2, $3, $4, 'general_inquiry', $5, 'new')
       RETURNING id`,
      [
        reference,
        'Neon Contact Administrator',
        `contact-${suffix}@example.invalid`,
        subject,
        'Please help with this isolated Neon contact admin test.',
      ],
    )).rows[0].id;

    const app = createApp({
      database: database.runtimeAdapter,
      databaseDialect: 'postgres',
      notificationEmailConfigured: () => false,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/contact`;
    const headers = { Cookie: `admin_session=${token}` };
    const request = (path, options = {}) => fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    });

    assert.equal((await fetch(baseUrl)).status, 401);
    const listed = await request(`?q=${encodeURIComponent(subject)}&status=new`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).data[0].reference_id, reference);

    const markedRead = await request(`/${messageId}/read`, {
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
    });
    assert.equal(markedRead.status, 200);
    const readState = await database.runtimeAdapter.query(
      'SELECT read_at FROM contact_messages WHERE id = $1',
      [messageId],
    );
    assert.ok(readState.rows[0].read_at);

    const replied = await request(`/${messageId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'replied', admin_reply: 'We will help with your request.' }),
    });
    assert.equal(replied.status, 200);
    assert.equal((await replied.json()).data.email, 'not_configured');

    const archived = await request(`/${messageId}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(archived.status, 200);
    const archivedList = await request(`?q=${encodeURIComponent(subject)}&archived=archived`);
    assert.equal((await archivedList.json()).data[0].reference_id, reference);

    const deleted = await request(`/${messageId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    const persistedAudit = await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE actor_id = $1 AND entity_type = 'contact_message' AND entity_id = $2
       ORDER BY id`,
      [userId, String(messageId)],
    );
    assert.deepEqual(persistedAudit.rows.map(({ action }) => action), [
      'contact_message.archived',
      'contact_message.deleted',
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
      await database.runtimeAdapter.query('DELETE FROM contact_messages WHERE reference_id = $1', [reference]);
      if (userId) {
        await database.runtimeAdapter.query('DELETE FROM admin_sessions WHERE user_id = $1', [userId]);
        await database.runtimeAdapter.query(
          `DELETE FROM audit_logs
           WHERE actor_id = $1 AND entity_type = 'contact_message'`,
          [userId],
        );
        await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await database.close();
    }
  }
});
