import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPostgresAdminRouter } from '../src/routes/postgresAdmin.js';

test('overview route validates ranges and uses centralized error handling on query failure', async (context) => {
  const app = express();
  app.locals.databaseDialect = 'postgres';
  app.use((req, res, next) => {
    req.admin = { id: 1, role: 'admin' };
    req.user = { role: 'admin', permissions: ['dashboard.view'] };
    req.permissions = ['dashboard.view'];
    next();
  });
  app.use('/api/admin', createPostgresAdminRouter({
    database: {
      async query() {
        throw new Error('database unavailable');
      },
    },
  }));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ message: 'The request could not be completed.' });
  });
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/admin/dashboard/overview`;

  const invalidRange = await fetch(`${baseUrl}?range=custom&from=2026-10-30`);
  assert.equal(invalidRange.status, 400);

  const failedQuery = await fetch(`${baseUrl}?range=today`);
  assert.equal(failedQuery.status, 500);
  assert.deepEqual(await failedQuery.json(), { message: 'The request could not be completed.' });
});

test('overview route supports 7, 30, and 90 day presets for authenticated administrators', async (context) => {
  const app = express();
  app.locals.databaseDialect = 'postgres';
  app.use((req, res, next) => {
    req.admin = { id: 1, role: 'admin' };
    req.user = { role: 'admin', permissions: ['dashboard.view'] };
    req.permissions = ['dashboard.view'];
    next();
  });
  app.use('/api/admin', createPostgresAdminRouter({
    database: {
      async query(sql) {
        if (sql.includes('AS administrators')) {
          return { rows: [{ total: 4, administrators: 1, customers: 1, organizers: 1, vendors: 1 }] };
        }
        if (sql.includes('FROM vendor_profiles') && sql.includes('AS pending')) {
          return { rows: [{ total: 2, verified: 1, pending: 1 }] };
        }
        if (sql.includes('FROM complaints')) return { rows: [{ total: 1, open: 1 }] };
        if (sql.includes('FROM reviews')) return { rows: [{ total: 1 }] };
        if (sql.includes('FROM refund_requests')) return { rows: [{ total: 0 }] };
        if (sql.includes('FROM payments') && sql.includes('GROUP BY currency')) {
          return { rows: [] };
        }
        if (sql.includes('FROM payments') && sql.includes('AS pending_authorized')) {
          return { rows: [{ total: 1, successful: 1, pending_authorized: 0 }] };
        }
        if (sql.includes('FROM events') && sql.includes('AS published')) {
          return { rows: [{ total: 1, published: 1, upcoming: 1 }] };
        }
        if (sql.includes('FROM bookings') && sql.includes('AS pending')) {
          return { rows: [{ total: 1, pending: 0, confirmed: 1, completed: 0, cancelled: 0 }] };
        }
        if (sql.includes('AS period') && sql.includes('FROM users')) return { rows: [] };
        if (sql.includes('AS period') && sql.includes('FROM bookings')) return { rows: [] };
        if (sql.includes('AS period') && sql.includes('FROM payments')) return { rows: [] };
        if (sql.includes('FROM (') && sql.includes('activity')) return { rows: [] };
        throw new Error(`Unexpected dashboard query: ${sql}`);
      },
    },
  }));
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/admin/dashboard/overview`;

  for (const range of ['7days', '30days', '90days']) {
    const response = await fetch(`${baseUrl}?range=${range}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.data);
    assert.ok(body.data.users);
  }
});
