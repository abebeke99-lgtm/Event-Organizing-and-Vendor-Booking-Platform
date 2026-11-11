import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { once } from 'node:events';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import {
  createPostgresRefundRequest,
  decidePostgresRefundRequest,
  processVerifiedPostgresProviderEvent,
} from '../src/lib/postgresPaymentManagement.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

async function removePaymentFixtures(database, suffix) {
  await database.runtimeAdapter.inTransaction(async (transaction) => {
    const organizerUsers = await transaction.query(
      'SELECT id FROM users WHERE email = $1',
      [`payment-organizer-${suffix}@example.invalid`],
    );
    const vendorUsers = await transaction.query(
      'SELECT id FROM users WHERE email = $1',
      [`payment-vendor-${suffix}@example.invalid`],
    );
    const categories = await transaction.query(
      'SELECT id FROM service_categories WHERE name = $1',
      [`Neon payment integration ${suffix}`],
    );
    const organizerIds = organizerUsers.rows.map((row) => row.id);
    const vendorUserIds = vendorUsers.rows.map((row) => row.id);
    const categoryIds = categories.rows.map((row) => row.id);
    const fixtures = await transaction.query(
      `SELECT DISTINCT e.id AS event_id, b.id AS booking_id, p.id AS payment_id, p.provider
       FROM events e
       LEFT JOIN bookings b ON b.event_id = e.id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE e.organizer_id = ANY($1::bigint[])`,
      [organizerIds],
    );
    const eventIds = [...new Set(fixtures.rows.map((row) => row.event_id))];
    const bookingIds = [...new Set(fixtures.rows.map((row) => row.booking_id).filter(Boolean))];
    const paymentIds = [...new Set(fixtures.rows.map((row) => row.payment_id).filter(Boolean))];
    const providerNames = [...new Set(fixtures.rows.map((row) => row.provider).filter(Boolean))];
    const vendors = await transaction.query(
      `SELECT id FROM vendor_profiles
       WHERE user_id = ANY($1::bigint[]) OR category_id = ANY($2::bigint[])`,
      [vendorUserIds, categoryIds],
    );
    const vendorIds = vendors.rows.map((row) => row.id);

    if (paymentIds.length) {
      await transaction.query('DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])', [organizerIds]);
      await transaction.query('DELETE FROM payment_history WHERE payment_id = ANY($1::bigint[])', [paymentIds]);
      await transaction.query('DELETE FROM refund_requests WHERE payment_id = ANY($1::bigint[])', [paymentIds]);
      await transaction.query('DELETE FROM payments WHERE id = ANY($1::bigint[])', [paymentIds]);
    }
    if (providerNames.length) {
      await transaction.query('DELETE FROM payment_provider_events WHERE provider = ANY($1::varchar[])', [providerNames]);
    }
    if (bookingIds.length) await transaction.query('DELETE FROM bookings WHERE id = ANY($1::bigint[])', [bookingIds]);
    if (eventIds.length) await transaction.query('DELETE FROM events WHERE id = ANY($1::bigint[])', [eventIds]);
    if (vendorIds.length) await transaction.query('DELETE FROM vendor_profiles WHERE id = ANY($1::bigint[])', [vendorIds]);
    if (categoryIds.length) await transaction.query('DELETE FROM service_categories WHERE id = ANY($1::bigint[])', [categoryIds]);
    const userIds = [...new Set([...organizerIds, ...vendorUserIds])];
    if (userIds.length) {
      await transaction.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
      await transaction.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [userIds]);
      await transaction.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
    }
  });
}

