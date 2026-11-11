import assert from 'node:assert/strict';
import test from 'node:test';
import { toPostgresAiChatStatement } from '../src/routes/aiChat.js';

test('AI conversation queries use PostgreSQL placeholders and case-insensitive search', () => {
  const values = [7, false, '', '%wedding%'];
  const result = toPostgresAiChatStatement(
    `SELECT c.id FROM ai_conversations c
     WHERE c.user_id = ? AND c.is_archived = ?
       AND (? = '' OR c.title LIKE ?)
     ORDER BY c.updated_at DESC LIMIT 100`,
    values,
  );
  assert.match(result.statement, /c\.user_id = \$1/);
  assert.match(result.statement, /c\.is_archived = \$2/);
  assert.match(result.statement, /c\.title ILIKE \$4/);
  assert.deepEqual(result.values, values);
});

test('AI conversation inserts return generated IDs and MySQL title IF becomes CASE', () => {
  const conversation = toPostgresAiChatStatement(
    'INSERT INTO ai_conversations (user_id, title, model) VALUES (?, ?, ?)',
    [7, 'New chat', 'gpt-4o-mini'],
  );
  assert.equal(
    conversation.statement,
    'INSERT INTO ai_conversations (user_id, title, model) VALUES ($1, $2, $3) RETURNING id',
  );

  const update = toPostgresAiChatStatement(
    `UPDATE ai_conversations SET model = ?, title = IF(title = 'New chat', ?, title)
     WHERE id = ? AND user_id = ?`,
    ['gpt-4o-mini', 'Wedding planning', 45, 7],
  );
  assert.match(update.statement, /title = CASE WHEN title = 'New chat' THEN \$2 ELSE title END/);
  assert.match(update.statement, /WHERE id = \$3 AND user_id = \$4/);
});
