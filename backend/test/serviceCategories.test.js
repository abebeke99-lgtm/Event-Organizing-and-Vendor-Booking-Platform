import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const adminToken = 'service-category-management-test';
const admin = {
  id: 1,
  full_name: 'Category Admin',
  email: 'category-admin@example.test',
  phone: null,
  status: 'active',
  roles: 'Admin',
};

function createDatabase() {
  const categories = [
    {
      id: 1,
      name: 'Catering',
      description: 'Food services',
      display_order: 2,
      image: null,
      image_mime: null,
      is_active: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  const services = [{ id: 71, category_id: 1 }];
  const audit = [];
  const statements = [];
  let nextId = 2;

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{ ...admin }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM service_categories sc')) {
      let rows = [...categories];
      if (sql.includes('sc.name LIKE')) rows = rows.filter((row) => `${row.name} ${row.description || ''}`.includes(values[0].slice(1, -1)));
      if (sql.includes('sc.is_active = ?')) rows = rows.filter((row) => Number(row.is_active) === Number(values[values.length - 1]));
      return [[{ total: rows.length }], []];
    }
    if (sql.includes('FROM service_categories sc') && sql.includes('LEFT JOIN services s')) {
      const filterValues = values.slice(0, -2);
      let rows = [...categories];
      if (sql.includes('sc.name LIKE')) rows = rows.filter((row) => `${row.name} ${row.description || ''}`.toLowerCase().includes(filterValues[0].slice(1, -1).toLowerCase()));
      if (sql.includes('sc.is_active = ?')) rows = rows.filter((row) => Number(row.is_active) === Number(filterValues[filterValues.length - 1]));
      const orderBy = sql.match(/ORDER BY ([\w.]+) (ASC|DESC)/i);
      const column = orderBy?.[1].replace('sc.', '');
      const direction = orderBy?.[2] === 'DESC' ? -1 : 1;
      rows.sort((a, b) => {
        const left = column === 'service_count' ? services.filter((service) => service.category_id === a.id).length : a[column];
        const right = column === 'service_count' ? services.filter((service) => service.category_id === b.id).length : b[column];
        return (typeof left === 'string' ? left.localeCompare(right) : Number(left) - Number(right)) * direction;
      });
      const offset = Number(values.at(-1));
      const limit = Number(values.at(-2));
      return [rows.slice(offset, offset + limit).map((row) => ({
        ...row,
        service_count: services.filter((service) => service.category_id === row.id).length,
      })), []];
    }
    if (sql.startsWith('SELECT id, name, is_active FROM service_categories WHERE id = ? FOR UPDATE')) {
      const row = categories.find((category) => category.id === Number(values[0]));
      return [row ? [{ id: row.id, name: row.name, is_active: row.is_active }] : [], []];
    }
    if (sql.startsWith('SELECT id, name, image_mime FROM service_categories WHERE id = ? FOR UPDATE')) {
      const row = categories.find((category) => category.id === Number(values[0]));
      return [row ? [{ id: row.id, name: row.name, image_mime: row.image_mime }] : [], []];
    }
    if (sql.startsWith('SELECT id, name, description, display_order FROM service_categories WHERE id = ? FOR UPDATE')) {
      const row = categories.find((category) => category.id === Number(values[0]));
      return [row ? [{ id: row.id, name: row.name, description: row.description, display_order: row.display_order }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS service_count FROM services WHERE category_id = ?')) {
      return [[{ service_count: services.filter((service) => service.category_id === Number(values[0])).length }], []];
    }
    if (sql.startsWith('INSERT INTO service_categories')) {
      const [name, description, displayOrder] = values;
      if (categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
        throw Object.assign(new Error('Duplicate category'), { code: 'ER_DUP_ENTRY' });
      }
      const id = nextId++;
      categories.push({
        id,
        name,
        description,
        display_order: displayOrder,
        image: null,
        image_mime: null,
        is_active: 1,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });
      return [{ insertId: id, affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE service_categories SET')) {
      const categoryId = Number(values.at(-1));
      const category = categories.find((row) => row.id === categoryId);
      if (!category) return [{ affectedRows: 0 }, []];
      if (sql.includes('image = NULL')) {
        category.image = null;
        category.image_mime = null;
        return [{ affectedRows: 1 }, []];
      }
      const fields = sql.match(/^UPDATE service_categories SET (.+) WHERE id = \?$/)?.[1]
        .split(', ')
        .map((field) => field.split(' = ')[0]) || [];
      const nameIndex = fields.indexOf('name');
      if (nameIndex >= 0 && categories.some((row) => row.id !== categoryId && row.name.toLowerCase() === String(values[nameIndex]).toLowerCase())) {
        throw Object.assign(new Error('Duplicate category'), { code: 'ER_DUP_ENTRY' });
      }
      fields.forEach((field, index) => { category[field] = values[index]; });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM audit_logs')) {
      const categoryId = String(values[0]);
      return [[{ total: audit.filter((entry) => entry.entity_id === categoryId).length }], []];
    }
    if (sql.includes('FROM audit_logs WHERE entity_id = ?')) {
      const categoryId = String(values[0]);
      const offset = Number(values.at(-1));
      const limit = Number(values.at(-2));
      return [audit.filter((entry) => entry.entity_id === categoryId).slice().reverse().slice(offset, offset + limit), []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      const [actor_id, action, entity_type, entity_id, details, ip_address] = values;
      audit.push({
        id: audit.length + 1,
        actor_id,
        action,
        entity_type,
        entity_id: String(entity_id),
        details: JSON.parse(details),
        ip_address,
        created_at: '2026-02-01T00:00:00.000Z',
      });
      return [{ insertId: audit.length, affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT image, image_mime FROM service_categories')) {
      const category = categories.find((row) => row.id === Number(values[0]));
      return [category?.image ? [{ image: category.image, image_mime: category.image_mime }] : [], []];
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  }

  async function query(sql) {
    statements.push({ sql, values: [] });
    if (sql.includes('FROM services s')) return [[], []];
    if (sql.includes('FROM vendor_profiles vp')) return [[], []];
    if (sql.includes('FROM service_categories')) {
      return [categories.filter((category) => category.is_active).map(({ id, name, description, display_order, image_mime, is_active }) => ({
        id, name, description, display_order, image_mime, is_active,
      })), []];
    }
    throw new Error(`Unexpected test query: ${sql}`);
  }

  return {
    categories,
    services,
    audit,
    statements,
    execute,
    query,
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
}

const database = createDatabase();
const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60000,
};
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

async function request(path, { method = 'GET', body, contentType = 'application/json', authenticated = true } = {}) {
  const headers = {};
  if (authenticated) headers.Cookie = `admin_session=${adminToken}`;
  if (body !== undefined) headers['Content-Type'] = contentType;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

test('category API searches, sorts, filters, paginates, and reports linked service counts', async () => {
  const { response, payload } = await request('/api/admin/categories?status=active&sortBy=service_count&sortDirection=desc&pageSize=1');
  assert.equal(response.status, 200);
  assert.equal(payload.data[0].name, 'Catering');
  assert.equal(payload.data[0].service_count, 1);
  assert.equal(payload.pagination.total, 1);

  const invalid = await request('/api/admin/categories?sortBy=unknown');
  assert.equal(invalid.response.status, 400);
});

test('category CRUD enforces unique names and records field changes in history', async () => {
  const duplicate = await request('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({ name: ' catering ', description: 'Duplicate', display_order: 1 }),
  });
  assert.equal(duplicate.response.status, 409);

  const created = await request('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Photography' }),
  });
  assert.equal(created.response.status, 201);
  const id = created.payload.data.id;
  assert.equal(database.categories.find((category) => category.id === id).display_order, 0);

  const duplicateUpdate = await request(`/api/admin/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'catering' }),
  });
  assert.equal(duplicateUpdate.response.status, 409);

  const updated = await request(`/api/admin/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Photography and Videography', description: 'Updated copy', display_order: 2 }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(database.categories.find((category) => category.id === id).display_order, 2);

  const history = await request(`/api/admin/categories/${id}/history`);
  assert.equal(history.response.status, 200);
  assert.equal(history.payload.data.length, 2);
  assert.deepEqual(history.payload.data[0].details.after, {
    name: 'Photography and Videography',
    description: 'Updated copy',
    display_order: 2,
  });
});

test('image upload validates MIME and file signature, persists bytes, and supports removal', async () => {
  const categoryId = 1;
  const unsupported = await request(`/api/admin/categories/${categoryId}/image`, {
    method: 'PUT',
    body: Buffer.from('<svg/>'),
    contentType: 'image/svg+xml',
  });
  assert.equal(unsupported.response.status, 400);

  const invalid = await request(`/api/admin/categories/${categoryId}/image`, {
    method: 'PUT',
    body: Buffer.from([0xff, 0xd8, 0xff]),
    contentType: 'image/png',
  });
  assert.equal(invalid.response.status, 400);

  const image = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const uploaded = await request(`/api/admin/categories/${categoryId}/image`, {
    method: 'PUT',
    body: image,
    contentType: 'image/jpeg',
  });
  assert.equal(uploaded.response.status, 200);
  assert.deepEqual(database.categories.find((category) => category.id === categoryId).image, image);

  const adminImage = await fetch(`${baseUrl}/api/admin/categories/${categoryId}/image`, {
    headers: { Cookie: `admin_session=${adminToken}` },
  });
  assert.equal(adminImage.status, 200);
  assert.equal(adminImage.headers.get('content-type'), 'image/jpeg');

  const publicCategories = await request('/api/platform/categories', { authenticated: false });
  assert.equal(publicCategories.response.status, 200);
  assert.equal(publicCategories.payload.data[0].image, `/api/platform/categories/${categoryId}/image`);

  const publicImage = await fetch(`${baseUrl}/api/platform/categories/${categoryId}/image`);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), image);

  const removed = await request(`/api/admin/categories/${categoryId}/image`, { method: 'DELETE' });
  assert.equal(removed.response.status, 204);
  assert.equal(database.categories.find((category) => category.id === categoryId).image, null);
});

test('deactivation preserves categories referenced by services and hard removal is rejected', async () => {
  const deactivated = await request('/api/admin/categories/1/status', {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(database.categories.find((category) => category.id === 1).is_active, false);
  assert.equal(database.services[0].category_id, 1);
  assert.equal(database.audit.some((entry) => entry.action === 'service_category.status_changed' && entry.details.service_count === 1), true);

  const removal = await request('/api/admin/categories/1', { method: 'DELETE' });
  assert.equal(removal.response.status, 405);
});