test('Neon PostgreSQL payment provider events persist atomically and deduplicate replays', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 90000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const environmentKeys = ['DB_DIALECT', 'DATABASE_URL', 'DIRECT_URL', 'DB_SSL', 'NODE_ENV'];
  const previousEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment, { DB_DIALECT: 'postgres' });
  const [{ createApp }, { pool: sharedPool }] = await Promise.all([
    import('../src/app.js'),
    import('../src/db.js'),
  ]);
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const provider = {
    name: `pg-${suffix.slice(0, 32)}`,
    verifyWebhook: async () => true,
  };
  let organizerId;
  let paymentId;
  let server;
  let failNextRefund = false;

  try {
    organizerId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Neon payment integration organizer', `payment-organizer-${suffix}@example.invalid`, 'integration-only'],
    )).rows[0].id;
    const vendorUserId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Neon payment integration vendor', `payment-vendor-${suffix}@example.invalid`, 'integration-only'],
    )).rows[0].id;
    const categoryId = (await database.runtimeAdapter.query(
      'INSERT INTO service_categories (name) VALUES ($1) RETURNING id',
      [`Neon payment integration ${suffix}`],
    )).rows[0].id;
    const vendorId = (await database.runtimeAdapter.query(
      `INSERT INTO vendor_profiles (user_id, business_name, category_id, verification_status)
       VALUES ($1, $2, $3, 'verified') RETURNING id`,
      [vendorUserId, `Neon payment vendor ${suffix}`, categoryId],
    )).rows[0].id;
    const eventId = (await database.runtimeAdapter.query(
      `INSERT INTO events (organizer_id, title, event_type, start_date)
       VALUES ($1, $2, 'Integration', CURRENT_TIMESTAMP + INTERVAL '1 day') RETURNING id`,
      [organizerId, `Neon payment event ${suffix}`],
    )).rows[0].id;
    const bookingId = (await database.runtimeAdapter.query(
      `INSERT INTO bookings (event_id, vendor_id, service_description, quoted_amount)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [eventId, vendorId, 'Neon payment integration booking', '20.00'],
    )).rows[0].id;
    paymentId = (await database.runtimeAdapter.query(
      `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status)
       VALUES ($1, $2, 'ETB', $3, $4, 'pending') RETURNING id`,
      [bookingId, '20.00', provider.name, `transaction-${suffix}`],
    )).rows[0].id;

    const paymentEvent = {
      eventId: `payment-success-${suffix}`,
      type: 'payment.succeeded',
      transactionReference: `transaction-${suffix}`,
      amount: '20.00',
      currency: 'ETB',
    };
    const app = createApp({
      database: database.runtimeAdapter,
      databaseDialect: 'postgres',
      paymentProvider: {
        ...provider,
        verifyWebhook: async ({ headers, rawBody }) => {
          const signature = headers['x-test-signature'];
          if (typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) return null;
          const expected = createHmac('sha256', `webhook-${suffix}`).update(rawBody).digest();
          const received = Buffer.from(signature, 'hex');
          if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
          return JSON.parse(rawBody.toString());
        },
        refundPayment: async () => {
          if (failNextRefund) {
            failNextRefund = false;
            throw new Error('Simulated provider timeout');
          }
          return { status: 'succeeded', refundReference: `admin-refund-${suffix}` };
        },
      },
    });
    const customerRole = await database.runtimeAdapter.query(
      "SELECT id FROM roles WHERE LOWER(name) = 'customer' AND is_active = TRUE LIMIT 1",
    );
    assert.ok(customerRole.rows[0], 'the customer role must exist');
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [organizerId, customerRole.rows[0].id],
    );
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [vendorUserId, customerRole.rows[0].id],
    );
    const adminRole = await database.runtimeAdapter.query(
      'SELECT id FROM roles WHERE is_admin = TRUE AND is_active = TRUE ORDER BY id LIMIT 1',
    );
    assert.ok(adminRole.rows[0], 'an active administrator role must exist');
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [organizerId, adminRole.rows[0].id],
    );
    const sessionToken = randomUUID();
    const otherCustomerToken = randomUUID();
    const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
    const otherCustomerTokenHash = createHash('sha256').update(otherCustomerToken).digest('hex');
    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES
         ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour'),
         ($3, $4, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
      [tokenHash, organizerId, otherCustomerTokenHash, vendorUserId],
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const sendWebhook = (event = paymentEvent, signatureMode = 'valid') => {
      const body = JSON.stringify(event);
      const signature = signatureMode === 'missing'
        ? null
        : signatureMode === 'invalid'
          ? '0'.repeat(64)
          : createHmac('sha256', `webhook-${suffix}`).update(body).digest('hex');
      return fetch(`${baseUrl}/api/payments/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Test-Signature': signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
    };
    assert.equal((await sendWebhook(paymentEvent, 'missing')).status, 401);
    assert.equal((await sendWebhook(paymentEvent, 'invalid')).status, 401);
    const firstDelivery = await sendWebhook();
    assert.equal(firstDelivery.status, 200);
    assert.deepEqual((await firstDelivery.json()).data, { duplicate: false, eventId: paymentEvent.eventId });
    const replay = await sendWebhook();
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json()).data, { duplicate: true, eventId: paymentEvent.eventId });
    const paid = await database.runtimeAdapter.query(
      'SELECT status, verified_at FROM payments WHERE id = $1',
      [paymentId],
    );
    assert.equal(paid.rows[0].status, 'paid');
    assert.ok(paid.rows[0].verified_at);
    const outOfOrderEvent = {
      ...paymentEvent,
      eventId: `payment-out-of-order-${suffix}`,
      type: 'payment.failed',
    };
    const outOfOrderWebhook = await sendWebhook(outOfOrderEvent);
    assert.equal(outOfOrderWebhook.status, 409);
    assert.equal((await database.runtimeAdapter.query(
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    )).rows[0].status, 'paid');

    const paymentList = await fetch(`${baseUrl}/api/customer/payments`, {
      headers: { Cookie: `platform_session=${sessionToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(paymentList.status, 200);
    assert.ok((await paymentList.json()).data.some((row) => row.id === Number(paymentId)));
    const customerPaymentDetail = await fetch(`${baseUrl}/api/customer/payments/${paymentId}`, {
      headers: { Cookie: `platform_session=${sessionToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(customerPaymentDetail.status, 200);
    assert.equal((await customerPaymentDetail.json()).data.payment.id, Number(paymentId));
    const otherCustomerPaymentDetail = await fetch(`${baseUrl}/api/customer/payments/${paymentId}`, {
      headers: { Cookie: `platform_session=${otherCustomerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(otherCustomerPaymentDetail.status, 404);
    const adminCookie = `platform_session=${sessionToken}`;
    const dateFilter = new Date().toISOString().slice(0, 10);
    const unauthenticatedAdminPayments = await fetch(`${baseUrl}/api/admin/payments`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(unauthenticatedAdminPayments.status, 401);
    const customerAdminPayments = await fetch(`${baseUrl}/api/admin/payments`, {
      headers: { Cookie: `platform_session=${otherCustomerToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(customerAdminPayments.status, 403);
    const paymentPage = await fetch(
      `${baseUrl}/api/admin/payments?page=1&pageSize=1&status=successful&dateFrom=${dateFilter}&dateTo=${dateFilter}&q=${encodeURIComponent(`transaction-${suffix}`)}`,
      { headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000) },
    );
    assert.equal(paymentPage.status, 200);
    const paymentPageBody = await paymentPage.json();
    assert.equal(paymentPageBody.pagination.total, 1);
    assert.equal(paymentPageBody.data[0].id, Number(paymentId));
    assert.equal(paymentPageBody.data[0].status, 'paid');
    const paymentDetail = await fetch(`${baseUrl}/api/admin/payments/${paymentId}`, {
      headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(paymentDetail.status, 200);
    assert.equal((await paymentDetail.json()).data.payment.id, Number(paymentId));
    const paymentExport = await fetch(
      `${baseUrl}/api/admin/payments/export?status=successful&dateFrom=${dateFilter}&dateTo=${dateFilter}`,
      { headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000) },
    );
    assert.equal(paymentExport.status, 200);
    assert.match(paymentExport.headers.get('content-type'), /text\/csv/);
    const paymentReport = await fetch(
      `${baseUrl}/api/admin/payments/report?dateFrom=${dateFilter}&dateTo=${dateFilter}`,
      { headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000) },
    );
    assert.equal(paymentReport.status, 200);

    const failedPaymentId = (await database.runtimeAdapter.query(
      `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status)
       VALUES ($1, $2, 'ETB', $3, $4, 'pending') RETURNING id`,
      [bookingId, '7.00', provider.name, `failed-transaction-${suffix}`],
    )).rows[0].id;
    const paymentFailedEvent = {
      eventId: `payment-failed-${suffix}`,
      type: 'payment.failed',
      transactionReference: `failed-transaction-${suffix}`,
      amount: '7.00',
      currency: 'ETB',
    };
    const failedPaymentWebhook = await sendWebhook(paymentFailedEvent);
    assert.equal(failedPaymentWebhook.status, 200);
    assert.deepEqual((await failedPaymentWebhook.json()).data, {
      duplicate: false,
      eventId: paymentFailedEvent.eventId,
    });
    const failedPayment = await database.runtimeAdapter.query(
      'SELECT status FROM payments WHERE id = $1',
      [failedPaymentId],
    );
    assert.equal(failedPayment.rows[0].status, 'failed');

    const invalidEventId = `payment-invalid-${suffix}`;
    await assert.rejects(
      processVerifiedPostgresProviderEvent(database.runtimeAdapter, provider, {
        ...paymentEvent,
        eventId: invalidEventId,
        amount: '19.99',
      }),
      (error) => error.status === 409,
    );
    const rolledBackEvent = await database.runtimeAdapter.query(
      'SELECT event_id FROM payment_provider_events WHERE provider = $1 AND event_id = $2',
      [provider.name, invalidEventId],
    );
    assert.equal(rolledBackEvent.rowCount, 0);

    const refundRequestBody = {
      amount: '5.00',
      reason: 'Integration refund request',
      idempotencyKey: randomUUID(),
    };
    const otherCustomerRefundRequest = await fetch(`${baseUrl}/api/customer/payments/${paymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `platform_session=${otherCustomerToken}` },
      body: JSON.stringify(refundRequestBody),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(otherCustomerRefundRequest.status, 404);
    const refundRequestResponse = await fetch(`${baseUrl}/api/customer/payments/${paymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `platform_session=${sessionToken}` },
      body: JSON.stringify(refundRequestBody),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(refundRequestResponse.status, 201);
    const requestedRefund = (await refundRequestResponse.json()).data;
    assert.deepEqual(requestedRefund, { id: requestedRefund.id, status: 'pending', duplicate: false });
    const duplicateRefundResponse = await fetch(`${baseUrl}/api/customer/payments/${paymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `platform_session=${sessionToken}` },
      body: JSON.stringify(refundRequestBody),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(duplicateRefundResponse.status, 200);
    assert.equal((await duplicateRefundResponse.json()).data.duplicate, true);
    const refundList = await fetch(`${baseUrl}/api/customer/refunds`, {
      headers: { Cookie: `platform_session=${sessionToken}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(refundList.status, 200);
    assert.ok((await refundList.json()).data.some((row) => row.id === requestedRefund.id));
    const adminRefundList = await fetch(
      `${baseUrl}/api/admin/refunds?page=1&pageSize=1&status=pending&dateFrom=${dateFilter}&dateTo=${dateFilter}`,
      { headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000) },
    );
    assert.equal(adminRefundList.status, 200);
    const adminRefundListBody = await adminRefundList.json();
    assert.equal(adminRefundListBody.pagination.total, 1);
    assert.equal(adminRefundListBody.data[0].id, requestedRefund.id);
    const refundDetail = await fetch(`${baseUrl}/api/admin/refunds/${requestedRefund.id}`, {
      headers: { Cookie: adminCookie },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(refundDetail.status, 200);
    assert.equal((await refundDetail.json()).data.refund.id, requestedRefund.id);
    const refundExport = await fetch(
      `${baseUrl}/api/admin/refunds/export?status=pending&dateFrom=${dateFilter}&dateTo=${dateFilter}`,
      { headers: { Cookie: adminCookie }, signal: AbortSignal.timeout(15000) },
    );
    assert.equal(refundExport.status, 200);
    assert.match(refundExport.headers.get('content-type'), /text\/csv/);

    const refundRequest = {
      paymentId,
      requesterId: organizerId,
      ...refundRequestBody,
      ip: '127.0.0.1',
    };
    assert.deepEqual(
      await createPostgresRefundRequest(database.runtimeAdapter, refundRequest),
      { id: requestedRefund.id, status: 'pending', duplicate: true },
    );
    const concurrentRequests = await Promise.allSettled([
      createPostgresRefundRequest(database.runtimeAdapter, {
        ...refundRequest,
        amount: '10.00',
        reason: 'Concurrent refund request A',
        idempotencyKey: randomUUID(),
      }),
      createPostgresRefundRequest(database.runtimeAdapter, {
        ...refundRequest,
        amount: '10.00',
        reason: 'Concurrent refund request B',
        idempotencyKey: randomUUID(),
      }),
    ]);
    const concurrentWinners = concurrentRequests.filter((result) => result.status === 'fulfilled');
    const concurrentRejections = concurrentRequests.filter((result) => result.status === 'rejected');
    assert.equal(concurrentWinners.length, 1);
    assert.equal(concurrentRejections.length, 1);
    const concurrentRejection = concurrentRejections[0].reason;
    assert.equal(
      concurrentRejection.status,
      409,
      `Unexpected concurrent refund rejection: status=${concurrentRejection.status || 'none'}, code=${concurrentRejection.code || 'none'}, name=${concurrentRejection.name || 'unknown'}`,
    );
    const reservedTotal = await database.runtimeAdapter.query(
      `SELECT COALESCE(SUM(amount), 0) AS reserved FROM refund_requests
       WHERE payment_id = $1 AND status IN ('pending', 'processing', 'succeeded')`,
      [paymentId],
    );
    assert.equal(Number(reservedTotal.rows[0].reserved), 15);
    await assert.rejects(
      createPostgresRefundRequest(database.runtimeAdapter, { ...refundRequest, amount: '6.00' }),
      (error) => error.status === 409,
    );
    await assert.rejects(
      createPostgresRefundRequest(database.runtimeAdapter, { ...refundRequest, idempotencyKey: `over-${suffix}`, amount: '16.00' }),
      (error) => error.status === 409,
    );
    const approvalResponse = await fetch(`${baseUrl}/api/admin/refunds/${requestedRefund.id}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ decision: 'approved' }),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(approvalResponse.status, 200);
    assert.deepEqual((await approvalResponse.json()).data, {
      id: requestedRefund.id, status: 'succeeded', paymentStatus: 'partially_refunded',
    });
    const releaseConcurrentRefund = await fetch(
      `${baseUrl}/api/admin/refunds/${concurrentWinners[0].value.id}/decision`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'Concurrent request released' }),
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.equal(releaseConcurrentRefund.status, 200);

    const rejectedRequest = await createPostgresRefundRequest(database.runtimeAdapter, {
      ...refundRequest,
      amount: '1.00',
      reason: 'Second integration request',
      idempotencyKey: `reject-${suffix}`,
    });
    const rejectResponse = await fetch(`${baseUrl}/api/admin/refunds/${rejectedRequest.id}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ decision: 'rejected', reason: 'Request not eligible' }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(rejectResponse.status, 200);
    assert.deepEqual((await rejectResponse.json()).data, { id: rejectedRequest.id, status: 'rejected' });

    const refundKey = `refund-${suffix}`;
    const webhookRefundId = (await database.runtimeAdapter.query(
      `INSERT INTO refund_requests
         (payment_id, requester_id, amount, currency, reason, status, idempotency_key)
       VALUES ($1, $2, $3, 'ETB', $4, 'processing', $5) RETURNING id`,
      [paymentId, organizerId, '5.00', 'Integration refund', refundKey],
    )).rows[0].id;
    const refundEvent = {
      eventId: `refund-success-${suffix}`,
      type: 'refund.succeeded',
      transactionReference: `transaction-${suffix}`,
      amount: '5.00',
      currency: 'ETB',
      refundIdempotencyKey: refundKey,
      refundReference: `provider-refund-${suffix}`,
    };
    const refundWebhook = await sendWebhook(refundEvent);
    assert.equal(refundWebhook.status, 200);
    assert.deepEqual((await refundWebhook.json()).data, { duplicate: false, eventId: refundEvent.eventId });
    const duplicateRefundWebhook = await sendWebhook(refundEvent);
    assert.equal(duplicateRefundWebhook.status, 200);
    assert.deepEqual((await duplicateRefundWebhook.json()).data, {
      duplicate: true,
      eventId: refundEvent.eventId,
    });
    const refunded = await database.runtimeAdapter.query(
      `SELECT r.status AS refund_status, r.provider_refund_reference,
              p.status AS payment_status,
              (SELECT COUNT(*)::integer FROM payment_history WHERE payment_id = p.id) AS history_count
            FROM refund_requests r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`,
                [webhookRefundId],
    );
    assert.equal(refunded.rows[0].refund_status, 'succeeded');
    assert.equal(refunded.rows[0].provider_refund_reference, `provider-refund-${suffix}`);
    assert.equal(refunded.rows[0].payment_status, 'partially_refunded');
    assert.equal(refunded.rows[0].history_count, 11);

    await database.runtimeAdapter.query(
      "UPDATE payments SET status = 'refund_pending' WHERE id = $1",
      [paymentId],
    );
    const failedRefundKey = `failed-refund-${suffix}`;
    const failedRefundId = (await database.runtimeAdapter.query(
      `INSERT INTO refund_requests
         (payment_id, requester_id, amount, currency, reason, status, idempotency_key)
       VALUES ($1, $2, $3, 'ETB', $4, 'processing', $5) RETURNING id`,
      [paymentId, organizerId, '2.00', 'Integration refund failure', failedRefundKey],
    )).rows[0].id;
    const refundFailedEvent = {
      eventId: `refund-failed-${suffix}`,
      type: 'refund.failed',
      transactionReference: `transaction-${suffix}`,
      amount: '2.00',
      currency: 'ETB',
      refundIdempotencyKey: failedRefundKey,
    };
    const failedRefundWebhook = await sendWebhook(refundFailedEvent);
    assert.equal(failedRefundWebhook.status, 200);
    assert.deepEqual((await failedRefundWebhook.json()).data, {
      duplicate: false,
      eventId: refundFailedEvent.eventId,
    });
    const failedRefund = await database.runtimeAdapter.query(
      `SELECT r.status AS refund_status, p.status AS payment_status,
              (SELECT COUNT(*)::integer FROM payment_history WHERE payment_id = p.id) AS history_count
       FROM refund_requests r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`,
      [failedRefundId],
    );
    assert.equal(failedRefund.rows[0].refund_status, 'failed');
    assert.equal(failedRefund.rows[0].payment_status, 'partially_refunded');
    assert.equal(failedRefund.rows[0].history_count, 13);

    const retryRefund = await createPostgresRefundRequest(database.runtimeAdapter, {
      paymentId,
      requesterId: organizerId,
      amount: '1.00',
      reason: 'Provider retry integration',
      idempotencyKey: `provider-retry-${suffix}`,
      ip: '127.0.0.1',
    });
    failNextRefund = true;
    const providerTimeout = await fetch(`${baseUrl}/api/admin/refunds/${retryRefund.id}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ decision: 'approved' }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(providerTimeout.status, 502);
    const processingAfterTimeout = await database.runtimeAdapter.query(
      `SELECT r.status AS refund_status, p.status AS payment_status
       FROM refund_requests r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`,
      [retryRefund.id],
    );
    assert.equal(processingAfterTimeout.rows[0].refund_status, 'processing');
    assert.equal(processingAfterTimeout.rows[0].payment_status, 'partially_refunded');
    const retryResponse = await fetch(`${baseUrl}/api/admin/refunds/${retryRefund.id}/decision`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ decision: 'approved' }),
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(retryResponse.status, 200);
    assert.deepEqual((await retryResponse.json()).data, {
      id: retryRefund.id, status: 'succeeded', paymentStatus: 'partially_refunded',
    });

    await assert.rejects(
      database.runtimeAdapter.query(
        `INSERT INTO payment_history (payment_id, action, details)
         VALUES ($1, 'integration.invalid_foreign_key', '{}'::jsonb)`,
        ['9223372036854775807'],
      ),
      (error) => error.code === '23503',
    );
  } finally {
    try {
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
    } finally {
      try {
        await removePaymentFixtures(database, suffix);
      } finally {
        try {
          await database.close();
        } finally {
          try {
            await sharedPool.end();
          } finally {
            for (const key of environmentKeys) {
              if (previousEnvironment[key] === undefined) delete process.env[key];
              else process.env[key] = previousEnvironment[key];
            }
          }
        }
      }
    }
  }
});