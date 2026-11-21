import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { after, before, test } from 'node:test';
import { createPostgresProfilePhotoRouter } from '../src/routes/postgresProfilePhoto.js';

const statements = [];
const database = {
  async query(sql, values = []) {
    statements.push({ sql, values });
    return { rows: [] };
  },
};

const app = express();
app.use((req, _res, next) => {
  req.admin = { id: 17 };
  next();
});
app.use('/api/admin/profile/photo', createPostgresProfilePhotoRouter({
  database,
  administrator: true,
}));
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/profile/photo`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test('PostgreSQL admin photo endpoint returns no content when no photo is stored', async () => {
  statements.length = 0;
  const response = await fetch(baseUrl);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(statements, [{
    sql: 'SELECT profile_photo, profile_photo_mime FROM users WHERE id = $1',
    values: [17],
  }]);
});
