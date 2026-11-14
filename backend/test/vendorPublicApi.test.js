import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { isPublicCategoryName } from '../src/lib/categoryName.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';
const diagnosticsEnabled = process.env.NEON_MARKETPLACE_TRACE === 'true';

function installMarketplaceDiagnostics(pool) {
  if (!diagnosticsEnabled) return;

  const originalConnect = pool.connect.bind(pool);
  const instrumentedClients = new WeakSet();
  let connectionSequence = 0;
  let querySequence = 0;
  const poolState = () => `${pool.totalCount}/${pool.idleCount}/${pool.waitingCount}`;

  pool.connect = (...args) => {
    if (args.some((argument) => typeof argument === 'function')) {
      return originalConnect(...args);
    }

    const connectionId = ++connectionSequence;
    const stateBefore = poolState();
    const started = performance.now();
    return originalConnect(...args).then((client) => {
      console.info(
        `[marketplace-pool] acquire#${connectionId} waitMs=${(performance.now() - started).toFixed(1)} `
        + `pool(total/idle/waiting)=${stateBefore}->${poolState()}`,
      );
      if (!instrumentedClients.has(client)) {
        instrumentedClients.add(client);
        const originalQuery = client.query.bind(client);
        client.query = (...queryArgs) => {
          const queryId = ++querySequence;
          const sql = typeof queryArgs[0] === 'string' ? queryArgs[0] : '';
          const table = sql.match(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/i)?.[1] || 'statement';
          const queryStarted = performance.now();
          const result = originalQuery(...queryArgs);
          if (!result || typeof result.then !== 'function') return result;
          return result.then(
            (value) => {
              console.info(
                `[marketplace-db] query#${queryId} table=${table} `
                + `execMs=${(performance.now() - queryStarted).toFixed(1)}`,
              );
              return value;
            },
            (error) => {
              console.info(
                `[marketplace-db] query#${queryId} table=${table} `
                + `execMs=${(performance.now() - queryStarted).toFixed(1)} error=${error.code || error.name || 'Error'}`,
              );
              throw error;
            },
          );
        };
      }
      return client;
    }, (error) => {
      console.info(
        `[marketplace-pool] acquire#${connectionId} waitMs=${(performance.now() - started).toFixed(1)} `
        + `pool(total/idle/waiting)=${stateBefore}->${poolState()} error=${error.code || error.name || 'Error'}`,
      );
      throw error;
    });
  };
}

