import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL homepage hero slides and statistics APIs', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const slidesResponse = await fetch(`${baseUrl}/hero-slides`);
    assert.equal(slidesResponse.status, 200);
    assert.match(slidesResponse.headers.get('cache-control'), /max-age=60/);
    const slides = await slidesResponse.json();
    assert.ok(Array.isArray(slides.data));
    for (const slide of slides.data) {
      assert.equal(typeof slide.id, 'number');
      assert.equal(slide.imageUrl, `/api/hero-slides/${slide.id}/image`);
      assert.equal(typeof slide.altText, 'string');
    }

    const invalidImage = await fetch(`${baseUrl}/hero-slides/not-an-id/image`);
    assert.equal(invalidImage.status, 404);

    const statisticsResponse = await fetch(`${baseUrl}/about/homepage-statistics`);
    assert.equal(statisticsResponse.status, 200);
    assert.match(statisticsResponse.headers.get('cache-control'), /stale-while-revalidate=120/);
    const statistics = (await statisticsResponse.json()).data;
    assert.deepEqual(Object.keys(statistics).sort(), [
      'activeVendorCount',
      'averageVendorRating',
      'completedBookingCount',
      'confirmedOrCompletedBookingCount',
      'publishedEventCount',
    ].sort());

    const expected = await database.runtimeAdapter.query(`
      SELECT
        (SELECT COUNT(*) FROM vendor_profiles vp JOIN users u ON u.id = vp.user_id
         WHERE vp.verification_status = 'verified' AND u.status = 'active') AS vendors,
        (SELECT COUNT(*) FROM events WHERE status IN ('active', 'completed')) AS events,
        (SELECT COUNT(*) FROM bookings WHERE status IN ('accepted', 'completed')) AS bookings,
        (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS completed
    `);
    assert.equal(Number(statistics.activeVendorCount), Number(expected.rows[0].vendors));
    assert.equal(Number(statistics.publishedEventCount), Number(expected.rows[0].events));
    assert.equal(Number(statistics.confirmedOrCompletedBookingCount), Number(expected.rows[0].bookings));
    assert.equal(Number(statistics.completedBookingCount), Number(expected.rows[0].completed));
  } finally {
    server.close();
    await once(server, 'close');
    await database.close();
  }
});
