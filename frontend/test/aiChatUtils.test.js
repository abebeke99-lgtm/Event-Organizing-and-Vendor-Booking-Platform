import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatMessageContent,
  isSupportedChatTextFile,
  MAX_CHAT_FILE_BYTES,
  parseSseEvent,
} from '../src/aiChatUtils.js';

test('text attachments are validated and unsupported images are rejected', () => {
  assert.equal(isSupportedChatTextFile({ name: 'plan.md', type: '', size: 12 }), true);
  assert.equal(isSupportedChatTextFile({ name: 'plan.exe', type: 'application/octet-stream', size: 12 }), false);
  assert.equal(isSupportedChatTextFile({ name: 'photo.png', type: 'image/png', size: 12 }), false);
  assert.equal(isSupportedChatTextFile({ name: 'plan.txt', type: 'text/plain', size: MAX_CHAT_FILE_BYTES }), true);
  assert.equal(isSupportedChatTextFile({ name: 'large.txt', type: 'text/plain', size: MAX_CHAT_FILE_BYTES + 1 }), false);
});

test('attached file content is included in the actual persisted chat message body', () => {
  assert.equal(
    buildChatMessageContent('Summarize this', { name: 'brief.txt', text: 'Guest count: 40' }),
    'Summarize this\n\n[Attached text file: brief.txt]\nGuest count: 40',
  );
  assert.equal(buildChatMessageContent('', null), '');
});

test('SSE parser extracts JSON deltas and rejects malformed events', () => {
  assert.deepEqual(parseSseEvent('event: delta\ndata: {"delta":"hello"}'), {
    event: 'delta',
    data: { delta: 'hello' },
  });
  assert.equal(parseSseEvent('comment: keepalive'), null);
  assert.throws(() => parseSseEvent('event: delta\ndata: {invalid'), /could not be read/);
});
