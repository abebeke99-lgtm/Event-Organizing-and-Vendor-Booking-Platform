import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon public contact endpoints read settings and persist submitted messages', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const email = `contact-integration-${randomUUID()}@example.invalid`;
  const subject = `Support ${randomUUID()}`;
  let server;

  try {
    const app = createApp({
      database: database.runtimeAdapter,
      databaseDialect: 'postgres',
      notificationEmailConfigured: () => false,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const contactResponse = await fetch(`${baseUrl}/api/contact`);
    assert.equal(contactResponse.status, 200);
    const contactData = await contactResponse.json();
    assert.equal(contactData.success, true);
    assert.ok(Array.isArray(contactData.data.faq));

    const submissionResponse = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        full_name: 'EventHub Contact Integration',
        email,
        subject,
        message: 'Please help with this real Neon contact integration check.',
      }),
    });
    assert.equal(submissionResponse.status, 201);
    const submission = await submissionResponse.json();
    assert.equal(submission.success, true);

    const persisted = await database.runtimeAdapter.query(
      `SELECT reference_id, full_name, email, subject, message, status
       FROM contact_messages WHERE reference_id = $1`,
      [submission.data.reference],
    );
    assert.deepEqual(persisted.rows[0], {
      reference_id: submission.data.reference,
      full_name: 'EventHub Contact Integration',
      email,
      subject,
      message: 'Please help with this real Neon contact integration check.',
      status: 'new',
    });
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    try {
      await database.runtimeAdapter.query(
        'DELETE FROM contact_messages WHERE email = $1 AND subject = $2',
        [email, subject],
      );
    } finally {
      await database.close();
    }
  }
});
