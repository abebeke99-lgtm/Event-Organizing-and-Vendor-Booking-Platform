import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';
import { toPostgresAiChatStatement } from '../src/routes/aiChat.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

test('Neon PostgreSQL AI conversation queries run in a rolled-back isolated transaction', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const rollback = new Error('ROLLBACK_NEON_AI_CHAT_FIXTURES');
  const email = `ai-chat-integration-${randomUUID()}@example.invalid`;

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.equal(identity.database_name, 'eventhub');
    const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/status`);
      assert.equal(response.status, 200);
      assert.equal(typeof (await response.json()).data.configured, 'boolean');
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    await assert.rejects(database.inTransaction(async (client) => {
      const user = (await client.query(
        `INSERT INTO users (full_name, email, password_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        ['AI chat integration fixture', email, 'synthetic-not-a-login-hash'],
      )).rows[0];
      const title = `AI integration ${randomUUID()}`;
      const insertConversation = toPostgresAiChatStatement(
        'INSERT INTO ai_conversations (user_id, title, model) VALUES (?, ?, ?)',
        [user.id, title, 'gpt-4o-mini'],
      );
      const conversationId = (await client.query(
        insertConversation.statement,
        insertConversation.values,
      )).rows[0].id;

      for (const [role, content, model] of [
        ['user', 'Help plan an event', null],
        ['assistant', 'Start with the guest list.', 'gpt-4o-mini'],
      ]) {
        const insertMessage = toPostgresAiChatStatement(
          'INSERT INTO ai_messages (conversation_id, role, content, model) VALUES (?, ?, ?, ?)',
          [conversationId, role, content, model],
        );
        assert.ok((await client.query(insertMessage.statement, insertMessage.values)).rows[0].id);
      }

      const list = toPostgresAiChatStatement(
        `SELECT c.id FROM ai_conversations c
         WHERE c.user_id = ? AND c.is_archived = ?
           AND (? = '' OR c.title LIKE ?)
         ORDER BY c.is_pinned DESC, c.updated_at DESC, c.id DESC LIMIT 100`,
        [user.id, false, title, `%${title}%`],
      );
      assert.deepEqual((await client.query(list.statement, list.values)).rows.map((row) => row.id), [conversationId]);

      const update = toPostgresAiChatStatement(
        `UPDATE ai_conversations SET model = ?, title = IF(title = 'New chat', ?, title)
         WHERE id = ? AND user_id = ?`,
        ['gpt-4o-mini', 'Updated title', conversationId, user.id],
      );
      assert.equal((await client.query(update.statement, update.values)).rowCount, 1);
      const archive = toPostgresAiChatStatement(
        `UPDATE ai_conversations
         SET is_archived = COALESCE(?, is_archived)
         WHERE id = ? AND user_id = ?`,
        [true, conversationId, user.id],
      );
      assert.equal((await client.query(archive.statement, archive.values)).rowCount, 1);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    await database.close();
  }
});
