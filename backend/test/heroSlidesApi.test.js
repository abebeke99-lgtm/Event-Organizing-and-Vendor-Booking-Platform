import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { validateHeroSlideImage } from '../src/lib/heroSlides.js';

const adminToken = 'hero-slides-admin-session';
const customerToken = 'hero-slides-customer-session';
const records = [];
let nextId = 1;
let uploadDirectory;

async function execute(sql, values = []) {
  if (sql.includes('FROM admin_sessions s')) {
    return [values[0] === hashToken(adminToken) ? [{
      id: 1, full_name: 'Hero Admin', email: 'hero-admin@example.test',
      phone: null, status: 'active', roles: 'Admin',
    }] : []];
  }
  if (sql.includes('FROM user_sessions s')) {
    return [values[0] === hashToken(customerToken) ? [{
      id: 2, full_name: 'Customer', email: 'customer@example.test',
      phone: null, preferred_language: 'en', status: 'active', role: 'customer', permission_keys: '',
    }] : []];
  }
  if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
  if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
  if (sql.startsWith('SELECT COUNT(*) AS total FROM hero_slides')) return [[{ total: records.length }]];
  if (sql.startsWith('SELECT id, image_path, image_mime, alt_text')) {
    const rows = [...records].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    if (sql.includes('WHERE id = ?')) return [rows.filter((row) => row.id === Number(values[0]))];
    return [rows];
  }
  if (sql.startsWith('SELECT id, alt_text, link_url, sort_order FROM hero_slides')) {
    return [[...records].filter((row) => row.is_active).sort((a, b) => a.sort_order - b.sort_order).map(({ id, alt_text, link_url, sort_order }) => ({ id, alt_text, link_url, sort_order }))];
  }
  if (sql.startsWith('SELECT image_path, image_mime FROM hero_slides')) {
    const row = records.find((item) => item.id === Number(values[0]) && (!sql.includes('is_active = TRUE') || item.is_active));
    return [row ? [{ image_path: row.image_path, image_mime: row.image_mime }] : []];
  }
  if (sql.startsWith('INSERT INTO hero_slides')) {
    const row = {
      id: nextId++, image_path: values[0], image_mime: values[1], alt_text: values[2],
      link_url: values[3], sort_order: Number(values[4]), is_active: Boolean(values[5]),
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    records.push(row);
    return [{ insertId: row.id, affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE hero_slides SET image_path')) {
    const row = records.find((item) => item.id === Number(values[5]));
    if (row) Object.assign(row, {
      image_path: values[0], image_mime: values[1], alt_text: values[2],
      link_url: values[3], is_active: Boolean(values[4]),
    });
    return [{ affectedRows: row ? 1 : 0 }];
  }
  if (sql.startsWith('UPDATE hero_slides SET sort_order')) {
    const row = records.find((item) => item.id === Number(values[1]));
    if (row) row.sort_order = Number(values[0]);
    return [{ affectedRows: row ? 1 : 0 }];
  }
  if (sql.startsWith('DELETE FROM hero_slides')) {
    const index = records.findIndex((row) => row.id === Number(values[0]));
    if (index >= 0) records.splice(index, 1);
    return [{ affectedRows: index >= 0 ? 1 : 0 }];
  }
  return [{ affectedRows: 1 }];
}

const database = {
  execute,
  async query() { return [[], []]; },
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
const app = createApp({ database });
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'eventhub-hero-slides-'));
  app.locals.heroSlidesDirectory = uploadDirectory;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await rm(uploadDirectory, { recursive: true, force: true });
});

