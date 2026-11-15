import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('PostgreSQL admin authorization never retries with legacy MySQL placeholders', async () => {
  const queries = [];
  const executions = [];
  const database = {
    dialect: 'postgres',
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
    async execute(sql, values = []) {
      executions.push({ sql, values });
      return [[], []];
    },
  };
  const app = createApp({ database, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/settings`, {
      headers: { Cookie: 'platform_session=expired-or-unknown-token' },
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required.' });
    assert.equal(executions.length, 0);
    assert.ok(queries.length > 0);
    assert.ok(queries.every(({ sql }) => !sql.includes('?')));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
