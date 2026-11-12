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
  timeout: 180000,
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const organizerEmail = `pg-booking-organizer-${suffix}@example.invalid`;
  const customerEmail = `pg-booking-customer-${suffix}@example.invalid`;
  const vendorEmail = `pg-booking-vendor-${suffix}@example.invalid`;
  const token = randomUUID() + randomUUID();
  const customerToken = randomUUID() + randomUUID();
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  let organizerId;
  let customerId;
  let vendorUserId;
  let vendorId;
  let categoryId;
  let serviceId;
  const eventIds = [];
  const bookingIds = [];
  const quoteIds = [];
  const budgetCategoryIds = [];
  const expenseIds = [];
  const taskIds = [];
  const complaintIds = [];
  let customerEventId;
  let customerBookingId;
  let customerPaymentId;
  let customerRefundId;
  let foreignPaymentId;

  const cleanup = async () => {
    const allBookingIds = [...bookingIds, customerBookingId].filter(Boolean);
    const relatedIds = [...allBookingIds, ...quoteIds, ...eventIds, ...complaintIds, customerEventId].filter(Boolean).map(String);
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
           OR (entity_type IN ('booking', 'quotation', 'complaint') AND entity_id = ANY($2::varchar[]))`,
        [[organizerId, customerId, vendorUserId].filter(Boolean), relatedIds],
      );
    }
    if (complaintIds.length) {
      await database.runtimeAdapter.query(
        'DELETE FROM complaint_attachments WHERE complaint_id = ANY($1::bigint[])',
        [complaintIds],
      );
      await database.runtimeAdapter.query(
        'DELETE FROM complaint_history WHERE complaint_id = ANY($1::bigint[])',
        [complaintIds],
      );
      await database.runtimeAdapter.query('DELETE FROM complaints WHERE id = ANY($1::bigint[])', [complaintIds]);
    }
    if (customerPaymentId) {
      await database.runtimeAdapter.query('DELETE FROM refund_requests WHERE payment_id = $1', [customerPaymentId]);
      await database.runtimeAdapter.query('DELETE FROM payment_history WHERE payment_id = $1', [customerPaymentId]);
      await database.runtimeAdapter.query('DELETE FROM payments WHERE id = $1', [customerPaymentId]);
    }
    if (foreignPaymentId) {
      await database.runtimeAdapter.query('DELETE FROM refund_requests WHERE payment_id = $1', [foreignPaymentId]);
      await database.runtimeAdapter.query('DELETE FROM payment_history WHERE payment_id = $1', [foreignPaymentId]);
      await database.runtimeAdapter.query('DELETE FROM payments WHERE id = $1', [foreignPaymentId]);
    }
    if (allBookingIds.length) {
      await database.runtimeAdapter.query('DELETE FROM messages WHERE booking_id = ANY($1::bigint[])', [allBookingIds]);
      await database.runtimeAdapter.query(
        `DELETE FROM review_history WHERE review_id IN
         (SELECT id FROM reviews WHERE booking_id = ANY($1::bigint[]))`,
        [allBookingIds],
      );
      await database.runtimeAdapter.query('DELETE FROM reviews WHERE booking_id = ANY($1::bigint[])', [allBookingIds]);
      await database.runtimeAdapter.query('DELETE FROM booking_history WHERE booking_id = ANY($1::bigint[])', [allBookingIds]);
    }
    if (taskIds.length) await database.runtimeAdapter.query('DELETE FROM event_vendor_tasks WHERE id = ANY($1::bigint[])', [taskIds]);
    if (expenseIds.length) await database.runtimeAdapter.query('DELETE FROM event_expenses WHERE id = ANY($1::bigint[])', [expenseIds]);
    if (budgetCategoryIds.length) {
      await database.runtimeAdapter.query('DELETE FROM event_budget_categories WHERE id = ANY($1::bigint[])', [budgetCategoryIds]);
    }
    if (allBookingIds.length) await database.runtimeAdapter.query('DELETE FROM bookings WHERE id = ANY($1::bigint[])', [allBookingIds]);
    if (quoteIds.length) await database.runtimeAdapter.query('DELETE FROM quotations WHERE id = ANY($1::bigint[])', [quoteIds]);
    if (vendorId) await database.runtimeAdapter.query('DELETE FROM vendor_availability WHERE vendor_id = $1', [vendorId]);
    if (eventIds.length) await database.runtimeAdapter.query('DELETE FROM events WHERE id = ANY($1::bigint[])', [eventIds]);
    if (customerEventId) await database.runtimeAdapter.query('DELETE FROM events WHERE id = $1', [customerEventId]);
    if (serviceId) await database.runtimeAdapter.query('DELETE FROM services WHERE id = $1', [serviceId]);
    if (vendorId) await database.runtimeAdapter.query('DELETE FROM vendor_profiles WHERE id = $1', [vendorId]);
    const userIds = [organizerId, customerId, vendorUserId].filter(Boolean);
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
    const customerRole = (await database.runtimeAdapter.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'customer' AND is_active = TRUE LIMIT 1`,
    )).rows[0];
    const vendorRole = (await database.runtimeAdapter.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'vendor' AND is_active = TRUE LIMIT 1`,
    )).rows[0];
    assert.ok(organizerRole && customerRole && vendorRole, 'seeded organizer, customer, and vendor roles must exist');

    organizerId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon booking organizer', organizerEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    vendorUserId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon booking vendor', vendorEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    customerId = (await database.runtimeAdapter.query(
      `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Neon booking customer', customerEmail, 'integration-only-not-a-password'],
    )).rows[0].id;
    await database.runtimeAdapter.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [organizerId, organizerRole.id, vendorUserId, vendorRole.id, customerId, customerRole.id],
    );
    await database.runtimeAdapter.query(
      `INSERT INTO user_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour'), ($3, $4, NOW() + INTERVAL '1 hour'),
              ($5, $6, NOW() + INTERVAL '1 hour')`,
      [hashToken(token), organizerId, hashToken(`${token}-vendor`), vendorUserId, hashToken(customerToken), customerId],
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
        `INSERT INTO events (organizer_id, title, event_type, start_date, status, budget)
         VALUES ($1, $2, 'Integration', $3, 'active', 10000) RETURNING id`,
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
    const measureDashboardRequests = async (role, endpoints) => {
      const results = await Promise.all(endpoints.map(async ({ name, path, sessionToken }) => {
        const startedAt = Date.now();
        const response = await request(path, sessionToken);
        return { name, response, durationMs: Date.now() - startedAt };
      }));
      const bundleDurationMs = Math.max(...results.map(({ durationMs }) => durationMs));
      console.info(`NEON_DASHBOARD_RESPONSE_MS role=${role} ${results
        .map(({ name, durationMs }) => `${name}=${durationMs}`)
        .join(' ')} bundle=${bundleDurationMs}`);
      assert.ok(bundleDurationMs < 15000, `${role} dashboard must load before the 15-second client timeout`);
      for (const { name, response } of results) {
        assert.equal(response.status, 200, `${role} dashboard ${name} endpoint should load`);
      }
      return Object.fromEntries(await Promise.all(results.map(async ({ name, response }) => (
        [name, await response.json()]
      ))));
    };

    const organizerDashboard = await measureDashboardRequests('organizer', [
      { name: 'overview', path: '/api/platform/organizer/overview', sessionToken: token },
      { name: 'events', path: '/api/platform/events/mine', sessionToken: token },
      { name: 'vendors', path: '/api/platform/vendors?page=1&limit=4&sort=recommended', sessionToken: token },
      { name: 'bookings', path: '/api/platform/bookings', sessionToken: token },
    ]);
    assert.equal(organizerDashboard.overview.data.totalEvents, 2);
    assert.deepEqual(
      organizerDashboard.events.data.map(({ id }) => id).sort((left, right) => left - right),
      eventIds.map(Number).sort((left, right) => left - right),
    );
    assert.deepEqual((await (await request('/api/platform/events/mine', customerToken)).json()).data, []);

    await measureDashboardRequests('customer', [
      { name: 'overview', path: '/api/customer/overview', sessionToken: customerToken },
      { name: 'vendors', path: '/api/customer/vendors', sessionToken: customerToken },
      { name: 'services', path: '/api/customer/services', sessionToken: customerToken },
      { name: 'bookings', path: '/api/customer/bookings', sessionToken: customerToken },
      { name: 'events', path: '/api/customer/events', sessionToken: customerToken },
      { name: 'messages', path: '/api/customer/messages', sessionToken: customerToken },
      { name: 'notifications', path: '/api/customer/notifications', sessionToken: customerToken },
    ]);

    await database.runtimeAdapter.query(
      `INSERT INTO vendor_availability (vendor_id, available_date, status, note)
       VALUES ($1, $2::date, 'available', 'integration availability fixture')`,
      [vendorId, startDate.slice(0, 10)],
    );

    const emptyOverviewResponse = await request('/api/customer/overview', token);
    assert.equal(emptyOverviewResponse.status, 200);
    assert.deepEqual((await emptyOverviewResponse.json()).data, {
      totalBookings: 0,
      pendingBookings: 0,
      confirmedBookings: 0,
      completedBookings: 0,
      upcomingEvents: 2,
      pendingQuotations: 0,
      unreadMessages: 0,
      unreadNotifications: 0,
      outstandingPayments: 0,
    });
    assert.equal((await request('/api/customer/overview', `${token}-vendor`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/customer/overview`)).status, 401);
    const customerAvailabilityDate = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const customerVendors = await request(
      `/api/customer/vendors?sort=recently-added&availableDate=${customerAvailabilityDate}`,
      token,
    );
    assert.equal(customerVendors.status, 200);
    assert.equal((await customerVendors.json()).data.some((row) => row.id === Number(vendorId)), false);
    const customerServices = await request('/api/customer/services?sort=relevance&minReviews=0&maxReviews=10&feature=setup', token);
    assert.equal(customerServices.status, 200);
    const customerCategories = await request('/api/customer/categories', token);
    assert.equal(customerCategories.status, 200);
    assert.ok((await customerCategories.json()).data.some((row) => row.id === Number(categoryId)));
    const customerEvents = await request('/api/customer/events', token);
    assert.equal(customerEvents.status, 200);
    assert.deepEqual((await customerEvents.json()).data.map((row) => row.id).sort(), eventIds.map(Number).sort());

    customerEventId = (await database.runtimeAdapter.query(
      `INSERT INTO events (organizer_id, title, event_type, start_date, status, budget)
       VALUES ($1, $2, 'Integration', $3, 'active', 5000) RETURNING id`,
      [customerId, `Neon customer-owned event ${suffix}`, new Date(Date.now() + 10 * 86400000).toISOString()],
    )).rows[0].id;
    customerBookingId = (await database.runtimeAdapter.query(
      `INSERT INTO bookings
         (event_id, vendor_id, service_description, service_id, quoted_amount, currency, status)
       VALUES ($1, $2, 'Customer workspace service', $3, 75, 'ETB', 'requested') RETURNING id`,
      [customerEventId, vendorId, serviceId],
    )).rows[0].id;
    bookingIds.push(customerBookingId);
    const customerPayment = await database.runtimeAdapter.query(
      `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status)
       VALUES ($1, 75.00, 'ETB', 'integration', $2, 'paid') RETURNING id`,
      [customerBookingId, `customer-payment-${suffix}`],
    );
    customerPaymentId = customerPayment.rows[0].id;
    const customerRefund = await database.runtimeAdapter.query(
      `INSERT INTO refund_requests
         (payment_id, requester_id, amount, currency, reason, status, idempotency_key)
       VALUES ($1, $2, 5.00, 'ETB', 'Customer workspace integration', 'pending', $3)
       RETURNING id`,
      [customerPaymentId, customerId, `customer-refund-${suffix}`],
    );
    customerRefundId = customerRefund.rows[0].id;
    const favoriteResponse = await request('/api/customer/favorites', customerToken, {
      method: 'POST', body: JSON.stringify({ vendorId }),
    });
    assert.equal(favoriteResponse.status, 201);
    const favoriteList = await request('/api/customer/favorites', customerToken);
    assert.equal((await favoriteList.json()).data.some((row) => row.id === Number(vendorId)), true);
    assert.equal((await request('/api/customer/favorites', customerToken, {
      method: 'POST', body: JSON.stringify({ vendorId }),
    })).status, 409);
    assert.equal((await request(`/api/customer/favorites/${vendorId}`, customerToken, { method: 'DELETE' })).status, 204);
    const savedServiceResponse = await request('/api/customer/saved-services', customerToken, {
      method: 'POST', body: JSON.stringify({ serviceId }),
    });
    assert.equal(savedServiceResponse.status, 201);
    const savedServiceList = await request('/api/customer/saved-services', customerToken);
    assert.equal((await savedServiceList.json()).data.some((row) => row.id === Number(serviceId)), true);
    assert.equal((await request(`/api/customer/saved-services/${serviceId}`, customerToken, { method: 'DELETE' })).status, 204);

    const created = await request('/api/platform/bookings', token, {
      method: 'POST',
      body: JSON.stringify({ eventId: eventIds[0], serviceId }),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    const firstBookingId = createdBody.data.id;
    bookingIds.push(firstBookingId);
    assert.equal(createdBody.data.status, 'requested');
    const populatedOverviewResponse = await request('/api/customer/overview', token);
    assert.equal(populatedOverviewResponse.status, 200);
    const populatedOverview = (await populatedOverviewResponse.json()).data;
    assert.equal(populatedOverview.totalBookings, 1);
    assert.equal(populatedOverview.pendingBookings, 1);
    assert.equal(populatedOverview.confirmedBookings, 0);
    assert.equal(populatedOverview.completedBookings, 0);
    assert.equal(populatedOverview.upcomingEvents, 2);
    assert.equal(populatedOverview.pendingQuotations, 0);
    assert.equal(populatedOverview.unreadMessages, 0);
    assert.equal(populatedOverview.outstandingPayments, 0);

    const budgetBefore = await request(`/api/platform/organizer/events/${eventIds[0]}/budget`, token);
    assert.equal(budgetBefore.status, 200);
    assert.equal((await budgetBefore.json()).data.summary.remaining, 10000);
    const categoryResponse = await request(
      `/api/platform/organizer/events/${eventIds[0]}/budget/categories`,
      token,
      { method: 'POST', body: JSON.stringify({ name: 'Live catering', budgetLimit: 700 }) },
    );
    assert.equal(categoryResponse.status, 201);
    const budgetCategoryId = (await categoryResponse.json()).data.id;
    budgetCategoryIds.push(budgetCategoryId);
    const expenseResponse = await request(`/api/platform/organizer/events/${eventIds[0]}/expenses`, token, {
      method: 'POST',
      body: JSON.stringify({
        categoryId: budgetCategoryId,
        bookingId: firstBookingId,
        description: 'Live catering deposit',
        plannedAmount: 300,
        actualAmount: 250,
        expenseDate: new Date().toISOString().slice(0, 10),
      }),
    });
    assert.equal(expenseResponse.status, 201);
    expenseIds.push((await expenseResponse.json()).data.id);
    const budgetAfter = await request(`/api/platform/organizer/events/${eventIds[0]}/budget`, token);
    assert.equal(budgetAfter.status, 200);
    assert.deepEqual((await budgetAfter.json()).data.summary, {
      planned: 300, actual: 250, remaining: 9750,
    });
    const vendorExpenseResponse = await request(`/api/platform/organizer/events/${eventIds[0]}/expenses`, token, {
      method: 'POST',
      body: JSON.stringify({
        vendorId,
        description: 'Vendor-only expense',
        plannedAmount: 10,
        actualAmount: 0,
      }),
    });
    assert.equal(vendorExpenseResponse.status, 201);
    const vendorExpenseId = (await vendorExpenseResponse.json()).data.id;
    expenseIds.push(vendorExpenseId);
    const vendorExpenseUpdate = await request(
      `/api/platform/organizer/events/${eventIds[0]}/expenses/${vendorExpenseId}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({
          vendorId,
          description: 'Updated vendor-only expense',
          plannedAmount: 15,
          actualAmount: 5,
        }),
      },
    );
    assert.equal(vendorExpenseUpdate.status, 200);
    const budgetCategoryUpdate = await request(
      `/api/platform/organizer/events/${eventIds[0]}/budget/categories/${budgetCategoryId}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ name: 'Live catering update', budgetLimit: 800 }) },
    );
    assert.equal(budgetCategoryUpdate.status, 200);
    assert.equal((await request(
      `/api/platform/organizer/events/${eventIds[0]}/budget/categories/${budgetCategoryId}`,
      token,
      { method: 'DELETE' },
    )).status, 409);

    const taskResponse = await request(`/api/platform/organizer/events/${eventIds[0]}/tasks`, token, {
      method: 'POST',
      body: JSON.stringify({ bookingId: firstBookingId, title: 'Live vendor task', details: 'Verify table setup.' }),
    });
    assert.equal(taskResponse.status, 201);
    const taskId = (await taskResponse.json()).data.id;
    taskIds.push(taskId);
    const taskUpdate = await request(
      `/api/platform/organizer/events/${eventIds[0]}/tasks/${taskId}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ title: 'Live vendor task updated', details: '', dueAt: null, status: 'in_progress' }) },
    );
    assert.equal(taskUpdate.status, 200);
    const taskList = await request(`/api/platform/organizer/events/${eventIds[0]}/tasks`, token);
    assert.equal((await taskList.json()).data.find((row) => row.id === taskId)?.status, 'in_progress');
    assert.equal((await database.runtimeAdapter.query(
      `SELECT n.id, h.id AS history_id FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_id = $1 AND n.title = 'Event preparation task'`,
      [String(eventIds[0])],
    )).rowCount, 1);
    assert.equal((await database.runtimeAdapter.query(
      `SELECT id FROM audit_logs WHERE actor_id = $1 AND action = 'organizer.vendor_task_created' AND entity_id = $2`,
      [organizerId, String(eventIds[0])],
    )).rowCount, 1);
    assert.equal((await request(`/api/platform/organizer/events/${eventIds[0]}/expenses/${vendorExpenseId}`, token, {
      method: 'DELETE',
    })).status, 204);
    expenseIds.splice(expenseIds.indexOf(vendorExpenseId), 1);
    assert.equal((await request(`/api/platform/organizer/events/${eventIds[0]}/expenses/${expenseIds[0]}`, token, {
      method: 'DELETE',
    })).status, 204);
    expenseIds.length = 0;
    assert.equal((await request(`/api/platform/organizer/events/${eventIds[0]}/budget/categories/${budgetCategoryId}`, token, {
      method: 'DELETE',
    })).status, 204);
    budgetCategoryIds.length = 0;
    assert.equal((await request(`/api/platform/organizer/events/${eventIds[0]}/tasks/${taskId}`, token, {
      method: 'DELETE',
    })).status, 204);
    taskIds.length = 0;

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
    const organizerBookingList = await request('/api/platform/bookings', token);
    assert.equal(organizerBookingList.status, 200);
    assert.equal((await organizerBookingList.json()).data.some((row) => row.id === firstBookingId), true);
    const vendorBookingList = await request('/api/platform/bookings', `${token}-vendor`);
    assert.equal(vendorBookingList.status, 200);
    assert.equal((await vendorBookingList.json()).data.some((row) => row.id === firstBookingId), true);

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
    const vendorConfirmedBookings = await request('/api/vendor/bookings', `${token}-vendor`);
    assert.equal(vendorConfirmedBookings.status, 200);
    assert.equal((await vendorConfirmedBookings.json()).data.some(
      (row) => Number(row.id) === Number(acceptedBooking.id),
    ), true);
    const cancellation = await request(`/api/platform/bookings/${acceptedBooking.id}/status`, token, {
      method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: 'Integration cancellation' }),
    });
    assert.equal(cancellation.status, 200);
    const releasedDate = await database.runtimeAdapter.query(
      `SELECT available_date, status, note FROM vendor_availability WHERE vendor_id = $1 AND status = 'available'`,
      [vendorId],
    );
    assert.equal(releasedDate.rowCount, 1);
    assert.equal(releasedDate.rows[0].note, null);
    const historyAfterCancellation = await database.runtimeAdapter.query(
      'SELECT action FROM booking_history WHERE booking_id = ANY($1::bigint[])',
      [bookingIds],
    );
    assert.equal(historyAfterCancellation.rowCount, 4);
    const bookingAudit = await database.runtimeAdapter.query(
      `SELECT action FROM audit_logs
       WHERE entity_type = 'booking' AND entity_id = ANY($1::varchar[])
         AND action IN ('booking.accepted', 'booking.cancelled')`,
      [bookingIds.map(String)],
    );
    assert.ok(bookingAudit.rowCount >= 2);
    const notificationsAfterCancellation = await database.runtimeAdapter.query(
      `SELECT n.id, h.id AS history_id FROM notifications n
       LEFT JOIN notification_history h ON h.notification_id = n.id
       WHERE n.related_entity_id = ANY($1::varchar[]) AND n.notification_type = 'booking'`,
      [bookingIds.map(String)],
    );
    assert.equal(notificationsAfterCancellation.rowCount, 4);
    assert.ok(notificationsAfterCancellation.rows.every((row) => row.history_id));

    const vendorAvailability = await request('/api/vendor/availability', `${token}-vendor`);
    assert.equal(vendorAvailability.status, 200);
    const vendorAvailabilityBody = await vendorAvailability.json();
    const releasedDateOnly = String(releasedDate.rows[0].available_date).slice(0, 10);
    assert.equal(vendorAvailabilityBody.data.schedule.some(
      (row) => row.date === releasedDateOnly && row.status === 'available',
    ), true, JSON.stringify(vendorAvailabilityBody.data.schedule));
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

    const customerPaymentList = await request('/api/customer/payments', customerToken);
    assert.equal(customerPaymentList.status, 200);
    assert.ok((await customerPaymentList.json()).data.some((row) => row.id === Number(customerPaymentId)));
    const customerPaymentDetails = await request(`/api/customer/payments/${customerPaymentId}`, customerToken);
    assert.equal(customerPaymentDetails.status, 200);
    const customerPaymentBody = (await customerPaymentDetails.json()).data;
    assert.ok(customerPaymentBody.refunds.some((row) => row.id === Number(customerRefundId)));
    foreignPaymentId = (await database.runtimeAdapter.query(
      `INSERT INTO payments (booking_id, amount, currency, provider, provider_reference, status)
       VALUES ($1, 25.00, 'ETB', 'integration', $2, 'paid') RETURNING id`,
      [firstBookingId, `foreign-customer-payment-${suffix}`],
    )).rows[0].id;
    const foreignPaymentDetails = await request(`/api/customer/payments/${foreignPaymentId}`, customerToken);
    assert.equal(foreignPaymentDetails.status, 404);
    const customerRefundList = await request('/api/customer/refunds', customerToken);
    assert.equal(customerRefundList.status, 200);
    assert.ok((await customerRefundList.json()).data.some((row) => row.id === Number(customerRefundId)));

    const customerRescheduleTarget = new Date(Date.now() + 20 * 86400000);
    const padCustomerDate = (value) => String(value).padStart(2, '0');
    const customerScheduledDate = `${customerRescheduleTarget.getFullYear()}-${padCustomerDate(customerRescheduleTarget.getMonth() + 1)}-${padCustomerDate(customerRescheduleTarget.getDate())}T12:00`;
    const customerRescheduled = await request(`/api/customer/bookings/${customerBookingId}/reschedule`, customerToken, {
      method: 'PATCH',
      body: JSON.stringify({ scheduledDate: customerScheduledDate, reason: 'Neon customer reschedule' }),
    });
    const customerRescheduleBody = await customerRescheduled.json();
    assert.equal(customerRescheduled.status, 200, JSON.stringify(customerRescheduleBody));
    assert.equal(customerRescheduleBody.data.scheduled_date.slice(0, 16).replace(' ', 'T'), customerScheduledDate);
    const persistedCustomerReschedule = await database.runtimeAdapter.query(
      `SELECT b.scheduled_date, h.action, h.reason FROM bookings b
       JOIN booking_history h ON h.booking_id = b.id
       WHERE b.id = $1 AND h.action = 'rescheduled'`,
      [customerBookingId],
    );
    assert.equal(persistedCustomerReschedule.rowCount, 1);
    assert.equal(persistedCustomerReschedule.rows[0].reason, 'Neon customer reschedule');

    const customerWorkspaceMessage = await request('/api/customer/messages', customerToken, {
      method: 'POST',
      body: JSON.stringify({ bookingId: customerBookingId, body: 'Please confirm setup time.' }),
    });
    assert.equal(customerWorkspaceMessage.status, 201);
    const customerMessageId = (await customerWorkspaceMessage.json()).data.id;
    const vendorReply = await request('/api/vendor/messages', `${token}-vendor`, {
      method: 'POST',
      body: JSON.stringify({ bookingId: customerBookingId, body: 'Setup time confirmed.' }),
    });
    assert.equal(vendorReply.status, 201);
    const vendorReplyId = (await vendorReply.json()).data.id;
    const customerMessages = await request('/api/customer/messages', customerToken);
    assert.equal(customerMessages.status, 200);
    const customerMessageRows = (await customerMessages.json()).data;
    assert.ok(customerMessageRows.some((row) => row.id === customerMessageId));
    assert.ok(customerMessageRows.some((row) => row.id === vendorReplyId));
    const customerMessageRead = await request(`/api/customer/messages/${vendorReplyId}/read`, customerToken, {
      method: 'POST',
    });
    assert.equal(customerMessageRead.status, 200);
    assert.equal((await customerMessageRead.json()).data.read, true);
    const foreignMessage = await database.runtimeAdapter.query(
      `INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body)
       VALUES ($1, $2, $3, 'Foreign booking message', 'Not owned by this customer') RETURNING id`,
      [vendorUserId, customerId, firstBookingId],
    );
    assert.equal((await request(`/api/customer/messages/${foreignMessage.rows[0].id}/read`, customerToken, {
      method: 'POST',
    })).status, 404);
    assert.equal((await request('/api/customer/messages', `${token}-vendor`)).status, 403);
    assert.equal((await database.runtimeAdapter.query(
      `SELECT COUNT(*)::integer AS total FROM audit_logs
       WHERE actor_id = $1 AND action = 'customer.message_sent' AND entity_id = $2`,
      [customerId, String(customerBookingId)],
    )).rows[0].total, 1);

    const customerNotificationRows = [];
    for (const title of ['Customer workspace read', 'Customer workspace bulk']) {
      const notification = await database.runtimeAdapter.query(
        `INSERT INTO notifications
           (user_id, title, message, notification_type, related_entity_type, related_entity_id)
         VALUES ($1, $2, 'Customer notification integration', 'booking', 'booking', $3)
         RETURNING id`,
        [customerId, title, String(customerBookingId)],
      );
      customerNotificationRows.push(notification.rows[0].id);
    }
    const customerNotifications = await request('/api/customer/notifications', customerToken);
    assert.equal(customerNotifications.status, 200);
    assert.ok((await customerNotifications.json()).data.some((row) => row.id === Number(customerNotificationRows[0])));
    assert.equal((await request(`/api/customer/notifications/${customerNotificationRows[0]}/read`, customerToken, {
      method: 'POST',
    })).status, 200);
    assert.equal((await request(`/api/customer/notifications/${customerNotificationRows[0]}/read`, customerToken, {
      method: 'POST',
    })).status, 200);
    assert.equal((await request('/api/customer/notifications/read-all', customerToken, {
      method: 'POST',
    })).status, 200);
    const customerNotificationState = await database.runtimeAdapter.query(
      `SELECT n.status, COUNT(h.id)::integer AS read_history
       FROM notifications n LEFT JOIN notification_history h ON h.notification_id = n.id AND h.action = 'read'
       WHERE n.id = ANY($1::bigint[]) GROUP BY n.id ORDER BY n.id`,
      [customerNotificationRows],
    );
    assert.deepEqual(customerNotificationState.rows.map((row) => row.status), ['read', 'read']);
    assert.deepEqual(customerNotificationState.rows.map((row) => row.read_history), [1, 1]);

    await database.runtimeAdapter.query(
      "UPDATE bookings SET status = 'completed' WHERE id = $1",
      [customerBookingId],
    );
    const customerReview = await request('/api/customer/reviews', customerToken, {
      method: 'POST',
      body: JSON.stringify({ bookingId: customerBookingId, rating: 4, comment: 'Customer review integration' }),
    });
    assert.equal(customerReview.status, 201);
    const customerReviewId = (await customerReview.json()).data.id;
    const customerReviews = await request('/api/customer/reviews', customerToken);
    assert.equal(customerReviews.status, 200);
    assert.ok((await customerReviews.json()).data.some((row) => row.id === customerReviewId));
    assert.equal((await request('/api/customer/reviews', customerToken, {
      method: 'POST',
      body: JSON.stringify({ bookingId: customerBookingId, rating: 5, comment: 'Duplicate review' }),
    })).status, 409);

    const complaintResponse = await request('/api/customer/complaints', customerToken, {
      method: 'POST',
      body: JSON.stringify({
        bookingId: customerBookingId,
        subject: 'Customer complaint integration',
        details: 'The service did not match the confirmed arrangement.',
      }),
    });
    const complaintBody = await complaintResponse.json();
    assert.equal(complaintResponse.status, 201, JSON.stringify(complaintBody));
    const complaintId = complaintBody.data.id;
    complaintIds.push(complaintId);
    assert.match(complaintBody.data.reference, /^CMP-\d{6}$/);
    assert.equal((await request(`/api/customer/complaints/${complaintId}`, token)).status, 404);
    const complaintList = await request('/api/customer/complaints', customerToken);
    assert.equal(complaintList.status, 200);
    assert.ok((await complaintList.json()).data.some((row) => row.id === complaintId));
    const complaintDetail = await request(`/api/customer/complaints/${complaintId}`, customerToken);
    assert.equal(complaintDetail.status, 200);
    assert.equal((await complaintDetail.json()).data.history[0].action, 'created');
    assert.equal((await request('/api/customer/complaints', `${token}-vendor`)).status, 403);
    assert.equal((await request('/api/customer/complaints', customerToken, {
      method: 'POST',
      body: JSON.stringify({ bookingId: firstBookingId, subject: 'Foreign booking', details: 'This booking belongs to another organizer.' }),
    })).status, 404);

    const pdf = Buffer.from('%PDF-1.7\nNeon complaint attachment\n');
    const attachmentResponse = await fetch(
      `${baseUrl}/api/customer/complaints/${complaintId}/attachments?filename=proof.pdf`,
      { method: 'POST', headers: { Cookie: cookie(customerToken), 'Content-Type': 'application/pdf' }, body: pdf },
    );
    const attachmentBody = await attachmentResponse.json();
    assert.equal(attachmentResponse.status, 201, JSON.stringify(attachmentBody));
    const attachmentId = attachmentBody.data.id;
    const attachmentDownload = await fetch(
      `${baseUrl}/api/customer/complaints/${complaintId}/attachments/${attachmentId}`,
      { headers: { Cookie: cookie(customerToken) } },
    );
    assert.equal(attachmentDownload.status, 200);
    assert.deepEqual(Buffer.from(await attachmentDownload.arrayBuffer()), pdf);
    assert.equal((await fetch(
      `${baseUrl}/api/customer/complaints/${complaintId}/attachments/${attachmentId}`,
      { headers: { Cookie: cookie(token) } },
    )).status, 404);
    const persistedComplaint = await database.runtimeAdapter.query(
      `SELECT c.status, h.action, a.file_size, a.sha256, al.action AS audit_action
       FROM complaints c
       JOIN complaint_history h ON h.complaint_id = c.id
       JOIN complaint_attachments a ON a.complaint_id = c.id
       JOIN audit_logs al ON al.entity_type = 'complaint' AND al.entity_id = c.id::varchar
       WHERE c.id = $1 AND h.action = 'attachment_added' AND al.action = 'complaint.attachment_added'`,
      [complaintId],
    );
    assert.equal(persistedComplaint.rowCount, 1);
    assert.equal(persistedComplaint.rows[0].status, 'open');
    assert.equal(persistedComplaint.rows[0].action, 'attachment_added');
    assert.equal(persistedComplaint.rows[0].file_size, pdf.length);
    assert.equal(persistedComplaint.rows[0].audit_action, 'complaint.attachment_added');
    assert.equal((await request(`/api/customer/complaints/${complaintId}/attachments`, customerToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: 'not a pdf',
    })).status, 400);

    console.log('Neon booking, communication, notification, review, complaint, attachment, payment, refund, quotation, and availability integration passed.');
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
