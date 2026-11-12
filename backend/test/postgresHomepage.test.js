import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';

test('PostgreSQL homepage serves the public About page payload', async () => {
  const database = {
    dialect: 'postgres',
    async query(sql) {
      if (sql.includes('FROM site_content')) {
        return { rows: [{
          page_title: 'About the platform',
          content: { hero_heading: 'A better way to plan' },
          language: 'en',
          updated_at: '2026-11-12T00:00:00.000Z',
        }] };
      }
      return { rows: [] };
    },
  };
  const app = createApp({ database, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/about`);
    assert.equal(response.status, 200);
    const payload = (await response.json()).data;
    assert.equal(payload.hero.heading, 'A better way to plan');
    assert.equal(payload.page_title, 'About the platform');
    assert.deepEqual(payload.statistics, {
      categoryCount: 0,
      vendorCount: 0,
      serviceCount: 0,
      completedBookingCount: 0,
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
