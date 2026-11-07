import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const sessionToken = 'ai-chat-assist-test-session';
const customer = {
  id: 17,
  full_name: 'AI Assistant Test Customer',
  email: 'ai-assist-test@example.test',
  phone: null,
  preferred_language: 'en',
  status: 'active',
  role: 'customer',
  permission_keys: '',
};
const completionRequests = [];
const completionOptions = [];
let completionError = null;
let requestSequence = 0;

const database = {
  async execute(sql, values = []) {
    if (sql.includes('FROM user_sessions s')) {
      return [values[0] === hashToken(sessionToken) ? [customer] : [], []];
    }
    throw new Error(`Unexpected AI assist test SQL: ${sql}`);
  },
};

const aiClient = {
  models: {
    async retrieve(model) {
      return { id: model };
    },
  },
  chat: {
    completions: {
      async create(request, options) {
        completionRequests.push(request);
        completionOptions.push(options);
        if (completionError) throw completionError;
        return { choices: [{ message: { content: 'I found a published service in the EventHub catalogue.' } }] };
      },
    },
  },
};

const app = createApp({
  database,
  aiClient,
  aiChatServices: {
    async loadContext(_database, message) {
      assert.equal(typeof message, 'string');
      return {
        events: [],
        vendors: [],
        services: [{
          id: 31,
          title: 'Published catering service',
          href: '/services/31',
          price: 2500,
          currency: 'ETB',
        }],
        categories: [],
      };
    },
  },
});
const originalApiKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = '';
const unconfiguredApp = createApp({ database });
if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
else process.env.OPENAI_API_KEY = originalApiKey;
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
unconfiguredApp.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
const server = app.listen(0, '127.0.0.1');
const unconfiguredServer = unconfiguredApp.listen(0, '127.0.0.1');
let baseUrl;
let unconfiguredBaseUrl;

before(async () => {
  await Promise.all([server, unconfiguredServer].map((instance) => (
    instance.listening ? Promise.resolve() : once(instance, 'listening')
  )));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  unconfiguredBaseUrl = `http://127.0.0.1:${unconfiguredServer.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await new Promise((resolve, reject) => {
    unconfiguredServer.close((error) => error ? reject(error) : resolve());
    unconfiguredServer.closeAllConnections();
  });
});

async function request(path, { method = 'GET', body, authenticated = false, base = baseUrl } = {}) {
  const headers = { 'X-Forwarded-For': `198.51.100.${(requestSequence++ % 250) + 1}` };
  if (authenticated) headers.Cookie = `platform_session=${sessionToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('public AI status exposes configuration without authentication or secrets', async () => {
  const response = await request('/api/ai/status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { configured: true } });
});

test('public health check is guest-accessible and only reports a configured provider online', async () => {
  const onlineResponse = await request('/api/ai/health');
  assert.equal(onlineResponse.status, 200);
  assert.deepEqual(await onlineResponse.json(), { online: true });

  const offlineResponse = await request('/api/ai/health', { base: unconfiguredBaseUrl });
  assert.equal(offlineResponse.status, 200);
  assert.deepEqual(await offlineResponse.json(), { online: false });
});

test('missing backend key reports unavailable and never returns a fabricated answer', async () => {
  const status = await request('/api/ai/status', { base: unconfiguredBaseUrl });
  assert.deepEqual(await status.json(), { data: { configured: false } });
  const response = await request('/api/ai/assist', {
    method: 'POST',
    body: { message: 'Find an event', language: 'en' },
    base: unconfiguredBaseUrl,
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);

  const chatResponse = await request('/api/ai/chat', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'Find events near me' }] },
    base: unconfiguredBaseUrl,
  });
  assert.equal(chatResponse.status, 503);
  assert.match((await chatResponse.json()).error, /OPENAI_API_KEY/);
});

test('public chat accepts guest messages, grounds the prompt, and returns a reply', async () => {
  const before = completionRequests.length;
  const response = await request('/api/ai/chat', {
    method: 'POST',
    body: {
      messages: [
        { role: 'user', content: 'Find catering' },
        { role: 'assistant', content: 'What kind of event?' },
        { role: 'user', content: 'Find a vendor near me' },
      ],
      location: 'Addis Ababa',
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reply: 'I found a published service in the EventHub catalogue.',
  });
  assert.equal(completionRequests.length, before + 1);
  assert.match(completionRequests.at(-1).messages[0].content, /^You are EventHub AI, an assistant for an event planning and vendor booking platform\./);
  assert.match(completionRequests.at(-1).messages[0].content, /Published catering service/);
  assert.match(completionRequests.at(-1).messages[0].content, /The user is a visitor/);
  assert.match(completionRequests.at(-1).messages[0].content, /Addis Ababa/);
  assert.equal(completionRequests.at(-1).messages.at(-1).content, 'Find a vendor near me');
  assert.equal(completionOptions.at(-1).timeout, 30_000);
});

test('public chat retains authenticated role context for signed-in users', async () => {
  const response = await request('/api/ai/chat', {
    method: 'POST',
    authenticated: true,
    body: { messages: [{ role: 'user', content: 'Help me find an event' }] },
  });
  assert.equal(response.status, 200);
  assert.match(completionRequests.at(-1).messages[0].content, /The user is a customer/);
});

test('visitor assistant grounds answers in public catalogue data and links records', async () => {
  const before = completionRequests.length;
  const response = await request('/api/ai/assist', {
    method: 'POST',
    body: { message: 'Find catering', language: 'en' },
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.content, 'I found a published service in the EventHub catalogue.');
  assert.equal(result.data.references[0].href, '/services/31');
  assert.equal(completionRequests.length, before + 1);
  assert.match(completionRequests.at(-1).messages[0].content, /Requested language: English/);
  assert.match(completionRequests.at(-1).messages[0].content, /Published catering service/);
  assert.match(completionRequests.at(-1).messages[0].content, /The user is a visitor/);
});

test('authenticated assistant applies role-aware instructions and Amharic preference', async () => {
  const response = await request('/api/ai/assist', {
    method: 'POST',
    authenticated: true,
    body: { message: 'Help me find catering', language: 'am' },
  });
  assert.equal(response.status, 200);
  assert.match(completionRequests.at(-1).messages[0].content, /Requested language: Amharic/);
  assert.match(completionRequests.at(-1).messages[0].content, /The user is a customer/);
});

test('assistant validates messages and does not call the provider for invalid input', async () => {
  const before = completionRequests.length;
  const response = await request('/api/ai/assist', { method: 'POST', body: { message: '  ' } });
  assert.equal(response.status, 400);
  assert.equal(completionRequests.length, before);
});

test('public chat validates message count, size, and final user role', async () => {
  const before = completionRequests.length;
  const tooManyMessages = await request('/api/ai/chat', {
    method: 'POST',
    body: { messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'Hello' })) },
  });
  const tooLong = await request('/api/ai/chat', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
  });
  const wrongLastRole = await request('/api/ai/chat', {
    method: 'POST',
    body: { messages: [{ role: 'assistant', content: 'Hello' }] },
  });
  assert.equal(tooManyMessages.status, 400);
  assert.equal(tooLong.status, 400);
  assert.equal(wrongLastRole.status, 400);
  assert.equal(completionRequests.length, before);
});

test('provider failures are returned as errors rather than success-shaped answers', async () => {
  completionError = Object.assign(new Error('provider is unavailable'), { status: 503 });
  try {
    const response = await request('/api/ai/assist', {
      method: 'POST',
      body: { message: 'Find an event' },
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /temporarily unavailable/i);
  } finally {
    completionError = null;
  }
});