test('PostgreSQL public marketplace preserves vendor, category, and service workflows', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async (context) => {
  const environment = await loadNeonTestEnvironment();
  process.env.DATABASE_URL = environment.DATABASE_URL;
  process.env.DIRECT_URL = environment.DIRECT_URL;
  process.env.DB_SSL = 'true';
  process.env.DB_DIALECT = 'postgres';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import('../src/app.js');
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const email = `marketplace-${suffix}@example.invalid`;
  const businessName = `Fixture ${suffix} Vendor`;
  const categoryName = `Fixture ${suffix} Category`;
  const serviceTitle = `Fixture ${suffix} Service`;
  const city = `Fixture ${suffix} City`;
  let availableDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  let userId;
  let categoryId;
  let vendorId;
  let serviceId;
  let eventId;
  let bookingId;
  let reviewId;
  let packageId;
  let mediaId;
  let serviceMediaId;
  let requestSequence = 0;

  try {
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const get = async (path) => {
      const requestId = ++requestSequence;
      const started = performance.now();
      const poolState = () => (
        `${database.runtimePool.totalCount}/${database.runtimePool.idleCount}/${database.runtimePool.waitingCount}`
      );
      const before = poolState();
      try {
        const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(15000) });
        if (diagnosticsEnabled) {
          console.info(
            `[marketplace-http] request#${requestId} GET ${path.split('?')[0]} `
            + `status=${response.status} durationMs=${(performance.now() - started).toFixed(1)} `
            + `pool(total/idle/waiting)=${before}->${poolState()}`,
          );
        }
        return response;
      } catch (error) {
        if (diagnosticsEnabled) {
          console.info(
            `[marketplace-http] request#${requestId} GET ${path.split('?')[0]} `
            + `durationMs=${(performance.now() - started).toFixed(1)} `
            + `pool(total/idle/waiting)=${before}->${poolState()} error=${error.name || 'Error'}`,
          );
        }
        throw error;
      }
    };
    await database.inTransaction(async (transaction) => {
      const user = await transaction.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Marketplace Integration Vendor', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [email],
      );
      userId = Number(user.rows[0].id);
      const category = await transaction.query(
        `INSERT INTO service_categories
           (name, description, display_order, service_menu_order, service_menu_name,
            is_active, image, image_mime)
         VALUES ($1, 'Temporary marketplace test category', 990, 990, $1,
                 TRUE, $2, 'image/png')
         RETURNING id`,
        [categoryName, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      );
      categoryId = Number(category.rows[0].id);
      const vendor = await transaction.query(
        `INSERT INTO vendor_profiles
           (user_id, business_name, category_id, city, description, verification_status, is_featured)
         VALUES ($1, $2, $3, $4, 'Temporary public marketplace test vendor', 'verified', TRUE)
         RETURNING id`,
        [userId, businessName, categoryId, city],
      );
      vendorId = Number(vendor.rows[0].id);
      const service = await transaction.query(
        `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
         VALUES ($1, $2, $3, 'Temporary public marketplace test service', 1250, 'ETB', 'active')
         RETURNING id`,
        [vendorId, categoryId, serviceTitle],
      );
      serviceId = Number(service.rows[0].id);
      const packageRow = await transaction.query(
        `INSERT INTO service_packages
           (service_id, name, description, price, currency, included_features, extras, minimum_booking)
         VALUES ($1, 'Integration package', 'Temporary package', 1500, 'ETB',
                 '["Feature A"]'::jsonb, '[]'::jsonb, 1)
         RETURNING id`,
        [serviceId],
      );
      packageId = Number(packageRow.rows[0].id);
      await transaction.query(
        `INSERT INTO vendor_availability (vendor_id, available_date, status)
         VALUES ($1, $2::date, 'available')`,
        [vendorId, availableDate],
      );
      const event = await transaction.query(
        `INSERT INTO events (organizer_id, title, event_type, start_date, status)
         VALUES ($1, 'Marketplace integration event', $2, CURRENT_TIMESTAMP, 'active')
         RETURNING id`,
        [userId, categoryName],
      );
      eventId = Number(event.rows[0].id);
      const booking = await transaction.query(
        `INSERT INTO bookings
           (event_id, vendor_id, service_id, service_description, quoted_amount, status)
         VALUES ($1, $2, $3, 'Marketplace integration service', 1250, 'completed')
         RETURNING id`,
        [eventId, vendorId, serviceId],
      );
      bookingId = Number(booking.rows[0].id);
      const review = await transaction.query(
        `INSERT INTO reviews (booking_id, rating, comment, status)
         VALUES ($1, 5, 'Marketplace integration review', 'published')
         RETURNING id`,
        [bookingId],
      );
      reviewId = Number(review.rows[0].id);
      const media = await transaction.query(
        `INSERT INTO vendor_media
           (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
         VALUES ($1, NULL, 'logo', 'integration.png', 'image/png', 8, $2)
         RETURNING id`,
        [vendorId, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      );
      mediaId = Number(media.rows[0].id);
      const serviceMedia = await transaction.query(
        `INSERT INTO vendor_media
           (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
         VALUES ($1, $2, 'service', 'service-integration.png', 'image/png', 8, $3)
         RETURNING id`,
        [vendorId, serviceId, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      );
      serviceMediaId = Number(serviceMedia.rows[0].id);
    });

    installMarketplaceDiagnostics(database.runtimePool);

    await context.test('public vendor list and detail return correctly mapped optional data', async () => {
      const listResponse = await get(`/api/platform/vendors?search=${encodeURIComponent(suffix)}&page=1&limit=5`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json();
      const vendor = list.data.find((item) => item.id === vendorId);
      assert.ok(vendor);
      const detailResponse = await get(`/api/platform/vendors/${vendorId}`);
      assert.equal(detailResponse.status, 200);
      const detail = (await detailResponse.json()).data;
      assert.equal(detail.id, vendorId);
      assert.ok(Array.isArray(detail.services));
      assert.ok(Array.isArray(detail.reviews));
      assert.ok(Array.isArray(detail.availability));
      assert.equal(Object.values(detail.ratingDistribution).reduce((sum, count) => sum + count, 0), 1);
      assert.deepEqual(Object.keys(detail.reviews[0]).sort(), ['comment', 'createdAt', 'customerName', 'rating'].sort());
      assert.deepEqual(Object.keys(detail.availability[0]).sort(), ['date', 'status'].sort());
      const available = await get(`/api/platform/vendors?search=${encodeURIComponent(suffix)}&availableDate=${availableDate}`);
      assert.equal(available.status, 200);
      assert.ok((await available.json()).data.some((item) => item.id === vendorId && item.available));
    });

    await context.test('vendor discovery validates filters and accepts availability and recent sorting', async () => {
      const invalid = await get('/api/platform/vendors?minPrice=20000&maxPrice=10000');
      assert.equal(invalid.status, 400);
      const filtered = await get(`/api/platform/vendors?search=${encodeURIComponent(suffix)}&availableOnly=true&sort=recently-added&page=1&limit=5`);
      assert.equal(filtered.status, 200);
      const body = await filtered.json();
      assert.ok(body.data.some((vendor) => vendor.id === vendorId && vendor.available));
      assert.equal(body.pagination.page, 1);
    });

    await context.test('vendor discovery serves featured and popular views from real records', async () => {
      const expected = await database.runtimeAdapter.query(
        `SELECT vp.id FROM vendor_profiles vp
         JOIN users u ON u.id = vp.user_id AND u.status = 'active'
         WHERE vp.verification_status = 'verified' AND vp.is_featured = TRUE
         ORDER BY vp.id`,
      );
      const response = await get('/api/platform/vendors?filter=featured&sort=popular&page=1&limit=50');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.pagination.total, expected.rows.length);
      assert.deepEqual(
        new Set(body.data.map((vendor) => Number(vendor.id))),
        new Set(expected.rows.map((vendor) => Number(vendor.id))),
      );
      assert.ok(body.data.every((vendor) => vendor.isFeatured));
    });

    await context.test('vendor discovery accepts category slugs from public category links', async () => {
      const response = await get(`/api/platform/vendors?category=${encodeURIComponent(categoryName.toLowerCase().replaceAll(' ', '-'))}&page=1&limit=12`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.data.some((vendor) => vendor.id === vendorId));
      assert.ok(body.data.every((vendor) => vendor.category === categoryName));
    });

    await context.test('public categories only expose images uploaded to the database', async () => {
      const rows = await database.runtimeAdapter.query(
        'SELECT id, image_mime FROM service_categories WHERE is_active',
      );
      const response = await get('/api/platform/categories');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(Array.isArray(body.data));
      assert.deepEqual(body.categories, body.data);
      const category = body.data.find((item) => item.id === categoryId);
      assert.ok(category);
      const record = rows.rows.find((row) => Number(row.id) === category.id);
      assert.ok(record);
      assert.equal(category.image, `/api/platform/categories/${categoryId}/image`);
      assert.equal(category.icon, category.image);
      assert.equal(category.vendor_count, category.vendorCount);
      assert.ok(Number.isInteger(category.vendor_count));
    });

    await context.test('public categories return an empty array when the active category query is empty', async () => {
      const emptyCategoryApp = createApp({
        database: {
          dialect: 'postgres',
          async query(sql, values) {
            if (sql.includes('FROM system_settings')) return { rows: [] };
            assert.match(sql, /FROM service_categories sc/);
            assert.deepEqual(values, []);
            return { rows: [] };
          },
        },
        databaseDialect: 'postgres',
      });
      const emptyCategoryServer = emptyCategoryApp.listen(0, '127.0.0.1');
      try {
        await once(emptyCategoryServer, 'listening');
        const response = await fetch(
          `http://127.0.0.1:${emptyCategoryServer.address().port}/api/platform/categories`,
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { categories: [], data: [] });
      } finally {
        emptyCategoryServer.close();
        await once(emptyCategoryServer, 'close');
      }
    });

    await context.test('service navigation exposes ordered categories and stable category-slug filters', async () => {
      const expected = await database.runtimeAdapter.query(
        `SELECT COALESCE(service_menu_name, name) AS name
         FROM service_categories
         WHERE is_active = TRUE AND service_menu_order IS NOT NULL
         ORDER BY service_menu_order, name`,
      );
      const expectedPublicNames = expected.rows
        .map((row) => row.name)
        .filter(isPublicCategoryName);
      const response = await get('/api/platform/categories?scope=services');
      assert.equal(response.status, 200);
      const { categories } = await response.json();
      assert.deepEqual(categories.map((category) => category.name), expectedPublicNames);
      assert.ok(categories.some((category) => category.id === categoryId));
      const categoryDetail = await get(`/api/platform/categories/${categories.find((category) => category.id === categoryId).slug}`);
      assert.equal(categoryDetail.status, 200);
      assert.equal((await categoryDetail.json()).data.id, categoryId);
      for (const category of categories) {
        const servicesResponse = await get(`/api/platform/services?category=${encodeURIComponent(category.slug)}&page=1&limit=50`);
        assert.equal(servicesResponse.status, 200, category.name);
        const result = await servicesResponse.json();
        assert.ok(result.data.every((service) => service.categoryId === category.id), category.name);
        assert.equal(category.serviceCount, result.pagination.total, category.name);
      }
    });

    await context.test('service listings validate filters and support search, vendor, newest sort, and pagination', async () => {
      for (const query of [
        '?sort=unknown', '?page=0', '?limit=51', '?minPrice=200&maxPrice=100',
        '?vendorId=not-a-number', '?unexpected=true',
      ]) {
        const response = await get(`/api/platform/services${query}`);
        assert.equal(response.status, 400, query);
      }
      const response = await get(`/api/platform/services?search=${encodeURIComponent(suffix)}&vendor=${encodeURIComponent(businessName)}&location=${encodeURIComponent(city)}&sort=newest&page=1&limit=5`);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.data.some((service) => service.id === serviceId));
      assert.ok(result.data.every((service) => service.status === 'active' && service.published));
      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.limit, 5);
      const available = await get(`/api/platform/services?search=${encodeURIComponent(suffix)}&availableDate=${availableDate}`);
      assert.equal(available.status, 200);
      assert.ok((await available.json()).data.some((service) => service.id === serviceId && service.available));
    });

    await context.test('public category images allow embedding from the frontend origin', async () => {
      const response = await get(`/api/platform/categories/${categoryId}/image`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.match(response.headers.get('content-type') || '', /^image\//);
    });

    await context.test('public vendor and service media are owner-scoped and returned as bytes', async () => {
      const vendorMedia = await get(`/api/platform/vendors/${vendorId}/media/${mediaId}`);
      assert.equal(vendorMedia.status, 200);
      assert.equal(vendorMedia.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.equal((await vendorMedia.arrayBuffer()).byteLength, 8);

      const serviceMedia = await get(`/api/platform/services/${serviceId}/media/${serviceMediaId}`);
      assert.equal(serviceMedia.status, 200);
      assert.equal(serviceMedia.headers.get('cross-origin-resource-policy'), 'cross-origin');
      assert.equal((await serviceMedia.arrayBuffer()).byteLength, 8);
    });

    await context.test('public service packages and detail return correctly mapped optional data', async () => {
      const listResponse = await get(`/api/platform/services?search=${encodeURIComponent(suffix)}&page=1&limit=1`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json();
      assert.equal(list.data[0]?.id, serviceId);
      const detailResponse = await get(`/api/platform/services/${serviceId}`);
      assert.equal(detailResponse.status, 200);
      const service = (await detailResponse.json()).data;
      assert.equal(service.id, serviceId);
      assert.equal(service.vendorId, vendorId);
      assert.ok(service.vendorName);
      assert.equal(service.packages[0]?.id, packageId);
      assert.ok(Array.isArray(service.reviews));
      assert.ok(Array.isArray(service.availability));
      const comparison = await get(`/api/platform/services?ids=${serviceId}&limit=4`);
      assert.equal(comparison.status, 200);
      assert.deepEqual((await comparison.json()).data.map((item) => item.id), [serviceId]);
    });

    await context.test('public service comparison accepts bounded IDs and rejects malformed filters', async () => {
      const valid = await get(`/api/platform/services?ids=${serviceId}&limit=4`);
      assert.equal(valid.status, 200);
      const result = await valid.json();
      assert.deepEqual(result.data.map((service) => service.id), [serviceId]);
      assert.equal((await get(`/api/platform/services?ids=${serviceId},${serviceId}`)).status, 400);
    });

    await context.test('vendor detail distinguishes invalid IDs from unknown vendor IDs', async () => {
      const invalid = await get('/api/platform/vendors/not-a-number');
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: 'Invalid vendor ID.' });
      const unknown = await get('/api/platform/vendors/9007199254740991');
      assert.equal(unknown.status, 404);
      assert.deepEqual(await unknown.json(), { error: 'Vendor not found.' });
    });

    await context.test('vendor-only profile and dashboard APIs reject anonymous requests', async () => {
      for (const path of [
        '/api/vendor/overview', '/api/vendor/profile', '/api/vendor/services',
        '/api/vendor/availability', '/api/vendor/reviews',
      ]) {
        const response = await get(path);
        assert.equal(response.status, 401, path);
      }
    });
  } finally {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
    try {
      if (userId) {
        await database.inTransaction(async (transaction) => {
          if (reviewId) await transaction.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
          if (bookingId) await transaction.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
          if (eventId) await transaction.query('DELETE FROM events WHERE id = $1', [eventId]);
          if (packageId) await transaction.query('DELETE FROM service_packages WHERE id = $1', [packageId]);
          if (vendorId) await transaction.query('DELETE FROM vendor_media WHERE vendor_id = $1', [vendorId]);
          if (serviceId) await transaction.query('DELETE FROM services WHERE id = $1', [serviceId]);
          if (vendorId) await transaction.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
          await transaction.query('DELETE FROM users WHERE id = $1', [userId]);
          if (categoryId) await transaction.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
        });
      }
    } finally {
      await database.close();
    }
  }
});
