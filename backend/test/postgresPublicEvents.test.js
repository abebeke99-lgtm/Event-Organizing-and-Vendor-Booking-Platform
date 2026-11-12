import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresPublicEventsRouter } from '../src/routes/postgresPublicEvents.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

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

test('Neon PostgreSQL public event listings query and map real event records', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 90000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const email = `pg-public-events-${suffix}@example.invalid`;
  let organizerId;
  let eventId;
  let server;

  try {
    organizerId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Neon public-event integration', email, 'integration-only-not-a-password'],
    )).rows[0].id;
    eventId = (await database.runtimeAdapter.query(
      `INSERT INTO events
         (organizer_id, title, event_type, city, venue, description, start_date, end_date,
          status, is_featured)
       VALUES ($1, $2, 'wedding', 'Neon test city', $3, 'Isolated public event fixture',
               NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 4 hours', 'active', TRUE)
       RETURNING id`,
      [organizerId, `Neon public event ${suffix}`, `Neon venue ${suffix}`],
    )).rows[0].id;

    const app = express();
    app.use('/api/platform', createPostgresPublicEventsRouter({ database: database.runtimeAdapter }));
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform`;

    const listing = await fetch(
      `${baseUrl}/events?search=${encodeURIComponent(suffix)}&category=wedding&sort=popular`,
      { signal: AbortSignal.timeout(20000) },
    );
    assert.equal(listing.status, 200);
    const listingBody = await listing.json();
    assert.equal(listingBody.pagination.total, 1);
    assert.equal(Number(listingBody.data[0].id), Number(eventId));

    const featured = await fetch(`${baseUrl}/events/featured`, { signal: AbortSignal.timeout(20000) });
    assert.equal(featured.status, 200);
    assert.ok((await featured.json()).data.some((event) => Number(event.id) === Number(eventId)));

    const categories = await fetch(`${baseUrl}/events/categories`, { signal: AbortSignal.timeout(20000) });
    assert.equal(categories.status, 200);
    assert.ok(Array.isArray((await categories.json()).data));

    const venues = await fetch(`${baseUrl}/events/popular-venues?limit=5`, {
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(venues.status, 200);
    assert.ok((await venues.json()).data.some((venue) => venue.name === `Neon venue ${suffix}`));
  } finally {
    try {
      if (server?.listening) await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      if (eventId) await database.runtimeAdapter.query('DELETE FROM events WHERE id = $1', [eventId]);
      if (organizerId) await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [organizerId]);
    } finally {
      await database.close();
    }
  }
});
