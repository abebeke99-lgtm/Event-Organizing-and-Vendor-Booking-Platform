import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';

test('PostgreSQL admin contact routes are mounted, authorized, and use native queries', async () => {
  const statements = [];
  const transactions = [];
  let auditFailure = false;
  const message = {
    id: 7,
    reference_id: 'EH-000000000007',
    full_name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: null,
    subject: 'Event support',
    inquiry_type: 'general_inquiry',
    message: 'Please help me with my event booking.',
    status: 'new',
    admin_reply: null,
    reviewed_at: null,
    read_at: null,
    read_status: 'unread',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived_at: null,
    user_name: null,
  };
  const database = {
    dialect: 'postgres',
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM system_settings')) return { rows: [] };
      if (sql.includes('FROM users u') && sql.includes('STRING_AGG')) {
        return { rows: [{ id: 2, full_name: 'Admin', email: 'admin@example.com', status: 'active', roles: 'admin' }] };
      }
      if (sql.startsWith('SELECT COUNT(*) AS total FROM contact_messages')) {
        return { rows: [{ total: '1' }] };
      }
      if (sql.startsWith('SELECT m.id, m.reference_id')) {
        return { rows: [message] };
      }
      if (sql.startsWith('SELECT full_name, email, subject, admin_reply')) {
        return { rows: [message] };
      }
      if (sql.startsWith('UPDATE contact_messages SET read_at')) {
        return { rows: [{ id: values[1] }] };
      }
      if (sql.startsWith('UPDATE contact_messages') && sql.includes('SET status =')) {
        return { rows: [{ id: values[4] }] };
      }
      if (sql.startsWith('UPDATE contact_messages SET archived_at')) {
        return { rows: [{ id: values[1] }] };
      }
      if (sql.startsWith('DELETE FROM contact_messages')) {
        return { rows: [{ id: values[0] }] };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        if (auditFailure) throw Object.assign(new Error('audit unavailable'), { code: '23514' });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected PostgreSQL contact query: ${sql}`);
    },
    async inTransaction(work) {
      try {
        const result = await work(this);
        transactions.push('commit');
        return result;
      } catch (error) {
        transactions.push('rollback');
        throw error;
      }
    },
  };
  const app = createApp({ database, databaseDialect: 'postgres' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/contact`;
    const denied = await fetch(baseUrl);
    assert.equal(denied.status, 401, JSON.stringify(statements));

    const headers = { 'content-type': 'application/json', cookie: 'admin_session=test-session' };
    const inbox = await fetch(
      `${baseUrl}?page=2&pageSize=10&q=ada&status=new&inquiry_type=general_inquiry&archived=active`,
      { headers },
    );
    assert.equal(inbox.status, 200);
    const inboxPayload = await inbox.json();
    assert.equal(inboxPayload.data[0].email, 'ada@example.com');
    assert.deepEqual(inboxPayload.pagination, { page: 2, pageSize: 10, total: 1 });
    const countQuery = statements.find(({ sql }) => sql.startsWith('SELECT COUNT(*) AS total'));
    assert.deepEqual(countQuery.values, ['%ada%', 'new', 'general_inquiry']);
    const listQuery = statements.find(({ sql }) => sql.startsWith('SELECT m.id, m.reference_id'));
    assert.match(listQuery.sql, /ILIKE \$1/);
    assert.doesNotMatch(listQuery.sql, /\?/);
    assert.deepEqual(listQuery.values, ['%ada%', 'new', 'general_inquiry', 10, 10]);

    const markedRead = await fetch(`${baseUrl}/7/read`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ read: true }),
    });
    assert.equal(markedRead.status, 200);
    assert.deepEqual((await markedRead.json()).data, { id: 7, read: true });

    const status = await fetch(`${baseUrl}/7/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'reviewed' }),
    });
    assert.equal(status.status, 200);
    assert.deepEqual((await status.json()).data, { id: 7, status: 'reviewed', email: 'not_requested' });

    const archived = await fetch(`${baseUrl}/7/archive`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(archived.status, 200);
    assert.deepEqual((await archived.json()).data, { id: 7, archived: true });

    auditFailure = true;
    const previousConsoleError = console.error;
    console.error = () => {};
    let failedArchive;
    try {
      failedArchive = await fetch(`${baseUrl}/7/archive`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      });
    } finally {
      console.error = previousConsoleError;
      auditFailure = false;
    }
    assert.equal(failedArchive.status, 500);
    assert.deepEqual(transactions, ['commit', 'rollback']);

    const deleted = await fetch(`${baseUrl}/7`, { method: 'DELETE', headers });
    assert.equal(deleted.status, 204);
    assert.deepEqual(transactions, ['commit', 'rollback', 'commit']);
    assert.equal(statements.filter(({ sql }) => sql.startsWith('INSERT INTO audit_logs')).length, 3);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
