import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { loadPostgresPublicMarketplace } from '../src/lib/postgresMarketplace.js';
import { postgresApplicationTables } from '../src/lib/postgresSchema.js';
import { requireAdmin } from '../src/middleware/requireAdmin.js';
import { requirePlatformRole } from '../src/middleware/requirePlatformUser.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

function authorizeWithPostgres(middleware, database, cookieName, token) {
  return new Promise((resolve) => {
    const req = {
      cookies: { [cookieName]: token },
      app: { locals: { database, databaseDialect: 'postgres' } },
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
      clearCookie() {},
    };
    middleware(req, res, (error) => resolve({ status: error ? 500 : 200, error }));
  });
}

test('Neon PostgreSQL core CRUD and relationships (transaction rolled back)', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const rollback = new Error('ROLLBACK_NEON_INTEGRATION_FIXTURES');
  const email = `pg-integration-${randomUUID()}@example.invalid`;
  let version;
  let databaseName;

  try {
    const identity = await database.verifyRuntimeConnection();
    version = identity.server_version;
    databaseName = identity.database_name;
    assert.match(version, /^PostgreSQL 18\b/);
    assert.equal(databaseName, 'eventhub');
    const schema = await database.runtimeAdapter.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const existingTables = new Set(schema.rows.map((row) => row.tablename));
    assert.equal(postgresApplicationTables.length, 51);
    assert.ok(postgresApplicationTables.every((table) => existingTables.has(table)));

    await assert.rejects(database.inTransaction(async (client) => {
      const organizer = (await client.query(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        ['Integration Organizer', email, 'synthetic-not-a-login-hash'],
      )).rows[0];
      const vendorUser = (await client.query(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        ['Integration Vendor', `vendor-${email}`, 'synthetic-not-a-login-hash'],
      )).rows[0];
      await assert.rejects(
        database.inTransaction((tx) => tx.query(
          `INSERT INTO users (full_name, email, password_hash)
           VALUES ($1, $2, $3)`,
          ['Duplicate Integration User', email.toUpperCase(), 'synthetic-not-a-login-hash'],
        )),
        (error) => error.code === '23505',
      );

      const role = (await client.query(
        `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id`,
        [`integration-${randomUUID()}`, 'Temporary integration role'],
      )).rows[0];
      const permission = (await client.query(
        `INSERT INTO permissions (permission_key, description) VALUES ($1, $2) RETURNING id, permission_key`,
        [`integration:${randomUUID()}`, 'Temporary integration permission'],
      )).rows[0];
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [organizer.id, role.id]);
      await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [role.id, permission.id]);
      assert.equal((await client.query(
        `SELECT p.permission_key FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1 AND rp.role_id = $2`,
        [organizer.id, role.id],
      )).rows[0].permission_key, permission.permission_key);

      const category = (await client.query(
        'INSERT INTO service_categories (name) VALUES ($1) RETURNING id',
        [`Integration ${randomUUID()}`],
      )).rows[0];
      const vendor = (await client.query(
        `INSERT INTO vendor_profiles (user_id, business_name, category_id, city, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [vendorUser.id, 'Temporary Integration Vendor', category.id, 'Test City', 'Temporary fixture'],
      )).rows[0];
      const event = (await client.query(
        `INSERT INTO events (organizer_id, title, event_type, city, start_date)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '1 day') RETURNING id`,
        [organizer.id, 'Temporary Integration Event', 'Test', 'Test City'],
      )).rows[0];
      const booking = (await client.query(
        `INSERT INTO bookings (event_id, vendor_id, service_description, quoted_amount)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [event.id, vendor.id, 'Temporary integration service', 12.50],
      )).rows[0];
      const payment = (await client.query(
        `INSERT INTO payments (booking_id, amount, provider, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [booking.id, 12.50, 'test', 'pending'],
      )).rows[0];
      const review = (await client.query(
        `INSERT INTO reviews (booking_id, rating, comment)
         VALUES ($1, $2, $3) RETURNING id`,
        [booking.id, 5, 'Temporary integration review'],
      )).rows[0];
      const complaint = (await client.query(
        `INSERT INTO complaints (user_id, booking_id, subject, details)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [organizer.id, booking.id, 'Temporary integration complaint', 'Temporary fixture'],
      )).rows[0];
      const notification = (await client.query(
        `INSERT INTO notifications (user_id, title, message)
         VALUES ($1, $2, $3) RETURNING id`,
        [organizer.id, 'Temporary integration notification', 'Temporary fixture'],
      )).rows[0];
      const session = (await client.query(
        `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour') RETURNING id`,
        [randomUUID().replaceAll('-', '').padEnd(64, '0'), organizer.id],
      )).rows[0];

      await client.query('UPDATE users SET full_name = $1 WHERE id = $2', ['Updated Organizer', organizer.id]);
      await client.query('UPDATE roles SET description = $1 WHERE id = $2', ['Updated role', role.id]);
      await client.query('UPDATE permissions SET description = $1 WHERE id = $2', ['Updated permission', permission.id]);
      await client.query('UPDATE vendor_profiles SET city = $1 WHERE id = $2', ['Updated City', vendor.id]);
      await client.query('UPDATE events SET title = $1 WHERE id = $2', ['Updated Event', event.id]);
      await client.query('UPDATE bookings SET status = $1 WHERE id = $2', ['accepted', booking.id]);
      await client.query('UPDATE payments SET status = $1 WHERE id = $2', ['paid', payment.id]);
      await client.query('UPDATE reviews SET status = $1 WHERE id = $2', ['hidden', review.id]);
      await client.query('UPDATE complaints SET status = $1 WHERE id = $2', ['investigating', complaint.id]);
      await client.query('UPDATE notifications SET status = $1 WHERE id = $2', ['read', notification.id]);
      await client.query('UPDATE admin_sessions SET expires_at = CURRENT_TIMESTAMP WHERE id = $1', [session.id]);

      assert.equal((await client.query('SELECT full_name FROM users WHERE id = $1', [organizer.id])).rows[0].full_name, 'Updated Organizer');
      assert.equal((await client.query('SELECT city FROM vendor_profiles WHERE id = $1', [vendor.id])).rows[0].city, 'Updated City');
      assert.equal((await client.query('SELECT title FROM events WHERE id = $1', [event.id])).rows[0].title, 'Updated Event');
      assert.equal((await client.query('SELECT status FROM bookings WHERE id = $1', [booking.id])).rows[0].status, 'accepted');
      assert.equal((await client.query('SELECT status FROM payments WHERE id = $1', [payment.id])).rows[0].status, 'paid');
      assert.equal((await client.query('SELECT status FROM reviews WHERE id = $1', [review.id])).rows[0].status, 'hidden');
      assert.equal((await client.query('SELECT status FROM complaints WHERE id = $1', [complaint.id])).rows[0].status, 'investigating');
      assert.equal((await client.query('SELECT status FROM notifications WHERE id = $1', [notification.id])).rows[0].status, 'read');

      throw rollback;
    }), (error) => error === rollback);

    const residue = await database.runtimeAdapter.query('SELECT id FROM users WHERE email = $1', [email]);
    assert.equal(residue.rowCount, 0, 'integration fixtures must be rolled back');
    console.log(`Neon PostgreSQL integration verified against ${databaseName} (${version.split(' ')[1]}): users, RBAC, vendors, events, bookings, payments, reviews, complaints, notifications, sessions; CRUD and relationships passed with rollback.`);
  } finally {
    await database.close();
  }
});

