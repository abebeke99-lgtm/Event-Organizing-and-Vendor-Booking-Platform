import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import cookieParser from 'cookie-parser';
import express from 'express';
import { test } from 'node:test';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { hashToken } from '../src/lib/security.js';
import { requireAdmin } from '../src/middleware/requireAdmin.js';
import { createPostgresDatabase } from '../src/postgresDb.js';
import { runPostgresMigrations } from '../src/lib/postgresMigrate.js';
import { createPostgresAdminCatalogRouter } from '../src/routes/postgresAdminCatalog.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon admin catalog routes enforce private verification access and manage categories', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use the configured Neon test database.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const adminEmail = `catalog-admin-${suffix}@example.invalid`;
  const memberEmail = `catalog-member-${suffix}@example.invalid`;
  const vendorEmail = `catalog-vendor-${suffix}@example.invalid`;
  const adminRoleName = `catalog-admin-${suffix}`;
  const memberRoleName = `catalog-member-${suffix}`;
  const categoryName = `Catalog integration ${suffix}`;
  const adminToken = randomBytes(32).toString('hex');
  const memberToken = randomBytes(32).toString('hex');
  const documentContent = Buffer.from('%PDF-1.7 integration verification document');
  const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const userIds = [];
  let adminId;
  let adminRoleId;
  let memberRoleId;
  let vendorId;
  let documentId;
  let vendorCategoryId;
  let managedCategoryId;
  let server;

  try {
    await runPostgresMigrations(database, { allowedMigrations: ['012_postgres_admin_catalog.sql'] });
    await runPostgresMigrations(database, { allowedMigrations: ['012_postgres_admin_catalog.sql'] });
    await database.inTransaction(async (client) => {
      const adminRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary catalog integration administrator', TRUE, TRUE) RETURNING id`,
        [adminRoleName],
      );
      adminRoleId = adminRole.rows[0].id;
      const memberRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary catalog integration member', FALSE, TRUE) RETURNING id`,
        [memberRoleName],
      );
      memberRoleId = memberRole.rows[0].id;
      const admin = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Catalog Integration Admin', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [adminEmail],
      );
      adminId = admin.rows[0].id;
      userIds.push(adminId);
      const member = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Catalog Integration Member', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [memberEmail],
      );
      userIds.push(member.rows[0].id);
      const vendor = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Catalog Integration Vendor', $1, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
        [vendorEmail],
      );
      userIds.push(vendor.rows[0].id);
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)',
        [adminId, adminRoleId, member.rows[0].id, memberRoleId],
      );
      await client.query(
        `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(adminToken), adminId],
      );
      await client.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(memberToken), member.rows[0].id],
      );
      const category = await client.query(
        'INSERT INTO service_categories (name) VALUES ($1) RETURNING id',
        [`Vendor category ${suffix}`],
      );
      vendorCategoryId = category.rows[0].id;
      const profile = await client.query(
        `INSERT INTO vendor_profiles (user_id, business_name, category_id, verification_status)
         VALUES ($1, 'Catalog Integration Vendor Business', $2, 'pending') RETURNING id`,
        [vendor.rows[0].id, vendorCategoryId],
      );
      vendorId = profile.rows[0].id;
      const document = await client.query(
        `INSERT INTO vendor_verification_documents
           (vendor_id, uploaded_by, original_name, content_type, file_size, content)
         VALUES ($1, $2, 'private-license.pdf', 'application/pdf', $3, $4) RETURNING id`,
        [vendorId, vendor.rows[0].id, documentContent.length, documentContent],
      );
      documentId = document.rows[0].id;
    });

    const app = express();
    app.locals.database = database.runtimeAdapter;
    app.locals.databaseDialect = 'postgres';
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/admin', requireAdmin, createPostgresAdminCatalogRouter({ database: database.runtimeAdapter }));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
    const request = (path, { method = 'GET', body, token = adminToken, platform = false, contentType } = {}) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `${platform ? 'platform_session' : 'admin_session'}=${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': contentType || 'application/json' }),
      },
      ...(body === undefined ? {} : { body: contentType ? body : JSON.stringify(body) }),
    });

    const anonymousDocument = await request(
      `/vendor-verification/${vendorId}/documents/${documentId}`,
      { token: null },
    );
    assert.equal(anonymousDocument.status, 401);
    const memberDocument = await request(
      `/vendor-verification/${vendorId}/documents/${documentId}`,
      { token: memberToken, platform: true },
    );
    assert.equal(memberDocument.status, 403);

    const listResponse = await request(`/vendor-verification?page=1&pageSize=10&q=${encodeURIComponent(vendorEmail)}`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const vendorRow = list.data.find((item) => String(item.id) === String(vendorId));
    assert.ok(vendorRow);
    assert.equal(vendorRow.document_count, 1);

    const detailResponse = await request(`/vendor-verification/${vendorId}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()).data;
    assert.equal(detail.documents[0].id, documentId);
    assert.equal(Object.hasOwn(detail.documents[0], 'content'), false);

    const download = await request(`/vendor-verification/${vendorId}/documents/${documentId}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), documentContent);

    const invalidTransition = await request(`/vendor-verification/${vendorId}/status`, {
      method: 'PATCH',
      body: { status: 'verified', reason: 'Unsupported direct transition' },
    });
    assert.equal(invalidTransition.status, 409);
    const review = await request(`/vendor-verification/${vendorId}/status`, {
      method: 'PATCH',
      body: { status: 'under_review', reason: 'Initial application review' },
    });
    assert.equal(review.status, 200);
    const approval = await request(`/vendor-verification/${vendorId}/status`, {
      method: 'PATCH',
      body: { status: 'verified', reason: 'Documents and business details checked' },
    });
    assert.equal(approval.status, 200);
    assert.equal((await approval.json()).data.previous_status, 'under_review');
    const featured = await request(`/vendors/${vendorId}/featured`, {
      method: 'PATCH',
      body: { is_featured: true },
    });
    assert.equal(featured.status, 200);

    const createdCategory = await request('/categories', {
      method: 'POST',
      body: { name: categoryName, description: 'Created by catalog integration', display_order: 7 },
    });
    assert.equal(createdCategory.status, 201);
    managedCategoryId = (await createdCategory.json()).data.id;
    const categoryListResponse = await request(`/categories?q=${encodeURIComponent(categoryName)}&sortBy=display_order`);
    assert.equal(categoryListResponse.status, 200);
    const categoryList = await categoryListResponse.json();
    assert.equal(categoryList.data[0].display_order, 7);
    assert.equal(categoryList.data[0].service_count, 0);

    const updatedCategory = await request(`/categories/${managedCategoryId}`, {
      method: 'PATCH',
      body: { description: 'Updated by catalog integration', display_order: 8 },
    });
    assert.equal(updatedCategory.status, 200);
    const uploadedImage = await request(`/categories/${managedCategoryId}/image`, {
      method: 'PUT',
      body: imageContent,
      contentType: 'image/png',
    });
    assert.equal(uploadedImage.status, 200);
    assert.equal((await uploadedImage.json()).data.image, `/api/platform/categories/${managedCategoryId}/image`);
    const imageResponse = await request(`/categories/${managedCategoryId}/image`);
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageContent);

    const deactivated = await request(`/categories/${managedCategoryId}/status`, {
      method: 'PATCH',
      body: { is_active: false },
    });
    assert.equal(deactivated.status, 200);
    const history = await request(`/categories/${managedCategoryId}/history?pageSize=50`);
    assert.equal(history.status, 200);
    assert.ok((await history.json()).data.length >= 4);
    const removedImage = await request(`/categories/${managedCategoryId}/image`, { method: 'DELETE' });
    assert.equal(removedImage.status, 204);
  } finally {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
    if (userIds.length || adminRoleId || memberRoleId || vendorId || vendorCategoryId || managedCategoryId) {
      await database.inTransaction(async (client) => {
        const verificationNotifications = vendorId
          ? await client.query(
            `SELECT id FROM notifications
             WHERE notification_type = 'vendor_verification'
               AND related_entity_type = 'vendor' AND related_entity_id = $1`,
            [String(vendorId)],
          )
          : { rows: [] };
        if (verificationNotifications.rows.length) {
          const notificationIds = verificationNotifications.rows.map((row) => row.id);
          await client.query('DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])', [notificationIds]);
          await client.query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [notificationIds]);
        }
        await client.query(
          `DELETE FROM audit_logs
           WHERE actor_id = $1 OR (entity_type = 'vendor' AND entity_id = $2)
             OR (entity_type = 'service_category' AND entity_id = ANY($3::text[]))`,
          [
            adminId || -1,
            vendorId ? String(vendorId) : '',
            [vendorCategoryId, managedCategoryId].filter(Boolean).map(String),
          ],
        );
        if (vendorId) {
          await client.query('DELETE FROM vendor_verification_history WHERE vendor_id = $1', [vendorId]);
          await client.query('DELETE FROM vendor_verification_documents WHERE vendor_id = $1', [vendorId]);
          await client.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
        }
        if (managedCategoryId) await client.query('DELETE FROM service_categories WHERE id = $1', [managedCategoryId]);
        if (vendorCategoryId) await client.query('DELETE FROM service_categories WHERE id = $1', [vendorCategoryId]);
        if (userIds.length) {
          await client.query('DELETE FROM admin_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
          await client.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
          await client.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [userIds]);
          await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
        }
        if (adminRoleId || memberRoleId) {
          await client.query('DELETE FROM roles WHERE id = ANY($1::bigint[])', [[adminRoleId, memberRoleId].filter(Boolean)]);
        }
      });
    }
    await database.close();
  }
});
