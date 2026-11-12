import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { publicContactSchema } from '../src/routes/contact.js';

const validContactMessage = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '',
  subject: 'Event support',
  message: 'Please help me with my event booking.',
};

test('public contact submissions default an omitted inquiry type', () => {
  const parsed = publicContactSchema.parse(validContactMessage);

  assert.equal(parsed.inquiry_type, 'general_inquiry');
});

test('public contact submissions continue accepting explicit inquiry types', () => {
  const parsed = publicContactSchema.parse({
    ...validContactMessage,
    inquiry_type: 'event_booking_support',
  });

  assert.equal(parsed.inquiry_type, 'event_booking_support');
});

test('public contact validation sanitizes controls and rejects invalid contact details', () => {
  const parsed = publicContactSchema.parse({
    ...validContactMessage,
    full_name: '  Ada\u0000 Lovelace  ',
    message: '  Please help with this booking.\u0000\nThank you.  ',
  });

  assert.equal(parsed.full_name, 'Ada Lovelace');
  assert.equal(parsed.message, 'Please help with this booking.\nThank you.');
  assert.throws(() => publicContactSchema.parse({ ...validContactMessage, email: 'not-an-email' }));
  assert.throws(() => publicContactSchema.parse({ ...validContactMessage, message: 'short' }));
  assert.throws(() => publicContactSchema.parse({ ...validContactMessage, phone: 'call me' }));
});

function createContactDatabase({ admins = [], messages = [], settings = [] } = {}) {
  let nextId = 1;
  const statements = [];
  return {
    messages,
    statements,
    async execute(statement, values = []) {
      statements.push(statement);
      if (statement.startsWith('SELECT setting_key, setting_value')) {
        return [settings.filter(({ setting_key }) => values.includes(setting_key)), []];
      }
      if (statement.startsWith('INSERT INTO contact_messages')) {
        const [referenceId, fullName, email, phone, subject, inquiryType, message, status] = values;
        const saved = {
          id: nextId++,
          reference_id: referenceId,
          full_name: fullName,
          email,
          phone,
          subject,
          inquiry_type: inquiryType,
          message,
          status,
          admin_reply: null,
          reviewed_at: null,
          read_at: null,
          read_status: 'unread',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived_at: null,
        };
        messages.push(saved);
        return [{ insertId: saved.id, affectedRows: 1 }, []];
      }
      if (statement.includes('FROM admin_sessions')) {
        return [[{ id: 8, full_name: 'Admin', email: 'admin@example.com', status: 'active', roles: 'admin' }], []];
      }
      if (statement.includes('SELECT DISTINCT u.email')) return [admins.map((email) => ({ email })), []];
      if (statement.startsWith('SELECT COUNT(*) AS total FROM contact_messages')) {
        return [[{ total: messages.length }], []];
      }
      if (statement.startsWith('SELECT m.id, m.reference_id')) return [messages, []];
      if (statement.startsWith('SELECT full_name, email, subject, admin_reply')) {
        const message = messages.find((row) => row.id === Number(values[0]));
        return [message ? [{ ...message }] : [], []];
      }
      if (statement.includes('SET status = ?, admin_reply = ?')) {
        const message = messages.find((row) => row.id === Number(values[4]));
        if (!message) return [{ affectedRows: 0 }, []];
        [message.status, message.admin_reply] = values;
        message.read_at = values[3] === 'new' ? null : new Date();
        return [{ affectedRows: 1 }, []];
      }
      if (statement.startsWith('INSERT INTO audit_logs')) return [{ insertId: 1 }, []];
      if (statement.startsWith('SELECT id FROM contact_messages')) {
        return [messages.filter((row) => row.id === Number(values[0])).map(({ id }) => ({ id })), []];
      }
      if (statement.startsWith('UPDATE contact_messages SET read_at')) {
        const message = messages.find((row) => row.id === Number(values[1]));
        if (message) message.read_at = values[0];
        return [{ affectedRows: message ? 1 : 0 }, []];
      }
      if (statement.startsWith('UPDATE contact_messages SET archived_at')) {
        const message = messages.find((row) => row.id === Number(values[1]));
        if (message) message.archived_at = values[0];
        return [{ affectedRows: message ? 1 : 0 }, []];
      }
      throw new Error(`Unexpected contact test query: ${statement}`);
    },
  };
}