test('Neon PostgreSQL registration, login, session, and logout use persisted auth data', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 90000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const email = `pg-auth-${randomUUID()}@example.invalid`;
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const fetchWithTimeout = (url, options = {}) => fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    });
    const registerResponse = await fetchWithTimeout(`${baseUrl}/api/platform/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'am' },
      body: JSON.stringify({
        name: 'Neon Auth Integration',
        email,
        password: 'NeonPass12345',
      }),
    });
    const registered = await registerResponse.json();
    assert.equal(registerResponse.status, 201, JSON.stringify(registered));
    assert.equal(registered.data.user.role, 'customer');
    assert.equal(registered.data.user.email, email);

    const userResult = await database.runtimeAdapter.query(
      `SELECT u.id, u.password_hash, u.preferred_language, r.name AS role
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1`,
      [email],
    );
    const savedUser = userResult.rows[0];
    assert.ok(savedUser);
    assert.equal(savedUser.preferred_language, 'am');
    assert.equal(savedUser.role.toLowerCase(), 'customer');
    assert.equal(await bcrypt.compare('NeonPass12345', savedUser.password_hash), true);

    const badLogin = await fetchWithTimeout(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'incorrect password' }),
    });
    assert.equal(badLogin.status, 401);

    const loginResponse = await fetchWithTimeout(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'NeonPass12345' }),
    });
    assert.equal(loginResponse.status, 200);
    const loginCookie = loginResponse.headers.get('set-cookie').split(';', 1)[0];
    const token = decodeURIComponent(loginCookie.slice(loginCookie.indexOf('=') + 1));
    const customerAccess = await authorizeWithPostgres(
      requirePlatformRole('customer'),
      database.runtimeAdapter,
      'platform_session',
      token,
    );
    assert.equal(customerAccess.status, 200);
    const vendorAccess = await authorizeWithPostgres(
      requirePlatformRole('vendor'),
      database.runtimeAdapter,
      'platform_session',
      token,
    );
    assert.equal(vendorAccess.status, 403);
    const adminAccess = await authorizeWithPostgres(
      requireAdmin,
      database.runtimeAdapter,
      'platform_session',
      token,
    );
    assert.equal(adminAccess.status, 403);
    const sessionResult = await database.runtimeAdapter.query(
      `SELECT s.expires_at FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = $1 AND s.expires_at > NOW()`,
      [email],
    );
    assert.ok(sessionResult.rowCount >= 1);

    const meResponse = await fetchWithTimeout(`${baseUrl}/api/platform/me`, {
      headers: { Cookie: loginCookie },
    });
    const me = await meResponse.json();
    assert.equal(meResponse.status, 200);
    assert.equal(me.data.user.email, email);
    assert.equal(me.data.user.role, 'customer');

    const expiredSession = await database.runtimeAdapter.query(
      `UPDATE user_sessions SET expires_at = NOW() - INTERVAL '1 second'
       WHERE user_id = $1`,
      [savedUser.id],
    );
    assert.ok(expiredSession.rowCount >= 1);
    const expiredMeResponse = await fetchWithTimeout(`${baseUrl}/api/platform/me`, {
      headers: { Cookie: loginCookie },
    });
    assert.equal(expiredMeResponse.status, 401);
    assert.deepEqual(await expiredMeResponse.json(), { message: 'Unauthorized' });
    assert.match(expiredMeResponse.headers.get('set-cookie') || '', /^platform_session=;/);

    const refreshedLogin = await fetchWithTimeout(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'NeonPass12345' }),
    });
    assert.equal(refreshedLogin.status, 200);
    const refreshedCookie = refreshedLogin.headers.get('set-cookie').split(';', 1)[0];
    const logoutResponse = await fetchWithTimeout(`${baseUrl}/api/platform/logout`, {
      method: 'POST',
      headers: { Cookie: refreshedCookie },
    });
    assert.equal(logoutResponse.status, 204);
    const afterLogout = await fetchWithTimeout(`${baseUrl}/api/platform/me`, {
      headers: { Cookie: refreshedCookie },
    });
    assert.equal(afterLogout.status, 401);
    assert.deepEqual(await afterLogout.json(), { message: 'Unauthorized' });
    assert.match(afterLogout.headers.get('set-cookie') || '', /^platform_session=;/);

    console.log('Neon PostgreSQL auth integration verified: registration, bcrypt, role assignment, invalid/valid login, session lookup/expiry/logout, customer/vendor/admin authorization.');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    const user = await database.runtimeAdapter.query('SELECT id FROM users WHERE email = $1', [email]);
    if (user.rows[0]) {
      const notificationKey = `user-registration:${user.rows[0].id}:%`;
      await database.runtimeAdapter.query(
        `DELETE FROM notification_history
         WHERE notification_id IN (
           SELECT id FROM notifications WHERE idempotency_key LIKE $1
         )`,
        [notificationKey],
      );
      await database.runtimeAdapter.query(
        'DELETE FROM notifications WHERE idempotency_key LIKE $1',
        [notificationKey],
      );
      await database.runtimeAdapter.query('DELETE FROM audit_logs WHERE actor_id = $1', [user.rows[0].id]);
      await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = $1', [user.rows[0].id]);
      await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [user.rows[0].id]);
    }
    await database.close();
  }
});

test('Neon PostgreSQL public event and marketplace endpoints query the live schema', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 60000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform`;
    const listingResponse = await fetch(`${baseUrl}/events?search=music&sort=popular&limit=5`);
    const featuredResponse = await fetch(`${baseUrl}/events/featured`);
    const categoriesResponse = await fetch(`${baseUrl}/events/categories`);
    const venuesResponse = await fetch(`${baseUrl}/events/popular-venues?limit=5`);
    const vendorResponse = await fetch(`${baseUrl}/vendors?limit=5`);
    const serviceResponse = await fetch(`${baseUrl}/services?limit=5`);
    const serviceCategoryResponse = await fetch(`${baseUrl}/categories?scope=services`);
    assert.deepEqual([
      listingResponse.status,
      featuredResponse.status,
      categoriesResponse.status,
      venuesResponse.status,
      vendorResponse.status,
      serviceResponse.status,
      serviceCategoryResponse.status,
    ], [200, 200, 200, 200, 200, 200, 200]);
    const listing = await listingResponse.json();
    const featured = await featuredResponse.json();
    const categories = await categoriesResponse.json();
    const venues = await venuesResponse.json();
    const vendors = await vendorResponse.json();
    const services = await serviceResponse.json();
    const serviceCategories = await serviceCategoryResponse.json();
    assert.ok(Array.isArray(listing.data));
    assert.equal(typeof listing.pagination.total, 'number');
    assert.ok(Array.isArray(featured.data));
    assert.ok(Array.isArray(categories.data));
    assert.ok(Array.isArray(venues.data));
    assert.ok(Array.isArray(vendors.data));
    assert.ok(Array.isArray(services.data));
    assert.ok(Array.isArray(serviceCategories.data));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await database.close();
  }
});

