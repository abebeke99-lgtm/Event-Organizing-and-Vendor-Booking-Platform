import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { test } from 'node:test';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresAdminSettingsRouter } from '../src/routes/postgresAdminSettings.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL administrator settings queries persist and restore isolated settings state', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const email = `pg-settings-${suffix}@example.invalid`;
  const settingValue = `Neon settings integration ${suffix}`;
  let actorId;
  let originalSettings;
  let server;

  const cleanup = async () => {
    if (server?.listening) await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await database.runtimeAdapter.inTransaction(async (transaction) => {
      if (actorId) {
        await transaction.query('DELETE FROM audit_logs WHERE actor_id = $1', [actorId]);
      }
      if (originalSettings) {
        await transaction.query('DELETE FROM system_settings');
        for (const row of originalSettings) {
          await transaction.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
             VALUES ($1, $2, $3, $4)`,
            [row.setting_key, row.setting_value, row.updated_by, row.updated_at],
          );
        }
      }
      if (actorId) await transaction.query('DELETE FROM users WHERE id = $1', [actorId]);
    });
  };

  try {
    originalSettings = (await database.runtimeAdapter.query(
      'SELECT setting_key, setting_value, updated_by, updated_at FROM system_settings',
    )).rows;
    actorId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Neon settings integration', email, 'integration-only-not-a-password'],
    )).rows[0].id;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.admin = { id: actorId };
      req.user = { permissions: ['system.settings.manage'] };
      next();
    });
    app.use('/api/admin', createPostgresAdminSettingsRouter({ database: database.runtimeAdapter }));
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
    const request = (path, options = {}) => {
      const headers = options.body
        ? { 'Content-Type': 'application/json', ...options.headers }
        : options.headers;
      return fetch(`${baseUrl}${path}`, {
        ...options,
        ...(headers ? { headers } : {}),
        signal: AbortSignal.timeout(20000),
      });
    };

    const read = await request('/settings');
    assert.equal(read.status, 200);
    const readBody = await read.json();
    assert.ok(Array.isArray(readBody.data));
    assert.deepEqual(readBody.configuration.payments.supportedCurrencies, [
      ...new Set(readBody.configuration.payments.supportedCurrencies),
    ]);

    const patch = await request('/settings', {
      method: 'PATCH',
      body: JSON.stringify({ platform_description: settingValue }),
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).data.platform_description, settingValue);

    const reset = await request('/settings/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(reset.status, 200);

    const singleUpdate = await request('/settings/platform_description', {
      method: 'PUT',
      body: JSON.stringify({ value: settingValue }),
    });
    assert.equal(singleUpdate.status, 200);
    assert.equal((await singleUpdate.json()).data.setting_value, settingValue);

    const persisted = await database.runtimeAdapter.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'platform_description'`,
    );
    assert.equal(persisted.rows[0]?.setting_value, settingValue);
    const auditRows = await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE actor_id = $1 AND entity_type IN ('system_settings', 'system_setting')
       ORDER BY id`,
      [actorId],
    );
    assert.deepEqual(auditRows.rows.map((row) => row.action), [
      'settings.updated',
      'settings.reset',
      'settings.updated',
    ]);
  } finally {
    try {
      await cleanup();
    } finally {
      await database.close();
    }
  }
});
