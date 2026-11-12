import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon admin event create, list, update, status changes, overlap rollback, and authorization', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const suffix = randomUUID();
  const adminToken = randomBytes(32).toString('hex');
  const organizerToken = randomBytes(32).toString('hex');
  const eventIds = [];
  let adminId;
  let adminRoleId;
  let organizerId;
  let organizerRoleId;
  let server;

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.equal(identity.database_name, 'eventhub');

    await database.inTransaction(async (client) => {
      const organizerRole = await client.query(
        `SELECT id FROM roles
         WHERE LOWER(name) = 'organizer' AND is_admin = FALSE AND is_active = TRUE
         LIMIT 1`,
      );
      assert.ok(organizerRole.rows[0], 'an active organizer role must exist');
      organizerRoleId = organizerRole.rows[0].id;

      const adminRole = await client.query(
        `INSERT INTO roles (name, description, is_admin, is_active)
         VALUES ($1, 'Temporary admin event integration role', TRUE, TRUE) RETURNING id`,
        [`event-admin-${suffix}`],
      );
      adminRoleId = adminRole.rows[0].id;
      const admin = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Event Integration Admin', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [`event-admin-${suffix}@example.invalid`],
      );
      adminId = admin.rows[0].id;
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [adminId, adminRoleId],
      );
      await client.query(
        `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(adminToken), adminId],
      );

      const organizer = await client.query(
        `INSERT INTO users (full_name, email, password_hash, status)
         VALUES ('Event Integration Organizer', $1, 'integration-only-not-a-login-hash', 'active')
         RETURNING id`,
        [`event-organizer-${suffix}@example.invalid`],
      );
      organizerId = organizer.rows[0].id;
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [organizerId, organizerRoleId],
      );
      await client.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [hashToken(organizerToken), organizerId],
      );
    });

    const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
    const request = (path, { method = 'GET', body, token = adminToken, session = 'admin_session' } = {}) => fetch(
      `${baseUrl}${path}`,
      {
        method,
        headers: {
          Cookie: `${session}=${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const eventBody = (title, startDate, endDate) => ({
      organizer_id: organizerId,
      title,
      event_type: 'Music',
      description: 'Neon event integration fixture',
      city: 'Addis Ababa',
      venue: 'Integration Hall',
      cover_image_url: '',
      gallery_images: [],
      start_date: startDate,
      end_date: endDate,
      budget: 1200,
      capacity: 200,
      guest_count: 150,
      notes: '',
    });

    const unauthenticated = await fetch(`${baseUrl}/events`);
    assert.equal(unauthenticated.status, 401);
    const forbidden = await request('/events', {
      method: 'POST',
      session: 'platform_session',
      token: organizerToken,
      body: eventBody('Unauthorized Event', '2031-08-10T10:00', '2031-08-10T12:00'),
    });
    assert.equal(forbidden.status, 403);

    const optionsResponse = await request('/events/options');
    assert.equal(optionsResponse.status, 200);
    const options = (await optionsResponse.json()).data;
    assert.ok(options.organizers.some((organizer) => String(organizer.id) === String(organizerId)));

    const firstTitle = `Neon event A ${suffix}`;
    const createdResponse = await request('/events', {
      method: 'POST',
      body: eventBody(firstTitle, '2031-08-10T10:00', '2031-08-10T12:00'),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).data;
    eventIds.push(created.id);
    assert.equal(created.status, 'draft');

    const persistedCreate = await database.runtimeAdapter.query(
      `SELECT e.id, e.title, e.status, e.gallery_images,
              (SELECT COUNT(*) FROM event_history h WHERE h.event_id = e.id) AS history_count,
              (SELECT COUNT(*) FROM audit_logs a
               WHERE a.entity_type = 'event' AND a.entity_id = e.id::text) AS audit_count
       FROM events e WHERE e.id = $1`,
      [created.id],
    );
    assert.equal(persistedCreate.rows[0].title, firstTitle);
    assert.equal(persistedCreate.rows[0].status, 'draft');
    assert.deepEqual(persistedCreate.rows[0].gallery_images, []);
    assert.equal(Number(persistedCreate.rows[0].history_count), 1);
    assert.equal(Number(persistedCreate.rows[0].audit_count), 1);

    const secondTitle = `Neon event B ${suffix}`;
    const secondResponse = await request('/events', {
      method: 'POST',
      body: eventBody(secondTitle, '2031-08-12T10:00', '2031-08-12T12:00'),
    });
    assert.equal(secondResponse.status, 201);
    const second = (await secondResponse.json()).data;
    eventIds.push(second.id);

    const overlapResponse = await request('/events', {
      method: 'POST',
      body: eventBody(`Overlapping event ${suffix}`, '2031-08-10T11:00', '2031-08-10T13:00'),
    });
    assert.equal(overlapResponse.status, 409);
    const rolledBackOverlap = await database.runtimeAdapter.query(
      `SELECT COUNT(*)::int AS total FROM events
       WHERE title = $1`,
      [`Overlapping event ${suffix}`],
    );
    assert.equal(rolledBackOverlap.rows[0].total, 0);

    const listResponse = await request(`/events?q=${encodeURIComponent(firstTitle)}&status=draft&pageSize=5`);
    assert.equal(listResponse.status, 200);
    const listing = await listResponse.json();
    assert.equal(listing.pagination.total, 1);
    assert.equal(String(listing.data[0].id), String(created.id));
    assert.equal(listing.data[0].organizer_name, 'Event Integration Organizer');
    assert.equal(Number(listing.data[0].booking_count), 0);

    const detailResponse = await request(`/events/${created.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()).data;
    assert.equal(detail.event.title, firstTitle);
    assert.equal(detail.history[0].action, 'event.created');
    assert.deepEqual(detail.vendorBookings, []);
    assert.deepEqual(detail.ticketBookings, []);

    const updatedTitle = `Neon event updated ${suffix}`;
    const updateResponse = await request(`/events/${created.id}`, {
      method: 'PATCH',
      body: { title: updatedTitle, is_featured: true, capacity: 180 },
    });
    assert.equal(updateResponse.status, 200);
    const persistedUpdate = await database.runtimeAdapter.query(
      `SELECT title, is_featured, capacity FROM events WHERE id = $1`,
      [created.id],
    );
    assert.equal(persistedUpdate.rows[0].title, updatedTitle);
    assert.equal(persistedUpdate.rows[0].is_featured, true);
    assert.equal(persistedUpdate.rows[0].capacity, 180);

    const invalidApproval = await request(`/events/${created.id}/status`, {
      method: 'PATCH',
      body: { action: 'approve' },
    });
    assert.equal(invalidApproval.status, 409);

    const publishResponse = await request(`/events/${created.id}/status`, {
      method: 'PATCH',
      body: { action: 'publish' },
    });
    assert.equal(publishResponse.status, 200);
    const published = (await publishResponse.json()).data;
    assert.equal(published.id, Number(created.id));
    assert.equal(published.status, 'active');

    const cancelResponse = await request(`/events/${created.id}/status`, {
      method: 'PATCH',
      body: { action: 'cancel', reason: 'Venue unavailable' },
    });
    assert.equal(cancelResponse.status, 200);
    const cancelled = (await cancelResponse.json()).data;
    assert.equal(cancelled.id, Number(created.id));
    assert.equal(cancelled.status, 'cancelled');

    const persistedStatus = await database.runtimeAdapter.query(
      `SELECT e.status, e.published_at,
              (SELECT COUNT(*) FROM event_history h
               WHERE h.event_id = e.id AND h.action IN ('event.publish', 'event.cancel')) AS history_count,
              (SELECT COUNT(*) FROM audit_logs a
               WHERE a.entity_type = 'event' AND a.entity_id = e.id::text
                 AND a.action IN ('event.publish', 'event.cancel')) AS audit_count,
              (SELECT COUNT(*) FROM notifications n
               WHERE n.related_entity_type = 'event' AND n.related_entity_id = e.id::text
                 AND n.user_id = $2 AND n.notification_type = 'event'
                 AND n.delivery_status = 'delivered') AS notification_count
       FROM events e WHERE e.id = $1`,
      [created.id, organizerId],
    );
    assert.equal(persistedStatus.rows[0].status, 'cancelled');
    assert.ok(persistedStatus.rows[0].published_at);
    assert.equal(Number(persistedStatus.rows[0].history_count), 2);
    assert.equal(Number(persistedStatus.rows[0].audit_count), 2);
    assert.equal(Number(persistedStatus.rows[0].notification_count), 2);

    const recancelResponse = await request(`/events/${created.id}/status`, {
      method: 'PATCH',
      body: { action: 'cancel', reason: 'Already cancelled' },
    });
    assert.equal(recancelResponse.status, 409);

    const overlappingUpdate = await request(`/events/${created.id}`, {
      method: 'PATCH',
      body: { start_date: '2031-08-12T11:00', end_date: '2031-08-12T13:00' },
    });
    assert.equal(overlappingUpdate.status, 409);
    const afterRejectedUpdate = await database.runtimeAdapter.query(
      'SELECT title, start_date FROM events WHERE id = $1',
      [created.id],
    );
    assert.equal(afterRejectedUpdate.rows[0].title, updatedTitle);
    assert.equal(new Date(afterRejectedUpdate.rows[0].start_date).toISOString(), '2031-08-10T10:00:00.000Z');

    await database.runtimeAdapter.query(
      "UPDATE events SET status = 'pending_approval' WHERE id = $1",
      [second.id],
    );
    const approveResponse = await request(`/events/${second.id}/status`, {
      method: 'PATCH',
      body: { action: 'approve' },
    });
    assert.equal(approveResponse.status, 200);
    assert.equal((await approveResponse.json()).data.status, 'active');

    const unpublishResponse = await request(`/events/${second.id}/status`, {
      method: 'PATCH',
      body: { action: 'unpublish', reason: 'Scheduling pause' },
    });
    assert.equal(unpublishResponse.status, 200);
    assert.equal((await unpublishResponse.json()).data.status, 'draft');

    await database.runtimeAdapter.query(
      "UPDATE events SET status = 'pending_approval' WHERE id = $1",
      [second.id],
    );
    const rejectResponse = await request(`/events/${second.id}/status`, {
      method: 'PATCH',
      body: { action: 'reject', reason: 'Organizer changes required' },
    });
    assert.equal(rejectResponse.status, 200);
    assert.equal((await rejectResponse.json()).data.status, 'rejected');
    const rejectedEvent = await database.runtimeAdapter.query(
      'SELECT status, rejection_reason FROM events WHERE id = $1',
      [second.id],
    );
    assert.equal(rejectedEvent.rows[0].status, 'rejected');
    assert.equal(rejectedEvent.rows[0].rejection_reason, 'Organizer changes required');

    const republishResponse = await request(`/events/${second.id}/status`, {
      method: 'PATCH',
      body: { action: 'publish' },
    });
    assert.equal(republishResponse.status, 200);
    assert.equal((await republishResponse.json()).data.status, 'active');
    await database.runtimeAdapter.query(
      `UPDATE events SET end_date = NOW() - INTERVAL '1 day'
       WHERE id = $1`,
      [second.id],
    );
    const completeResponse = await request(`/events/${second.id}/status`, {
      method: 'PATCH',
      body: { action: 'complete' },
    });
    assert.equal(completeResponse.status, 200);
    assert.equal((await completeResponse.json()).data.status, 'completed');
    const persistedTransitions = await database.runtimeAdapter.query(
      `SELECT e.status,
              (SELECT COUNT(*) FROM event_history h
               WHERE h.event_id = e.id
                 AND h.action = ANY($2::varchar[])) AS history_count,
              (SELECT COUNT(*) FROM audit_logs a
               WHERE a.entity_type = 'event' AND a.entity_id = e.id::text
                 AND a.action = ANY($2::varchar[])) AS audit_count,
              (SELECT COUNT(*) FROM notifications n
               WHERE n.related_entity_type = 'event' AND n.related_entity_id = e.id::text
                 AND n.user_id = $3 AND n.notification_type = 'event'
                 AND n.delivery_status = 'delivered') AS notification_count
       FROM events e WHERE e.id = $1`,
      [
        second.id,
        ['event.approve', 'event.unpublish', 'event.reject', 'event.publish', 'event.complete'],
        organizerId,
      ],
    );
    assert.equal(persistedTransitions.rows[0].status, 'completed');
    assert.equal(Number(persistedTransitions.rows[0].history_count), 5);
    assert.equal(Number(persistedTransitions.rows[0].audit_count), 5);
    assert.equal(Number(persistedTransitions.rows[0].notification_count), 5);

    const unsupportedDelete = await request(`/events/${created.id}`, { method: 'DELETE' });
    assert.equal(unsupportedDelete.status, 404);
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }

    if (adminId && organizerId) {
      await database.inTransaction(async (client) => {
        if (eventIds.length) {
          await client.query('DELETE FROM event_history WHERE event_id = ANY($1::bigint[])', [eventIds]);
          await client.query(
            `DELETE FROM audit_logs
             WHERE entity_type = 'event' AND entity_id = ANY($1::text[])`,
            [eventIds.map(String)],
          );
          await client.query(
            `DELETE FROM notification_history
             WHERE notification_id IN (
               SELECT id FROM notifications
               WHERE related_entity_type = 'event' AND related_entity_id = ANY($1::text[])
             )`,
            [eventIds.map(String)],
          );
          await client.query(
            `DELETE FROM notifications
             WHERE related_entity_type = 'event' AND related_entity_id = ANY($1::text[])`,
            [eventIds.map(String)],
          );
          await client.query('DELETE FROM events WHERE id = ANY($1::bigint[])', [eventIds]);
        }
        await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [adminId]);
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [organizerId]);
        await client.query('DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])', [[adminId, organizerId]]);
        await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [[adminId, organizerId]]);
        if (adminRoleId) await client.query('DELETE FROM roles WHERE id = $1', [adminRoleId]);
      });
    }
    await database.close();
  }
});
