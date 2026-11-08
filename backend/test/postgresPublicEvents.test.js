import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { createPostgresPublicEventsRouter } from '../src/routes/postgresPublicEvents.js';

test('PostgreSQL public event routes use positional parameters and map empty results', async () => {
  const queries = [];
  const database = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: sql.includes('COUNT(*)') ? [{ total: '0' }] : [], rowCount: 0 };
    },
  };
  const app = express();
  app.use('/api/platform', createPostgresPublicEventsRouter({ database }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform`;
    const listing = await fetch(`${baseUrl}/events?search=music&location=Addis&sort=popular`);
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), {
      data: [],
      pagination: { total: 0, page: 1, limit: 12, totalPages: 1 },
    });

    const featured = await fetch(`${baseUrl}/events/featured`);
    assert.deepEqual(await featured.json(), { data: [] });
    const categories = await fetch(`${baseUrl}/events/categories`);
    assert.deepEqual(await categories.json(), { data: [] });
    const venues = await fetch(`${baseUrl}/events/popular-venues?limit=5`);
    assert.deepEqual(await venues.json(), { data: [] });

    assert.ok(queries.length >= 5);
    for (const { sql } of queries) {
      assert.doesNotMatch(sql, /\?/);
    }
    assert.ok(queries.some(({ sql, values }) => sql.includes('ILIKE $1') && values.includes('%music%')));
    assert.ok(queries.some(({ sql }) => sql.includes("INTERVAL '15 minutes'")));
    assert.ok(queries.some(({ sql }) => sql.includes('ARRAY_POSITION')));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

test('PostgreSQL event listing rejects invalid date and price filters', async () => {
  const app = express();
  app.use('/api/platform', createPostgresPublicEventsRouter({
    database: { query: async () => { throw new Error('Invalid filters must not query the database.'); } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform/events`;
    const invalidDate = await fetch(`${baseUrl}?startDate=2026-02-31`);
    assert.equal(invalidDate.status, 400);
    const invalidPrice = await fetch(`${baseUrl}?minPrice=200&maxPrice=100`);
    assert.equal(invalidPrice.status, 400);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
