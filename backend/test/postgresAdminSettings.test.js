import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPostgresAdminSettingsRouter } from '../src/routes/postgresAdminSettings.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../src/lib/systemSettings.js';

function createDatabase({ failAudit = false } = {}) {
  const settings = new Map([
    ['platform_name', { setting_value: 'Test EventHub', updated_at: null }],
    ['platform_description', { setting_value: 'Initial description', updated_at: null }],
    ['maintenance_mode', { setting_value: 'false', updated_at: null }],
    ['public_registration_enabled', { setting_value: 'true', updated_at: null }],
  ]);
  const auditRows = [];

  function makeExecutor(settingRows, audits) {
    return {
      async query(sql, values = []) {
        if (sql.includes('FROM system_settings')) {
          return {
            rows: values
              .filter((key) => settingRows.has(key))
              .map((key) => ({ setting_key: key, ...settingRows.get(key) })),
          };
        }
        if (sql.includes('FROM services')) {
          return { rows: [{ currency: 'ETB' }, { currency: 'usd' }, { currency: 'bad-value' }] };
        }
        if (sql.startsWith('INSERT INTO system_settings')) {
          const [key, value] = values;
          settingRows.set(key, { setting_value: value, updated_at: new Date() });
          return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO audit_logs')) {
          if (failAudit) throw new Error('test audit persistence failure');
          audits.push({ values });
          return { rows: [] };
        }
        throw new Error(`Unexpected PostgreSQL query: ${sql}`);
      },
    };
  }

  const database = {
    dialect: 'postgres',
    ...makeExecutor(settings, auditRows),
    async inTransaction(work) {
      const transactionalSettings = new Map(settings);
      const transactionalAudits = [...auditRows];
      const result = await work(makeExecutor(transactionalSettings, transactionalAudits));
      settings.clear();
      for (const [key, value] of transactionalSettings) settings.set(key, value);
      auditRows.splice(0, auditRows.length, ...transactionalAudits);
      return result;
    },
  };
  return { database, settings, auditRows };
}

async function createServer(database, { permissions = ['system.settings.manage'] } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { id: 41 };
    req.user = { permissions };
    next();
  });
  app.use('/api/admin', createPostgresAdminSettingsRouter({ database }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { app, server, baseUrl: `http://127.0.0.1:${server.address().port}/api/admin` };
}

test('PostgreSQL admin settings read defaults and configuration with filtered currencies', async (context) => {
  const { database } = createDatabase();
  const { server, baseUrl } = await createServer(database);
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${baseUrl}/settings`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.platform_name, 'Test EventHub');
  assert.equal(body.settings.support_email, DEFAULT_SYSTEM_SETTINGS.support_email);
  assert.deepEqual(body.configuration.payments.supportedCurrencies, ['ETB', 'USD']);
  assert.equal(body.configuration.payments.state, 'pending_integration');
  assert.ok(body.data.every((row) => Object.hasOwn(row, 'updated_at')));
});

test('PostgreSQL admin settings validate permissions and consequential confirmations', async (context) => {
  const { database } = createDatabase();
  const serverWithPermission = await createServer(database);
  const serverWithoutPermission = await createServer(database, { permissions: [] });
  context.after(async () => {
    await Promise.all([serverWithPermission.server, serverWithoutPermission.server].map(
      (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    ));
  });

  const denied = await fetch(`${serverWithoutPermission.baseUrl}/settings`);
  assert.equal(denied.status, 403);
  const invalid = await fetch(`${serverWithPermission.baseUrl}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unknown_setting: true }),
  });
  assert.equal(invalid.status, 400);
  const unconfirmed = await fetch(`${serverWithPermission.baseUrl}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maintenance_mode: true }),
  });
  assert.equal(unconfirmed.status, 409);
  assert.deepEqual((await unconfirmed.json()).keys, ['maintenance_mode']);
});

test('PostgreSQL admin settings persist transactionally and reset only with explicit confirmation', async (context) => {
  const { database, settings, auditRows } = createDatabase();
  const { app, server, baseUrl } = await createServer(database);
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const patch = await fetch(`${baseUrl}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_description: 'Updated description' }),
  });
  assert.equal(patch.status, 200);
  assert.equal((await patch.json()).data.platform_description, 'Updated description');
  assert.equal(settings.get('platform_description').setting_value, 'Updated description');
  assert.equal(auditRows.at(-1).values[1], 'settings.updated');
  assert.equal(app.locals.systemSettings.platform_description, 'Updated description');

  const unconfirmedReset = await fetch(`${baseUrl}/settings/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: false }),
  });
  assert.equal(unconfirmedReset.status, 400);
  const reset = await fetch(`${baseUrl}/settings/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(reset.status, 200);
  assert.equal(settings.get('platform_description').setting_value, DEFAULT_SYSTEM_SETTINGS.platform_description);
  assert.equal(auditRows.at(-1).values[1], 'settings.reset');
});

test('PostgreSQL admin settings roll back writes when audit persistence fails', async (context) => {
  const { database, settings, auditRows } = createDatabase({ failAudit: true });
  const { app, server, baseUrl } = await createServer(database);
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const response = await fetch(`${baseUrl}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_description: 'Must roll back' }),
  });
  assert.equal(response.status, 500);
  assert.equal(settings.get('platform_description').setting_value, 'Initial description');
  assert.equal(auditRows.length, 0);
  assert.equal(app.locals.systemSettings, undefined);
});

test('PostgreSQL admin single-setting updates parse booleans and require confirmation for consequential values', async (context) => {
  const { database, settings } = createDatabase();
  const { server, baseUrl } = await createServer(database);
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const unconfirmed = await fetch(`${baseUrl}/settings/public_registration_enabled`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'false' }),
  });
  assert.equal(unconfirmed.status, 409);
  const saved = await fetch(`${baseUrl}/settings/public_registration_enabled`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'false', confirmConsequential: true }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).data.setting_value, false);
  assert.equal(settings.get('public_registration_enabled').setting_value, 'false');
});