async function withContactServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createContactApp(database, { emailConfigured = false, emailSender = async () => {} } = {}) {
  return createApp({ database, notificationEmailConfigured: () => emailConfigured, notificationEmailSender: emailSender });
}

test('native PostgreSQL contact routes read settings and accept parameterized submissions', async () => {
  const messages = [];
  const statements = [];
  const database = {
    dialect: 'postgres',
    async query(statement, values = []) {
      statements.push(statement);
      if (statement.includes('FROM system_settings')) return { rows: [], rowCount: 0 };
      if (statement.startsWith('INSERT INTO contact_messages')) {
        messages.push(values);
        return { rows: [{ id: messages.length }], rowCount: 1 };
      }
      throw new Error(`Unexpected PostgreSQL contact query: ${statement}`);
    },
  };
  const app = createApp({
    database,
    databaseDialect: 'postgres',
    notificationEmailConfigured: () => false,
  });

  await withContactServer(app, async (baseUrl) => {
    const contactResponse = await fetch(`${baseUrl}/api/contact`);
    assert.equal(contactResponse.status, 200);
    assert.deepEqual((await contactResponse.json()).data.contact, {
      email: '',
      phone: '',
      address: '',
      hours: '',
      socials: [],
    });

    const submissionResponse = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validContactMessage),
    });
    assert.equal(submissionResponse.status, 201);
    const result = await submissionResponse.json();
    assert.equal(result.success, true);
    assert.match(result.data.reference, /^EH-[0-9A-F]{24}$/);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].slice(1), [
      validContactMessage.full_name,
      validContactMessage.email,
      null,
      validContactMessage.subject,
      'general_inquiry',
      validContactMessage.message,
      'new',
    ]);
  });

  assert.ok(statements.some((statement) => statement.includes('ANY($1::varchar[])')));
  assert.ok(statements.some((statement) => statement.includes('VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)')));
});

test('contact API persists a valid message and reports unconfigured email delivery', async (context) => {
  const database = createContactDatabase();
  await withContactServer(createContactApp(database), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validContactMessage),
    });

    await context.test('contact API sends administrator and customer emails when SMTP is configured', async () => {
      const database = createContactDatabase({ admins: ['admin@example.com'] });
      const sentEmails = [];
      await withContactServer(createContactApp(database, {
        emailConfigured: true,
        emailSender: async (message) => { sentEmails.push(message); },
      }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/contact`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(validContactMessage),
        });

        assert.equal(response.status, 201);
        assert.deepEqual((await response.json()).data.email, { administrator: 'sent', customer: 'sent' });
        assert.deepEqual(sentEmails.map(({ email }) => email), ['admin@example.com', 'ada@example.com']);
        assert.match(sentEmails[0].message, /Please help me with my event booking/);
      });
    });

    await context.test('contact API returns only configured support contact details', async () => {
      const database = createContactDatabase({
        settings: [
          { setting_key: 'support_email', setting_value: 'help@eventhub.test' },
          { setting_key: 'support_phone', setting_value: '+1 555 0100' },
          { setting_key: 'support_address', setting_value: '' },
          { setting_key: 'support_hours', setting_value: '' },
          { setting_key: 'social_links', setting_value: '[{"label":"Profile","url":"https://social.example/profile"}]' },
        ],
      });
      await withContactServer(createContactApp(database), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/contact`);

        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).data.contact, {
          email: 'help@eventhub.test',
          phone: '+1 555 0100',
          address: '',
          hours: '',
          socials: [{ label: 'Profile', url: 'https://social.example/profile' }],
        });
      });
    });

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.match(result.data.reference, /^EH-[0-9A-F]{24}$/);
    assert.equal('id' in result.data, false);
    assert.deepEqual(result.data.email, { administrator: 'not_configured', customer: 'not_configured' });
    assert.equal(database.messages.length, 1);
    assert.equal(database.messages[0].email, 'ada@example.com');
  });
});

