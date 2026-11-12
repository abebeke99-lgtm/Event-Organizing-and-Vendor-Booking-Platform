import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

async function cleanup(database, ids) {
  const { paymentId, refundId, historyId, eventId, bookingId, categoryId, organizerId, otherUserId, vendorUserId, vendorId } = ids;
  const deleteById = async (table, id) => {
    if (id !== null) await database.runtimeAdapter.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  };
  await deleteById('payment_history', historyId);
  await deleteById('refund_requests', refundId);
  await deleteById('payments', paymentId);
  await deleteById('bookings', bookingId);
  await deleteById('events', eventId);
  await deleteById('vendor_profiles', vendorId);
  await deleteById('service_categories', categoryId);
  const userIds = [organizerId, otherUserId, vendorUserId].filter((id) => id !== null);
  if (!userIds.length) return;
  await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
  await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [userIds]);
  await database.runtimeAdapter.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
}

test('Neon PostgreSQL customer payment detail endpoint enforces ownership and returns only authorized records', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const ownerToken = randomUUID();
  const otherToken = randomUUID();
  const ids = { paymentId: null, refundId: null, historyId: null, eventId: null, bookingId: null, categoryId: null, organizerId: null, otherUserId: null, vendorUserId: null, vendorId: null };
  let server;

  try {
    const organizerRoleResult = await database.runtimeAdapter.query(
      "SELECT id FROM roles WHERE LOWER(name) = 'organizer' AND is_active = TRUE LIMIT 1",
    );
    const customerRoleResult = await database.runtimeAdapter.query(
      "SELECT id FROM roles WHERE LOWER(name) = 'customer' AND is_active = TRUE LIMIT 1",
    );
    const vendorRoleResult = await database.runtimeAdapter.query(
      "SELECT id FROM roles WHERE LOWER(name) = 'vendor' AND is_active = TRUE LIMIT 1",
    );
    assert.ok(organizerRoleResult.rows[0], 'The organizer role must exist for this integration test.');
    assert.ok(customerRoleResult.rows[0], 'The customer role must exist for this integration test.');
    assert.ok(vendorRoleResult.rows[0], 'The vendor role must exist for this integration test.');

    const organizerUser = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, phone, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [`Owner ${suffix}`, `customer-payment-owner-${suffix}@example.invalid`, '+15550000001', 'integration-only'],
    );
    const otherUser = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, phone, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [`Other ${suffix}`, `customer-payment-other-${suffix}@example.invalid`, '+15550000002', 'integration-only'],
    );
    const vendorUser = await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, phone, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [`Vendor ${suffix}`, `customer-payment-vendor-${suffix}@example.invalid`, '+15550000003', 'integration-only'],
    );
    ids.organizerId = organizerUser.rows[0].id;
    ids.otherUserId = otherUser.rows[0].id;
    ids.vendorUserId = vendorUser.rows[0].id;

    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($1, $3)',
      [ids.organizerId, organizerRoleResult.rows[0].id, customerRoleResult.rows[0].id],
    );
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [ids.otherUserId, customerRoleResult.rows[0].id],
    );
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [ids.vendorUserId, vendorRoleResult.rows[0].id],
    );

    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour'), ($3, $4, NOW() + INTERVAL '1 hour')`,
      [hashToken(ownerToken), ids.organizerId, hashToken(otherToken), ids.otherUserId],
    );

    const categoryId = await database.runtimeAdapter.query(
      'INSERT INTO service_categories (name, description, is_active) VALUES ($1, $2, TRUE) RETURNING id',
      [`Customer payment detail ${suffix}`, 'Customer payment detail category'],
    );
    ids.categoryId = categoryId.rows[0].id;
    const vendorProfile = await database.runtimeAdapter.query(
      `INSERT INTO vendor_profiles (user_id, business_name, category_id, verification_status)
       VALUES ($1, $2, $3, 'verified') RETURNING id`,
      [ids.vendorUserId, `Vendor ${suffix}`, ids.categoryId],
    );
    ids.vendorId = vendorProfile.rows[0].id;

    const eventResult = await database.runtimeAdapter.query(
      `INSERT INTO events (organizer_id, title, event_type, start_date, status, city)
       VALUES ($1, $2, 'Wedding', NOW() + INTERVAL '2 days', 'upcoming', 'Addis Ababa') RETURNING id`,
      [ids.organizerId, `Customer payment detail event ${suffix}`],
    );
    ids.eventId = eventResult.rows[0].id;

    const bookingResult = await database.runtimeAdapter.query(
      `INSERT INTO bookings (event_id, vendor_id, service_description, quoted_amount, currency, status)
       VALUES ($1, $2, $3, $4, 'ETB', 'accepted') RETURNING id`,
      [ids.eventId, ids.vendorId, `Customer payment detail booking ${suffix}`, '120.00'],
    );
    ids.bookingId = bookingResult.rows[0].id;

    const paymentResult = await database.runtimeAdapter.query(
      `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status)
       VALUES ($1, $2, 'ETB', 'integration', $3, 'paid') RETURNING id`,
      [ids.bookingId, '120.00', `payment-detail-${suffix}`],
    );
    ids.paymentId = paymentResult.rows[0].id;

    const refundResult = await database.runtimeAdapter.query(
      `INSERT INTO refund_requests (payment_id, requester_id, amount, currency, reason, status, idempotency_key)
       VALUES ($1, $2, $3, 'ETB', $4, 'pending', $5) RETURNING id`,
      [ids.paymentId, ids.organizerId, '10.00', 'Refund needed for testing', `refund-detail-${suffix}`],
    );
    ids.refundId = refundResult.rows[0].id;

    const historyResult = await database.runtimeAdapter.query(
      `INSERT INTO payment_history (payment_id, refund_id, actor_id, action, from_status, to_status, details)
       VALUES ($1, $2, $3, 'refund.requested', 'paid', 'pending', $4) RETURNING id`,
      [ids.paymentId, ids.refundId, ids.organizerId, JSON.stringify({ refundId: ids.refundId })],
    );
    ids.historyId = historyResult.rows[0].id;

    const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const authorized = await fetch(`${baseUrl}/api/customer/payments/${ids.paymentId}`, {
      headers: { Cookie: `platform_session=${ownerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(authorized.status, 200, 'Authorized customer payment details should return 200.');
    const authorizedBody = await authorized.json();
    assert.equal(authorizedBody.data.payment.id, Number(ids.paymentId));
    assert.ok(authorizedBody.data.refunds.some((row) => Number(row.id) === Number(ids.refundId)));
    assert.ok(authorizedBody.data.history.some((row) => Number(row.id) === Number(ids.historyId)));

    const foreign = await fetch(`${baseUrl}/api/customer/payments/${ids.paymentId}`, {
      headers: { Cookie: `platform_session=${otherToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(foreign.status, 404, 'A foreign payment detail request must return 404.');

    const missing = await fetch(`${baseUrl}/api/customer/payments/999999999`, {
      headers: { Cookie: `platform_session=${ownerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(missing.status, 404, 'Missing payment detail requests should return 404.');

    const invalid = await fetch(`${baseUrl}/api/customer/payments/not-a-number`, {
      headers: { Cookie: `platform_session=${ownerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(invalid.status, 400, 'Invalid payment IDs should be rejected.');

    const unauthenticated = await fetch(`${baseUrl}/api/customer/payments/${ids.paymentId}`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(unauthenticated.status, 401, 'Unauthenticated payment requests must be rejected.');

    const persisted = await database.runtimeAdapter.query(
      'SELECT id, booking_id, amount, currency, status FROM payments WHERE id = $1',
      [ids.paymentId],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(Number(persisted.rows[0].booking_id), Number(ids.bookingId));
    assert.equal(persisted.rows[0].status, 'paid');
  } finally {
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    if (database) {
      await cleanup(database, ids);
      await database.close();
    }
  }
});
