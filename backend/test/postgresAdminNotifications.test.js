import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { after, before, test } from 'node:test';
import { createPostgresAdminNotificationsRouter } from '../src/routes/postgresAdminNotifications.js';

const statements = [];
const database = {
  async query(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('COUNT(*)::integer AS total FROM notifications')) return { rows: [{ total: '0' }] };
    if (sql.includes('COUNT(*)::integer AS unread FROM notifications')) return { rows: [{ unread: '0' }] };
    if (sql.includes('SELECT n.id, n.title, n.message, n.notification_type')) return { rows: [] };
    throw new Error(`Unexpected PostgreSQL test query: ${sql}`);
  },
};

const app = express();
app.use((req, _res, next) => {
  req.admin = { id: 8 };
  req.user = { role: 'admin', permissions: ['notifications.manage'] };
  req.permissions = ['notifications.manage'];
  next();
});
app.use('/api/admin', createPostgresAdminNotificationsRouter({ database }));
app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test('PostgreSQL admin notifications paginate, sort, filter, and return empty results', async () => {
  statements.length = 0;
  const response = await fetch(
    `${baseUrl}/notifications?page=2&pageSize=5&q=invoice&type=complaint&read=false&sortBy=created_at&sortDirection=desc`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: [],
    pagination: { page: 2, pageSize: 5, total: 0 },
    unreadCount: 0,
  });

  const count = statements.find(({ sql }) => sql.includes('COUNT(*)::integer AS total FROM notifications'));
  assert.deepEqual(count.values, [8, '%invoice%', '%invoice%', 'complaint']);
  const unread = statements.find(({ sql }) => sql.includes('COUNT(*)::integer AS unread FROM notifications'));
  assert.deepEqual(unread.values, [8]);
  const rows = statements.find(({ sql }) => sql.includes('SELECT n.id, n.title, n.message, n.notification_type'));
  assert.match(rows.sql, /ORDER BY n\.created_at DESC, n\.id DESC/);
  assert.deepEqual(rows.values, [8, '%invoice%', '%invoice%', 'complaint', 5, 5]);
});