test('contact API validates inputs and returns a generic database error without losing privacy', async () => {
  const database = createContactDatabase();
  await withContactServer(createContactApp(database), async (baseUrl) => {
    const invalidResponse = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validContactMessage, email: 'invalid' }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(database.messages.length, 0);

    database.execute = async (statement) => {
      if (statement.startsWith('SELECT setting_key, setting_value')) return [[], []];
      if (statement.startsWith('INSERT INTO contact_messages')) throw new Error('private database details');
      throw new Error(`Unexpected contact test query: ${statement}`);
    };
    const previousError = console.error;
    console.error = () => {};
    try {
      const failedResponse = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validContactMessage),
      });
      assert.equal(failedResponse.status, 500);
      assert.doesNotMatch(await failedResponse.text(), /private database details/);
    } finally {
      console.error = previousError;
    }
  });
});

test('contact notification email failures do not discard saved messages', async () => {
  const database = createContactDatabase({ admins: ['admin@example.com'] });
  const previousError = console.error;
  console.error = () => {};
  try {
    await withContactServer(createContactApp(database, {
      emailConfigured: true,
      emailSender: async () => { throw Object.assign(new Error('SMTP credentials'), { code: 'SMTP_REJECTED' }); },
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validContactMessage),
      });

      assert.equal(response.status, 201);
      assert.equal(database.messages.length, 1);
      assert.deepEqual((await response.json()).data.email, { administrator: 'failed', customer: 'failed' });
    });
  } finally {
    console.error = previousError;
  }
});

test('administrator inbox is protected and supports reply delivery and archiving', async () => {
  const database = createContactDatabase({
    admins: ['admin@example.com'],
    messages: [{
      id: 1,
      reference_id: 'EH-000000000001',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: null,
      subject: 'Event support',
      inquiry_type: 'general_inquiry',
      message: 'Please help me with my event booking.',
      status: 'new',
      admin_reply: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
    }],
  });
  const sentEmails = [];
  await withContactServer(createContactApp(database, {
    emailConfigured: true,
    emailSender: async (message) => { sentEmails.push(message); },
  }), async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/admin/contact`);
    assert.equal(denied.status, 401);

    const headers = { 'content-type': 'application/json', cookie: 'admin_session=test-session' };
    const inbox = await fetch(`${baseUrl}/api/admin/contact`, { headers });
    assert.equal(inbox.status, 200);
    assert.equal((await inbox.json()).data[0].email, 'ada@example.com');

    const markedRead = await fetch(`${baseUrl}/api/admin/contact/1/read`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ read: true }),
    });
    assert.equal(markedRead.status, 200);
    assert.ok(database.messages[0].read_at);

    const reply = await fetch(`${baseUrl}/api/admin/contact/1/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'replied', admin_reply: 'We can help with that.' }),
    });
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).data.email, 'sent');
    assert.equal(sentEmails[0].email, 'ada@example.com');
    assert.equal(database.messages[0].admin_reply, 'We can help with that.');

    const archived = await fetch(`${baseUrl}/api/admin/contact/1/archive`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(archived.status, 200);
    assert.ok(database.messages[0].archived_at);
  });
});

test('contact submissions are rate limited', async () => {
  const database = createContactDatabase();
  await withContactServer(createContactApp(database), async (baseUrl) => {
    let response;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await fetch(`${baseUrl}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validContactMessage),
      });
    }
    assert.equal(response.status, 429);
  });
});
