import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL admin audit-log filters, pagination, export, and authorization', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const roleName = `integration-audit-admin-${suffix}`;
  const email = `pg-audit-admin-${suffix}@example.invalid`;
  const token = randomBytes(32).toString('hex');
  const platformToken = randomBytes(32).toString('hex');
  let userId;
  let platformUserId;
  let roleId;
  let server;

  try {
    await database.inTransaction(async (client) => {
      const role = await client.query(
        'INSERT INTO roles (name, description, is_admin, is_active) VALUES ($1, $2, TRUE, TRUE) RETURNING id',
        [roleName, 'Temporary audit log integration role'],
      );
      roleId = role.rows[0].id;
      const user = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Audit Log Integration Admin', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [email],
      );
      userId = user.rows[0].id;
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, roleId]);
      await client.query(
        'INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
        [hashToken(token), userId],
      );
      const customerRole = await client.query(
        `SELECT id FROM roles
         WHERE LOWER(name) = 'customer' AND is_active = TRUE AND is_admin = FALSE
         LIMIT 1`,
      );
      assert.equal(customerRole.rowCount, 1, 'Expected an active customer role in the Neon test database.');
      const platformUser = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Audit Log Integration Customer', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [`pg-audit-customer-${suffix}@example.invalid`],
      );
      platformUserId = platformUser.rows[0].id;
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [platformUserId, customerRole.rows[0].id],
      );
      await client.query(
        'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
        [hashToken(platformToken), platformUserId],
      );
      await client.query(
        `INSERT INTO audit_logs
          (actor_id, action, entity_type, entity_id, details, ip_address, request_id, outcome, severity)
         VALUES ($1, $2, 'integration_test', $3, $4::jsonb, '127.0.0.1', $5, 'success', 'warning')`,
        [
          userId,
          `integration.audit.${suffix}`,
          suffix,
          JSON.stringify({ status: 'created', password: 'must-not-be-returned' }),
          suffix,
        ],
      );
    });

    const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/audit-logs`;
    const request = (path, sessionToken = token) => {
      const cookieName = sessionToken === token ? 'admin_session' : 'platform_session';
      return fetch(`${baseUrl}${path}`, {
        headers: { Cookie: `${cookieName}=${sessionToken}` },
      });
    };

    const optionsResponse = await request('/options');
    assert.equal(optionsResponse.status, 200);
    const options = (await optionsResponse.json()).data;
    assert.ok(options.actions.includes(`integration.audit.${suffix}`));
    assert.ok(options.modules.includes('integration'));
    assert.equal(options.canExport, true);

    const query = new URLSearchParams({
      q: suffix,
      actor: String(userId),
      action: `integration.audit.${suffix}`,
      module: 'integration',
      entityType: 'integration_test',
      entityId: suffix,
      requestId: suffix,
      severity: 'warning',
      outcome: 'success',
      page: '1',
      pageSize: '1',
      sortBy: 'created_at',
      sortDirection: 'desc',
    });
    const listResponse = await request(`/?${query}`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.pagination.total, 1);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].actor_name, 'Audit Log Integration Admin');
    assert.equal(listed.data[0].module, 'integration');
    assert.deepEqual(listed.data[0].details, { status: 'created' });

    const invalidDate = await request('/?dateFrom=2026-02-30');
    assert.equal(invalidDate.status, 400);
    const invalidRange = await request('/?dateFrom=2026-11-09&dateTo=2026-11-08');
    assert.equal(invalidRange.status, 400);

    const exportResponse = await request(`/export?${new URLSearchParams({ action: `integration.audit.${suffix}` })}`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
    const csv = await exportResponse.text();
    assert.match(csv, /integration.audit/);
    assert.doesNotMatch(csv, /must-not-be-returned/);
    assert.match(exportResponse.headers.get('content-disposition'), /audit-logs\.csv/);

    const forbidden = await request('/options', platformToken);
    assert.equal(forbidden.status, 403);
  } finally {
    if (server?.listening) {
      server.close();
      await once(server, 'close');
    }
    if (userId) {
      await database.inTransaction(async (client) => {
        await client.query('DELETE FROM audit_logs WHERE actor_id = $1', [userId]);
        await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        if (platformUserId) {
          await client.query('DELETE FROM user_sessions WHERE user_id = $1', [platformUserId]);
          await client.query('DELETE FROM user_roles WHERE user_id = $1', [platformUserId]);
          await client.query('DELETE FROM users WHERE id = $1', [platformUserId]);
        }
        if (roleId) await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
      });
    }
    await database.close();
  }
});
