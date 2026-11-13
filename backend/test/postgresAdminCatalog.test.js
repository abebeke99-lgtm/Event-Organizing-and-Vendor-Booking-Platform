import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { after, before, test } from 'node:test';
import { createPostgresAdminCatalogRouter } from '../src/routes/postgresAdminCatalog.js';

const privateDocument = Buffer.from('%PDF-1.7 private verification content');
const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const queries = [];

const database = {
  async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.includes('COUNT(*) AS total FROM vendor_profiles')) return { rows: [{ total: '1' }] };
    if (sql.includes('SELECT vp.id, vp.user_id, vp.business_name')) {
      return { rows: [{
        id: 21,
        user_id: 31,
        business_name: 'Test Catering',
        category_id: 4,
        category_name: 'Catering',
        city: 'Addis Ababa',
        description: 'Test description',
        verification_status: 'pending',
        is_featured: false,
        verification_reason: null,
        verified_at: null,
        created_at: '2026-01-01T00:00:00Z',
        owner_name: 'Vendor Test',
        email: 'vendor@example.test',
        phone: null,
        document_count: 1,
      }] };
    }
    if (sql.includes('SELECT verification_status, COUNT(*)')) {
      return { rows: [{ verification_status: 'pending', total: 1 }] };
    }
    if (sql.includes('SELECT id, original_name, content_type, file_size, created_at')) {
      return { rows: [{ id: 51, original_name: 'license.pdf', content_type: 'application/pdf', file_size: privateDocument.length, created_at: '2026-01-01T00:00:00Z' }] };
    }
    if (sql.includes('FROM vendor_verification_history h')) {
      return { rows: [{ id: 61, from_status: null, to_status: 'pending', reason: 'Submitted', created_at: '2026-01-01T00:00:00Z', actor_name: null }] };
    }
    if (sql.includes('SELECT original_name, content_type, content')) {
      return { rows: [{ original_name: 'license.pdf', content_type: 'application/pdf', content: privateDocument }] };
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM service_categories')) return { rows: [{ total: '1' }] };
    if (sql.includes('SELECT sc.id, sc.name, sc.description')) {
      return { rows: [{
        id: 4,
        name: 'Catering',
        description: null,
        display_order: 2,
        image_mime: 'image/png',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        service_count: 3,
      }] };
    }
    if (sql.includes('SELECT image, image_mime FROM service_categories')) {
      return { rows: [{ image: imageContent, image_mime: 'image/png' }] };
    }
    throw new Error(`Unexpected PostgreSQL test query: ${sql}`);
  },
  async inTransaction(work) {
    return work(this);
  },
};

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const permissions = req.get('x-test-permissions');
  req.admin = { id: 91 };
  req.user = { permissions: permissions === 'none'
    ? []
    : ['vendors.verify', 'categories.view', 'categories.create', 'categories.edit'] };
  next();
});
app.use('/api/admin', createPostgresAdminCatalogRouter({ database }));
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

function request(path, { method = 'GET', body, permissions } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(permissions ? { 'X-Test-Permissions': permissions } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('vendor verification listing preserves the frontend response shape and parameterizes filters', async () => {
  queries.length = 0;
  const response = await request('/vendor-verification?page=2&pageSize=5&status=pending&q=vendor%27%20OR%201%3D1');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].business_name, 'Test Catering');
  assert.equal(result.data[0].document_count, 1);
  assert.deepEqual(result.pagination, { page: 2, pageSize: 5, total: 1, totalPages: 1 });
  assert.equal(result.counts.pending, 1);
  const filteredQuery = queries.find(({ sql }) => sql.includes('SELECT vp.id, vp.user_id, vp.business_name'));
  assert.ok(filteredQuery.sql.includes('vp.business_name ILIKE $2'));
  assert.deepEqual(filteredQuery.values, ['pending', "%vendor' OR 1=1%", "vendor' OR 1=1", 5, 5]);
});

test('verification details expose document metadata only, while document bytes require permission', async () => {
  const detailResponse = await request('/vendor-verification/21');
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).data;
  assert.equal(detail.documents[0].original_name, 'license.pdf');
  assert.equal(Object.hasOwn(detail.documents[0], 'content'), false);

  const denied = await request('/vendor-verification/21/documents/51', { permissions: 'none' });
  assert.equal(denied.status, 403);

  const download = await request('/vendor-verification/21/documents/51');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(download.headers.get('content-disposition'), /attachment; filename="license\.pdf"/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), privateDocument);
});

test('category listing supports the admin UI fields and rejects unapproved sort columns', async () => {
  queries.length = 0;
  const response = await request('/categories?page=3&pageSize=10&q=Cater&status=active&sortBy=service_count&sortDirection=desc');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].display_order, 2);
  assert.equal(result.data[0].service_count, 3);
  assert.equal(result.data[0].image, '/api/admin/categories/4/image');
  assert.deepEqual(result.pagination, { page: 3, pageSize: 10, total: 1 });
  const listQuery = queries.find(({ sql }) => sql.includes('SELECT sc.id, sc.name, sc.description'));
  assert.match(listQuery.sql, /ORDER BY service_count DESC/);
  assert.deepEqual(listQuery.values, ['%Cater%', true, 10, 20]);

  const invalidSort = await request('/categories?sortBy=name;DROP%20TABLE%20service_categories');
  assert.equal(invalidSort.status, 400);
});

test('category images are permission-checked and returned without exposing database rows', async () => {
  const denied = await request('/categories/4/image', { permissions: 'none' });
  assert.equal(denied.status, 403);

  const response = await request('/categories/4/image');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageContent);
});

test('vendor and category mutations validate inputs before database writes', async () => {
  queries.length = 0;
  const invalidTransition = await request('/vendor-verification/21/status', {
    method: 'PATCH',
    body: { status: 'pending', reason: 'too short' },
  });
  assert.equal(invalidTransition.status, 400);

  const invalidCategory = await request('/categories', {
    method: 'POST',
    body: { name: 'x', display_order: -1 },
  });
  assert.equal(invalidCategory.status, 400);
  assert.equal(queries.length, 0);
});