test('Neon PostgreSQL populated marketplace detail workflows return persisted relationships', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 90000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const userEmail = `pg-marketplace-${suffix}@example.invalid`;
  const inactiveEmail = `pg-marketplace-pending-${suffix}@example.invalid`;
  const marker = `Marketplace ${suffix}`;
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  const serverListening = once(server, 'listening');
  let userId;
  let inactiveUserId;
  let vendorId;
  let pendingVendorId;
  let categoryId;
  let serviceId;
  let pendingServiceId;
  let archivedServiceId;
  let eventId;
  let bookingId;

  try {
    const user = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [`${marker} Vendor`, userEmail, 'integration-only-not-a-password'],
    );
    userId = user.rows[0].id;
    const inactiveUser = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [`${marker} Pending Vendor`, inactiveEmail, 'integration-only-not-a-password'],
    );
    inactiveUserId = inactiveUser.rows[0].id;
    const category = await database.runtimeAdapter.query(
      `INSERT INTO service_categories
         (name, description, display_order, service_menu_order, service_menu_name)
       VALUES ($1, $2, 1, 1, $3) RETURNING id`,
      [`${marker} Category`, 'Neon marketplace integration category', `${marker} Services`],
    );
    categoryId = category.rows[0].id;
    const vendor = await database.runtimeAdapter.query(
      `INSERT INTO vendor_profiles
         (user_id, business_name, category_id, city, description, verification_status, is_featured)
       VALUES ($1, $2, $3, $4, $5, 'verified', TRUE) RETURNING id`,
      [userId, `${marker} Business`, categoryId, 'Test City', 'Persisted Neon vendor profile'],
    );
    vendorId = vendor.rows[0].id;
    const pendingVendor = await database.runtimeAdapter.query(
      `INSERT INTO vendor_profiles
         (user_id, business_name, category_id, city, description, verification_status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [inactiveUserId, `${marker} Hidden Business`, categoryId, 'Test City', 'Unverified fixture'],
    );
    pendingVendorId = pendingVendor.rows[0].id;
    const service = await database.runtimeAdapter.query(
      `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'ETB', 'active') RETURNING id`,
      [vendorId, categoryId, `${marker} Service`, 'Persisted service details', 1234.50],
    );
    serviceId = service.rows[0].id;
    const pendingService = await database.runtimeAdapter.query(
      `INSERT INTO services (vendor_id, category_id, title, description, price, status)
       VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [pendingVendorId, categoryId, `${marker} Hidden Service`, 'Unverified vendor service', 10],
    );
    pendingServiceId = pendingService.rows[0].id;
    const archivedService = await database.runtimeAdapter.query(
      `INSERT INTO services (vendor_id, category_id, title, description, price, status)
       VALUES ($1, $2, $3, $4, $5, 'archived') RETURNING id`,
      [vendorId, categoryId, `${marker} Archived Service`, 'Inactive service', 20],
    );
    archivedServiceId = archivedService.rows[0].id;
    await database.runtimeAdapter.query(
      `INSERT INTO service_packages
         (service_id, name, description, price, currency, included_features, extras, minimum_booking)
       VALUES ($1, $2, $3, $4, 'ETB', $5::jsonb, $6::jsonb, $7)`,
      [
        serviceId,
        `${marker} Package`,
        'Persisted package',
        2345,
        JSON.stringify(['Lighting', 'Sound']),
        JSON.stringify([{ name: 'Extra', description: 'Optional upgrade' }]),
        2,
      ],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO vendor_media
         (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
       VALUES ($1, NULL, 'logo', $2, 'image/png', $3, $4)`,
      [vendorId, `${marker}-logo.png`, image.length, image],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO vendor_media
         (vendor_id, service_id, media_type, original_name, content_type, file_size, content)
       VALUES ($1, $2, 'service', $3, 'image/png', $4, $5)`,
      [vendorId, serviceId, `${marker}-service.png`, image.length, image],
    );
    const event = await database.runtimeAdapter.query(
      `INSERT INTO events (organizer_id, title, event_type, city, start_date, status)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '10 days', 'active') RETURNING id`,
      [userId, `${marker} Event`, `${marker} Category`, 'Test City'],
    );
    eventId = event.rows[0].id;
    const booking = await database.runtimeAdapter.query(
      `INSERT INTO bookings
         (event_id, vendor_id, service_id, service_description, quoted_amount, scheduled_date)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + INTERVAL '11 days') RETURNING id`,
      [eventId, vendorId, serviceId, `${marker} Service`, 1234.50],
    );
    bookingId = booking.rows[0].id;
    await database.runtimeAdapter.query(
      `INSERT INTO reviews (booking_id, rating, comment, status)
       VALUES ($1, 5, $2, 'published')`,
      [bookingId, `${marker} verified review`],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO vendor_availability (vendor_id, available_date, status)
       VALUES ($1, CURRENT_DATE + INTERVAL '11 days', 'available')`,
      [vendorId],
    );
    const marketplace = await loadPostgresPublicMarketplace(database.runtimeAdapter);
    assert.ok(marketplace.vendors.some((entry) => entry.id === Number(vendorId)));
    assert.ok(marketplace.services.some((entry) => entry.id === Number(serviceId)));

    await serverListening;
    const root = `http://127.0.0.1:${server.address().port}/api/platform`;
    const vendorListingResponse = await fetch(`${root}/vendors?search=${encodeURIComponent(suffix)}&limit=5`);
    const vendorDetailResponse = await fetch(`${root}/vendors/${vendorId}`);
    const serviceListingResponse = await fetch(`${root}/services?search=${encodeURIComponent(suffix)}&limit=5`);
    const serviceCategoryListingResponse = await fetch(`${root}/services?category=${encodeURIComponent(`${marker} Services`)}`);
    const servicePriceFilterResponse = await fetch(`${root}/services?search=${encodeURIComponent(suffix)}&minPrice=2000`);
    const serviceDetailResponse = await fetch(`${root}/services/${serviceId}`);
    const pendingServiceResponse = await fetch(`${root}/services/${pendingServiceId}`);
    const archivedServiceResponse = await fetch(`${root}/services/${archivedServiceId}`);
    const categorySlug = `${marker} Category`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const categoryResponse = await fetch(`${root}/categories/${encodeURIComponent(categorySlug)}`);
    const pendingDetailResponse = await fetch(`${root}/vendors/${pendingVendorId}`);
    const vendorListing = await vendorListingResponse.json();
    const vendorDetail = await vendorDetailResponse.json();
    const serviceListing = await serviceListingResponse.json();
    const serviceDetail = await serviceDetailResponse.json();
    const categoryDetail = await categoryResponse.json();

    assert.equal(vendorListingResponse.status, 200);
    assert.equal(vendorListing.data.length, 1);
    assert.equal(vendorListing.data[0].id, Number(vendorId));
    assert.equal(vendorListing.data[0].business_name, `${marker} Business`);
    assert.equal(vendorListing.data[0].verified, true);
    assert.equal(vendorListing.data[0].publicServiceCount, 1);
    assert.equal(vendorDetailResponse.status, 200);
    assert.equal(vendorDetail.data.id, Number(vendorId));
    assert.equal(vendorDetail.data.category, `${marker} Category`);
    assert.equal(vendorDetail.data.services[0].id, Number(serviceId));
    assert.equal(vendorDetail.data.services[0].price, 1234.5);
    assert.equal(vendorDetail.data.rating, 5);
    assert.equal(vendorDetail.data.reviewCount, 1);
    assert.equal(vendorDetail.data.reviews[0].comment, `${marker} verified review`);
    assert.ok(vendorDetail.data.logoUrl.endsWith('/media/1') || vendorDetail.data.logoUrl.includes('/media/'));
    assert.equal(serviceListingResponse.status, 200);
    assert.equal(serviceListing.data.length, 1);
    assert.equal(serviceListing.data[0].id, Number(serviceId));
    assert.equal(serviceListing.data[0].vendorId, Number(vendorId));
    assert.equal(serviceListing.data[0].rating, 5);
    assert.equal(serviceCategoryListingResponse.status, 200);
    assert.equal((await serviceCategoryListingResponse.json()).data.some((entry) => entry.id === Number(serviceId)), true);
    assert.equal(servicePriceFilterResponse.status, 200);
    assert.deepEqual((await servicePriceFilterResponse.json()).data, []);
    assert.equal(serviceDetailResponse.status, 200);
    assert.equal(serviceDetail.data.title, `${marker} Service`);
    assert.equal(serviceDetail.data.category, `${marker} Services`);
    assert.equal(serviceDetail.data.vendorProfile.id, Number(vendorId));
    assert.equal(serviceDetail.data.packages.length, 1);
    assert.deepEqual(serviceDetail.data.packages[0].includedFeatures, ['Lighting', 'Sound']);
    assert.equal(serviceDetail.data.packages[0].minimumBooking, 2);
    assert.equal(serviceDetail.data.images.length, 1);
    assert.equal(serviceDetail.data.reviews[0].comment, `${marker} verified review`);
    assert.ok(serviceDetail.data.availability.some((entry) => entry.status === 'available'));
    assert.equal(categoryResponse.status, 200);
    assert.equal(categoryDetail.data.name, `${marker} Category`);
    assert.equal(categoryDetail.data.vendors.some((entry) => entry.id === Number(vendorId)), true);
    assert.equal(categoryDetail.data.services.some((entry) => entry.id === Number(serviceId)), true);
    assert.equal(categoryDetail.data.events[0].title, `${marker} Event`);
    assert.equal(pendingDetailResponse.status, 404);
    assert.equal(pendingServiceResponse.status, 404);
    assert.equal(archivedServiceResponse.status, 404);
    assert.equal((await fetch(`${root}/services/999999999`)).status, 404);

    const vendorMediaUrl = vendorDetail.data.logoUrl;
    const serviceMediaUrl = serviceDetail.data.images[0].url;
    const [vendorMediaResponse, serviceMediaResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${server.address().port}${vendorMediaUrl}`),
      fetch(`http://127.0.0.1:${server.address().port}${serviceMediaUrl}`),
    ]);
    assert.equal(vendorMediaResponse.status, 200);
    assert.deepEqual(Buffer.from(await vendorMediaResponse.arrayBuffer()), image);
    assert.equal(serviceMediaResponse.status, 200);
    assert.deepEqual(Buffer.from(await serviceMediaResponse.arrayBuffer()), image);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    if (vendorId) {
      await database.runtimeAdapter.query('DELETE FROM vendor_media WHERE vendor_id = $1', [vendorId]);
      await database.runtimeAdapter.query('DELETE FROM vendor_availability WHERE vendor_id = $1', [vendorId]);
      if (bookingId) {
        await database.runtimeAdapter.query('DELETE FROM reviews WHERE booking_id = $1', [bookingId]);
        await database.runtimeAdapter.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
      }
      if (serviceId) {
        await database.runtimeAdapter.query('DELETE FROM service_packages WHERE service_id = $1', [serviceId]);
      }
      const fixtureServiceIds = [serviceId, pendingServiceId, archivedServiceId].filter(Boolean);
      if (fixtureServiceIds.length) {
        await database.runtimeAdapter.query('DELETE FROM services WHERE id = ANY($1::bigint[])', [fixtureServiceIds]);
      }
      await database.runtimeAdapter.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
    }
    if (pendingVendorId) {
      await database.runtimeAdapter.query('DELETE FROM vendor_profiles WHERE id = $1', [pendingVendorId]);
    }
    if (eventId) await database.runtimeAdapter.query('DELETE FROM events WHERE id = $1', [eventId]);
    if (categoryId) await database.runtimeAdapter.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
    if (userId) await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
    if (inactiveUserId) await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [inactiveUserId]);
    const residue = await database.runtimeAdapter.query(
      `SELECT COUNT(*) AS remaining
       FROM users WHERE email = ANY($1::text[])`,
      [[userEmail, inactiveEmail]],
    );
    assert.equal(Number(residue.rows[0].remaining), 0, 'only test-created marketplace users are removed');
    await database.close();
  }
});
