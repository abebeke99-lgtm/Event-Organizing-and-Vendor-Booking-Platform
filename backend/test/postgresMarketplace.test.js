import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { createPostgresMarketplaceRouter } from '../src/routes/postgresMarketplace.js';

test('PostgreSQL marketplace routes use live query results and preserve listing response shapes', async () => {
  const queries = [];
  const database = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: [], rowCount: 0 };
    },
  };
  const app = express();
  app.use('/api/platform', createPostgresMarketplaceRouter({ database }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const root = `http://127.0.0.1:${server.address().port}/api/platform`;
    const vendors = await fetch(`${root}/vendors?search=florist&limit=3`);
    assert.deepEqual(await vendors.json(), {
      data: [],
      pagination: { total: 0, page: 1, limit: 3, totalPages: 1 },
    });
    const services = await fetch(`${root}/services?search=music&limit=4`);
    assert.deepEqual(await services.json(), {
      data: [],
      pagination: { total: 0, page: 1, limit: 4, totalPages: 1 },
    });
    const categories = await fetch(`${root}/categories?scope=services`);
    assert.deepEqual(await categories.json(), { categories: [], data: [] });
    assert.ok(queries.length >= 5);
    for (const { sql } of queries) assert.doesNotMatch(sql, /\?/);
    assert.ok(queries.some(({ sql }) => sql.includes('FROM vendor_profiles vp')));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

test('PostgreSQL marketplace rejects invalid filters without querying', async () => {
  const app = express();
  app.use('/api/platform', createPostgresMarketplaceRouter({
    database: { query: async () => { throw new Error('Invalid filters must not query.'); } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const root = `http://127.0.0.1:${server.address().port}/api/platform`;
    const vendor = await fetch(`${root}/vendors?maxPrice=10&minPrice=20`);
    const service = await fetch(`${root}/services?ids=1,1`);
    assert.equal(vendor.status, 400);
    assert.equal(service.status, 400);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});

test('public category API keeps integration fixture labels out of the service catalog', async () => {
  const app = express();
  app.use('/api/platform', createPostgresMarketplaceRouter({
    database: {
      async query() {
        return { rows: [
          { id: 1, name: 'Catering', display_order: 1, service_menu_order: 3, vendor_count: '2', service_count: '4' },
          { id: 2, name: 'Marketplace 131bc968-d76f-42d9-af09-da0fbd35e325 Services', display_order: 2, service_menu_order: 1 },
          { id: 3, name: 'Customer payment detail 147b18fa-3014-4dc5-aefb-8e450700f6a4', display_order: 3 },
          { id: 4, name: 'Event Rentals', display_order: 4 },
        ] };
      },
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform/categories`);
    assert.equal(response.status, 200);
    const { categories } = await response.json();
    assert.deepEqual(categories.map(({ name }) => name), ['Catering', 'Event Rentals']);
    assert.equal(categories[0].vendorCount, 2);
    assert.equal(categories[0].serviceCount, 4);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
