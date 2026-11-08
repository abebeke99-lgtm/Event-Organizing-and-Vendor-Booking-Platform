import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL booking, quotation, and availability workflows persist and enforce access/conflicts', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
  timeout: 120000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const organizerEmail = `pg-booking-organizer-${suffix}@example.invalid`;
  const vendorEmail = `pg-booking-vendor-${suffix}@example.invalid`;
  const token = randomUUID() + randomUUID();
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  let organizerId;
  let vendorUserId;
  let vendorId;
  let categoryId;
  let serviceId;
  const eventIds = [];
  const bookingIds = [];
  const quoteIds = [];

  const cleanup = async () => {
    const relatedIds = [...bookingIds, ...quoteIds].map(String);
    if (relatedIds.length) {
      const notifications = await database.runtimeAdapter.query(
        `SELECT id FROM notifications
         WHERE related_entity_id = ANY($1::varchar[])`,
        [relatedIds],
      );
      if (notifications.rowCount) {
        await database.runtimeAdapter.query(
          'DELETE FROM notification_history WHERE notification_id = ANY($1::bigint[])',
          [notifications.rows.map((row) => row.id)],
        );
        await database.runtimeAdapter.query(
          'DELETE FROM notifications WHERE id = ANY($1::bigint[])',
          [notifications.rows.map((row) => row.id)],
        );
      }
    }
    if (organizerId || vendorUserId) {
      await database.runtimeAdapter.query(
        `DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])
           OR (entity_type IN ('booking', 'quotation') AND entity_id = ANY($2::varchar[]))`,
        [[organizerId, vendorUserId].filter(Boolean), relatedIds],
      );
    }
    if (bookingIds.length) {
      await database.runtimeAdapter.query('DELETE FROM booking_history WHERE booking_id = ANY($1::bigint[])', [bookingIds]);
      await database.runtimeAdapter.query('DELETE FROM bookings WHERE id = ANY($1::bigint[])', [bookingIds]);
    }
    if (quoteIds.length) await database.runtimeAdapter.query('DELETE FROM quotations WHERE id = ANY($1::bigint[])', [quoteIds]);
    if (vendorId) await database.runtimeAdapter.query('DELETE FROM vendor_availability WHERE vendor_id = $1', [vendorId]);
    if (eventIds.length) await database.runtimeAdapter.query('DELETE FROM events WHERE id = ANY($1::bigint[])', [eventIds]);
    if (serviceId) await database.runtimeAdapter.query('DELETE FROM services WHERE id = $1', [serviceId]);
    if (vendorId) await database.runtimeAdapter.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
    const userIds = [organizerId, vendorUserId].filter(Boolean);
    if (userIds.length) {
      await database.runtimeAdapter.query('DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])', [userIds]);
      await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [userIds]);
      await database.runtimeAdapter.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
    }
    if (categoryId) await database.runtimeAdapter.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
  };

  try {
    await once(server, 'listening');
    const organizerRole = (await database.runtimeAdapter.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'organizer' AND is_active = TRUE LIMIT 1`,
    )).rows[0];
    const vendorRole = (await database.runtimeAdapter.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'vendor' AND is_active = TRUE LIMIT 1`,
    )).rows[0];
    assert.ok(organizerRole && vendorRole, 'seeded organizer and vendor roles must exist');

    organizerId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon booking organizer', organizerEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    vendorUserId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon booking vendor', vendorEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)',
      [organizerId, organizerRole.id, vendorUserId, vendorRole.id],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour'), ($3, $4, NOW() + INTERVAL '1 hour')`,
      [hashToken(token), organizerId, hashToken(`${token}-vendor`), vendorUserId],
    );
    categoryId = (await database.runtimeAdapter.query(
      `INSERT INTO service_categories (name) VALUES ($1) RETURNING id`,
      [`Neon booking category ${suffix}`],
    )).rows[0].id;
    vendorId = (await database.runtimeAdapter.query(
      `INSERT INTO vendor_profiles (user_id, business_name, category_id, verification_status)
       VALUES ($1, $2, $3, 'verified') RETURNING id`,
      [vendorUserId, `Neon booking vendor ${suffix}`, categoryId],
    )).rows[0].id;
    serviceId = (await database.runtimeAdapter.query(
      `INSERT INTO services (vendor_id, category_id, title, price, currency, status)
       VALUES ($1, $2, $3, 1250, 'ETB', 'active') RETURNING id`,
      [vendorId, categoryId, `Neon booking service ${suffix}`],
    )).rows[0].id;
    const startDate = new Date(Date.now() + 10 * 86400000).toISOString();
    for (const title of ['Neon booking event A', 'Neon booking event B']) {
      eventIds.push((await database.runtimeAdapter.query(
        `INSERT INTO events (organizer_id, title, event_type, start_date, status)
         VALUES ($1, $2, 'Integration', $3, 'active') RETURNING id`,
        [organizerId, `${title} ${suffix}`, startDate],
      )).rows[0].id);
    }

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookie = (value) => `platform_session=${value}`;
    const request = (path, sessionToken, options = {}) => fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: cookie(sessionToken),
        ...options.headers,
      },
      signal: AbortSignal.timeout(20000),
    });

    const created = await request('/api/platform/bookings', token, {
      method: 'POST',
      body: JSON.stringify({ eventId: eventIds[0], serviceId }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    const firstBookingId = createdBody.data.id;
    bookingIds.push(firstBookingId);
    assert.equal(createdBody.data.status, 'requested');

    const customerList = await request('/api/customer/bookings', token);
    assert.equal(customerList.status, 200);
    assert.equal((await customerList.json()).data.some((row) => row.id === firstBookingId), true);
    const vendorCustomerList = await request('/api/customer/bookings', `${token}-vendor`);
    assert.equal(vendorCustomerList.status, 403);
    const anonymousCustomerList = await fetch(`${baseUrl}/api/customer/bookings`);
    assert.equal(anonymousCustomerList.status, 401);
    const vendorRequests = await request('/api/vendor/booking-requests', `${token}-vendor`);
    assert.equal(vendorRequests.status, 200);
    assert.equal((await vendorRequests.json()).data.some((row) => row.id === firstBookingId), true);

    const duplicate = await request('/api/platform/bookings', token, {
      method: 'POST',
      body: JSON.stringify({ eventId: eventIds[0], serviceId }),
    });
    assert.equal(duplicate.status, 409);

    const second = await request('/api/platform/bookings', token, {
      method: 'POST',
      body: JSON.stringify({ eventId: eventIds[1], serviceId }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 201, JSON.stringify(secondBody));
    const secondBookingId = secondBody.data.id;
    bookingIds.push(secondBookingId);

    const accept = (id) => request(`/api/platform/bookings/${id}/status`, `${token}-vendor`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
    });
    const concurrentAccepts = await Promise.all([accept(firstBookingId), accept(secondBookingId)]);
    const statuses = await Promise.all(concurrentAccepts.map(async (response) => ({
      status: response.status, body: await response.json(),
    })));
    assert.deepEqual(statuses.map((item) => item.status).sort(), [200, 409]);
    const persistedBookings = await database.runtimeAdapter.query(
      'SELECT id, status FROM bookings WHERE id = ANY($1::bigint[]) ORDER BY id',
      [bookingIds],
    );
    assert.equal(persistedBookings.rows.filter((row) => row.status === 'accepted').length, 1);
    const bookingHistory = await database.runtimeAdapter.query(
      'SELECT action FROM booking_history WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    assert.equal(bookingHistory.rowCount, 3, 'both requests are recorded and only the accepted transition commits');
    const bookingNotifications = await database.runtimeAdapter.query(
      `SELECT n.id, h.id AS history_id FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_id = ANY($1::varchar[]) AND n.notification_type = 'booking'`,
      [bookingIds.map(String)],
    );
    assert.equal(bookingNotifications.rowCount, 3);
    assert.ok(bookingNotifications.rows.every((row) => row.history_id));
    const reservedDate = await database.runtimeAdapter.query(
      `SELECT status, note FROM vendor_availability WHERE vendor_id = $1 AND status = 'booked'`,
      [vendorId],
    );
    assert.equal(reservedDate.rowCount, 1);
    assert.match(reservedDate.rows[0].note, /^Booking #\d+$/);
    const acceptedBooking = persistedBookings.rows.find((row) => row.status === 'accepted');
    const cancellation = await request(`/api/platform/bookings/${acceptedBooking.id}/status`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: 'Integration cancellation' }),
    });
    assert.equal(cancellation.status, 200);
    const releasedDate = await database.runtimeAdapter.query(
      `SELECT status, note FROM vendor_availability WHERE vendor_id = $1 AND status = 'available'`,
      [vendorId],
    );
    assert.equal(releasedDate.rowCount, 1);
    assert.equal(releasedDate.rows[0].note, null);
    const historyAfterCancellation = await database.runtimeAdapter.query(
      'SELECT action FROM booking_history WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    assert.equal(historyAfterCancellation.rowCount, 4);
    const notificationsAfterCancellation = await database.runtimeAdapter.query(
      `SELECT n.id, h.id AS history_id FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_id = ANY($1::varchar[]) AND n.notification_type = 'booking'`,
      [bookingIds.map(String)],
    );
    assert.equal(notificationsAfterCancellation.rowCount, 4);
    assert.ok(notificationsAfterCancellation.rows.every((row) => row.history_id));

    const availableDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const availability = await request('/api/vendor/availability', `${token}-vendor`, {
      method: 'POST', body: JSON.stringify({ date: availableDate, status: 'available', note: 'integration' }),
    });
    assert.equal(availability.status, 201);
    const availabilityUpdate = await request(`/api/vendor/availability/${availableDate}`, `${token}-vendor`, {
      method: 'PATCH', body: JSON.stringify({ status: 'blocked', note: 'test block' }),
    });
    assert.equal(availabilityUpdate.status, 200);
    const availabilityDelete = await request(`/api/vendor/availability/${availableDate}`, `${token}-vendor`, {
      method: 'DELETE',
    });
    assert.equal(availabilityDelete.status, 204);

    const quoteRequest = await request('/api/platform/service-quote-requests', token, {
      method: 'POST',
      body: JSON.stringify({
        serviceId, eventId: eventIds[0], eventDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 16),
        eventLocation: 'Test location', eventType: 'Integration', contactPhone: '+251911123456',
        requestKey: randomUUID(), message: 'Neon quotation workflow',
      }),
    });
    const quoteBody = await quoteRequest.json();
    assert.equal(quoteRequest.status, 201, JSON.stringify(quoteBody));
    const quoteId = quoteBody.data.id;
    quoteIds.push(quoteId);
    const vendorQuoteList = await request('/api/vendor/quotations', `${token}-vendor`);
    assert.equal(vendorQuoteList.status, 200);
    assert.equal((await vendorQuoteList.json()).data.some((row) => row.id === quoteId), true);

    const response = await request(`/api/platform/quotations/${quoteId}/respond`, `${token}-vendor`, {
      method: 'PATCH', body: JSON.stringify({ status: 'sent', amount: 1400, validUntil: availableDate }),
    });
    assert.equal(response.status, 200);
    const organizerQuoteList = await request('/api/platform/organizer/quotations', token);
    assert.equal(organizerQuoteList.status, 200);
    assert.equal((await organizerQuoteList.json()).data.find((row) => row.id === quoteId)?.eventTitle, `Neon booking event A ${suffix}`);
    const revision = await request(`/api/platform/organizer/quotations/${quoteId}/decision`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'revision_requested', reason: 'Please adjust schedule' }),
    });
    assert.equal(revision.status, 200);
    const revisedResponse = await request(`/api/platform/quotations/${quoteId}/respond`, `${token}-vendor`, {
      method: 'PATCH', body: JSON.stringify({ status: 'sent', amount: 1400, validUntil: availableDate }),
    });
    assert.equal(revisedResponse.status, 200);
    const customerQuotes = await request('/api/customer/quotations', token);
    assert.equal(customerQuotes.status, 200);
    assert.equal((await customerQuotes.json()).data.find((row) => row.id === quoteId)?.status, 'sent');
    const decision = await request(`/api/customer/quotations/${quoteId}/decision`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'accepted' }),
    });
    assert.equal(decision.status, 200);
    assert.equal((await database.runtimeAdapter.query(
      'SELECT status, amount, currency FROM quotations WHERE id = $1',
      [quoteId],
    )).rows[0].status, 'accepted');
    const persistedQuote = (await database.runtimeAdapter.query(
      'SELECT vendor_id, customer_id, event_id, service_id, amount, currency FROM quotations WHERE id = $1',
      [quoteId],
    )).rows[0];
    assert.equal(Number(persistedQuote.vendor_id), Number(vendorId));
    assert.equal(Number(persistedQuote.customer_id), Number(organizerId));
    assert.equal(Number(persistedQuote.event_id), Number(eventIds[0]));
    assert.equal(Number(persistedQuote.service_id), Number(serviceId));
    assert.equal(Number(persistedQuote.amount), 1400);
    assert.equal(persistedQuote.currency.trim(), 'ETB');
    const quoteNotifications = await database.runtimeAdapter.query(
      `SELECT n.id, h.id AS history_id FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_id = $1 AND n.notification_type IN ('quotation', 'booking')`,
      [String(quoteId)],
    );
    assert.equal(quoteNotifications.rowCount, 5);
    assert.ok(quoteNotifications.rows.every((row) => row.history_id));

    console.log('Neon booking/quotation/availability integration passed: persisted booking creation, duplicate prevention, concurrent vendor acceptance conflict, availability CRUD, quote response/decision, authorization, history/notifications.');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    try {
      await cleanup();
    } finally {
      await database.close();
    }
  }
});
