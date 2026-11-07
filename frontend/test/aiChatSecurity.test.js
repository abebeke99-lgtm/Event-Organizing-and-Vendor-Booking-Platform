import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactAiChatSecrets } from '../src/aiChatSecurity.js';

test('AI chat display redacts synthetic API keys, assignments, tokens, and database credentials', () => {
  const content = [
    'OPENAI_API_KEY=sk-test-12345678901234567890',
    'Authorization: Bearer synthetic.access.token',
    'mysql://eventhub:synthetic-password@localhost/eventhub',
    'SESSION_COOKIE=synthetic-session-value',
  ].join('\n');

  const redacted = redactAiChatSecrets(content);
  assert.equal(redacted.includes('sk-test-12345678901234567890'), false);
  assert.equal(redacted.includes('synthetic.access.token'), false);
  assert.equal(redacted.includes('synthetic-password'), false);
  assert.equal(redacted.includes('synthetic-session-value'), false);
});

test('AI chat display leaves ordinary event-planning text unchanged', () => {
  const content = 'Help me plan a wedding reception for 80 guests.';
  assert.equal(redactAiChatSecrets(content), content);
});