function request(pathname, options = {}, token = adminToken) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Cookie', `${token === adminToken ? 'admin_session' : 'platform_session'}=${token}`);
  return fetch(`${baseUrl}${pathname}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
}

function imageForm({ altText = 'Sunset wedding arch', linkUrl = '/events', fileName = 'wedding.png', mimeType = 'image/png' } = {}) {
  const form = new FormData();
  form.append('altText', altText);
  form.append('linkUrl', linkUrl);
  form.append('isActive', 'true');
  form.append('image', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], { type: mimeType }), fileName);
  return form;
}

test('hero slide administration distinguishes guests from authenticated non-admin users', async () => {
  assert.equal((await request('/api/admin/hero-slides', {}, null)).status, 401);
  assert.equal((await request('/api/admin/hero-slides', {}, customerToken)).status, 403);
  assert.equal((await request('/api/admin/hero-slides', {
    method: 'POST',
    body: imageForm(),
  }, customerToken)).status, 403);
  assert.equal((await request('/api/admin/hero-slides')).status, 200);
});

test('hero slides validate and upload files, expose only public URLs, and enforce the five-slide limit', async () => {
  records.length = 0;
  nextId = 1;
  const mismatch = await request('/api/admin/hero-slides', { method: 'POST', body: imageForm({ fileName: 'wrong.jpg' }) });
  assert.equal(mismatch.status, 400);
  const invalidAlt = await request('/api/admin/hero-slides', { method: 'POST', body: imageForm({ altText: 'x'.repeat(151) }) });
  assert.equal(invalidAlt.status, 400);
  const invalidLink = await request('/api/admin/hero-slides', { method: 'POST', body: imageForm({ linkUrl: 'javascript:alert(1)' }) });
  assert.equal(invalidLink.status, 400);
  const oversized = validateHeroSlideImage({
    originalname: 'oversized.png',
    mimetype: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  assert.match(oversized.error, /5 MB or smaller/);

  for (let index = 0; index < 5; index += 1) {
    const response = await request('/api/admin/hero-slides', {
      method: 'POST',
      body: imageForm({ altText: `Wedding slide ${index + 1}` }),
    });
    assert.equal(response.status, 201);
  }
  const tooMany = await request('/api/admin/hero-slides', { method: 'POST', body: imageForm() });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).message, /maximum of 5/);

  const publicResponse = await request('/api/hero-slides', {}, null);
  assert.equal(publicResponse.status, 200);
  const publicData = await publicResponse.json();
  assert.equal(publicData.data.length, 5);
  assert.equal(publicData.data[0].sortOrder, 1);
  assert.equal(publicData.data[0].imageUrl, '/api/hero-slides/1/image');
  assert.equal(JSON.stringify(publicData).includes(uploadDirectory), false);
  assert.equal(JSON.stringify(publicData).includes('image_path'), false);

  const imageResponse = await request(publicData.data[0].imageUrl, {}, null);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.equal((await imageResponse.arrayBuffer()).byteLength, 9);
  assert.equal((await readdir(uploadDirectory)).length, 5);
});

test('hero slide reorder is complete and ordered, inactive slides are private to the admin list, and delete removes the file', async () => {
  const ids = records.map((row) => row.id);
  const invalidReorder = await request('/api/admin/hero-slides/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.slice(1) }),
  });
  assert.equal(invalidReorder.status, 400);

  const reorder = await request('/api/admin/hero-slides/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [...ids].reverse() }),
  });
  assert.equal(reorder.status, 200);
  const reordered = await reorder.json();
  assert.deepEqual(reordered.data.map((slide) => slide.id), [...ids].reverse());
  assert.equal(reordered.data[0].sortOrder, 1);

  const inactive = records[0];
  const updateForm = new FormData();
  updateForm.append('altText', inactive.alt_text);
  updateForm.append('linkUrl', '');
  updateForm.append('isActive', 'false');
  const update = await request(`/api/admin/hero-slides/${inactive.id}`, { method: 'PUT', body: updateForm });
  assert.equal(update.status, 200);
  const publicSlides = await (await request('/api/hero-slides', {}, null)).json();
  assert.equal(publicSlides.data.some((slide) => slide.id === inactive.id), false);

  const imageName = inactive.image_path;
  const deleted = await request(`/api/admin/hero-slides/${inactive.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  assert.equal((await readdir(uploadDirectory)).includes(imageName), false);
  assert.equal(records.length, 4);
});
