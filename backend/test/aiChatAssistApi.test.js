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

const originalApiKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = 'mock-openai-client-key';
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
process.env.OPENAI_API_KEY = '';
const unconfiguredApp = createApp({ database });
process.env.OPENAI_API_KEY = 'sk-placeholder';
const placeholderApp = createApp({ database });
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
placeholderApp.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
const server = app.listen(0, '127.0.0.1');
const unconfiguredServer = unconfiguredApp.listen(0, '127.0.0.1');
const placeholderServer = placeholderApp.listen(0, '127.0.0.1');
let baseUrl;
let unconfiguredBaseUrl;
let placeholderBaseUrl;

before(async () => {
  await Promise.all([server, unconfiguredServer, placeholderServer].map((instance) => (
    instance.listening ? Promise.resolve() : once(instance, 'listening')
  )));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  unconfiguredBaseUrl = `http://127.0.0.1:${unconfiguredServer.address().port}`;
  placeholderBaseUrl = `http://127.0.0.1:${placeholderServer.address().port}`;
});

after(async () => {
  await Promise.all([server, unconfiguredServer, placeholderServer].map((instance) => (
    new Promise((resolve, reject) => {
      instance.close((error) => error ? reject(error) : resolve());
      instance.closeAllConnections();
    })
  )));
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
  const status = await response.json();
  assert.deepEqual(status, {
    data: {
      configured: true,
      placeholderKeyDetected: false,
      validApiKey: 'configured',
      providerOnline: false,
      liveChatVerified: false,
    },
  });
  assert.equal(JSON.stringify(status).includes('OPENAI_API_KEY'), false);
});

test('public health check verifies a bounded provider completion and caches success briefly', async () => {
  const before = completionRequests.length;
  const onlineResponse = await request('/api/ai/health');
  assert.equal(onlineResponse.status, 200);
  assert.deepEqual(await onlineResponse.json(), {
    configured: true,
    online: true,
    provider: 'OpenAI',
    verification: 'VERIFIED',
    placeholderKeyDetected: false,
    validApiKey: 'configured',
    liveChatVerified: false,
  });
  assert.equal(completionRequests.length, before + 1);
  assert.equal(completionRequests.at(-1).messages.at(-1).content, 'Reply with the single word OK.');
  assert.equal(completionOptions.at(-1).timeout, 5000);

  const cachedResponse = await request('/api/ai/health');
  assert.deepEqual(await cachedResponse.json(), {
    configured: true,
    online: true,
    provider: 'OpenAI',
    verification: 'VERIFIED',
    placeholderKeyDetected: false,
    validApiKey: 'configured',
    liveChatVerified: false,
  });
  assert.equal(completionRequests.length, before + 1);

  const offlineResponse = await request('/api/ai/health', { base: unconfiguredBaseUrl });
  assert.equal(offlineResponse.status, 200);
  assert.deepEqual(await offlineResponse.json(), {
    configured: false,
    online: false,
    provider: 'OpenAI',
    verification: 'NOT_VERIFIED',
    placeholderKeyDetected: false,
    validApiKey: 'missing',
    liveChatVerified: false,
  });
});

test('provider health reports offline when a real completion probe fails', async () => {
  let probeCount = 0;
  const probeApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'mock-openai-client-key';
  const probeApp = createApp({
    database,
    aiClient: {
      chat: {
        completions: {
          async create() {
            probeCount += 1;
            throw Object.assign(new Error('private provider details'), {
              status: 429,
              code: 'rate_limit_exceeded',
            });
          },
        },
      },
    },
  });
  if (probeApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = probeApiKey;
  probeApp.locals.platformSettingsCache = {
    values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
    expiresAt: Date.now() + 60_000,
  };
  const probeServer = probeApp.listen(0, '127.0.0.1');
  await once(probeServer, 'listening');
  try {
    const url = `http://127.0.0.1:${probeServer.address().port}/api/ai/health`;
    const first = await fetch(url);
    assert.deepEqual(await first.json(), {
      configured: true,
      online: false,
      provider: 'OpenAI',
      verification: 'NOT_VERIFIED',
      placeholderKeyDetected: false,
      validApiKey: 'configured',
      liveChatVerified: false,
    });
    const cached = await fetch(url);
    assert.deepEqual(await cached.json(), {
      configured: true,
      online: false,
      provider: 'OpenAI',
      verification: 'NOT_VERIFIED',
      placeholderKeyDetected: false,
      validApiKey: 'configured',
      liveChatVerified: false,
    });
    assert.equal(probeCount, 1);
  } finally {
    await new Promise((resolve, reject) => {
      probeServer.close((error) => error ? reject(error) : resolve());
      probeServer.closeAllConnections();
    });
  }
});

test('missing backend key reports unavailable and never returns a fabricated answer', async () => {
  const status = await request('/api/ai/status', { base: unconfiguredBaseUrl });
  assert.deepEqual(await status.json(), {
    data: {
      configured: false,
      placeholderKeyDetected: false,
      validApiKey: 'missing',
      providerOnline: false,
      liveChatVerified: false,
    },
  });
  const health = await request('/api/ai/health', { base: unconfiguredBaseUrl });
  assert.deepEqual(await health.json(), {
    configured: false,
    online: false,
    provider: 'OpenAI',
    verification: 'NOT_VERIFIED',
    placeholderKeyDetected: false,
    validApiKey: 'missing',
    liveChatVerified: false,
  });
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

test('placeholder key is detected but never classified as configured', async () => {
  const statusResponse = await request('/api/ai/status', { base: placeholderBaseUrl });
  assert.deepEqual(await statusResponse.json(), {
    data: {
      configured: false,
      placeholderKeyDetected: true,
      validApiKey: 'missing',
      providerOnline: false,
      liveChatVerified: false,
    },
  });
  const healthResponse = await request('/api/ai/health', { base: placeholderBaseUrl });
  assert.deepEqual(await healthResponse.json(), {
    configured: false,
    online: false,
    provider: 'OpenAI',
    verification: 'NOT_VERIFIED',
    placeholderKeyDetected: true,
    validApiKey: 'missing',
    liveChatVerified: false,
  });
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
  const statusResponse = await request('/api/ai/status');
  assert.equal((await statusResponse.json()).data.liveChatVerified, true);
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

test('invalid keys, rate limits, timeouts, and network failures are surfaced safely', async () => {
  const failures = [
    {
      failure: { status: 401, code: 'invalid_api_key' },
      expectedStatus: 503,
      expectedMessage: 'OpenAI rejected the server API key.',
      validApiKey: 'invalid',
    },
    {
      failure: { status: 429, code: 'rate_limit_exceeded' },
      expectedStatus: 429,
      expectedMessage: 'OpenAI is rate limiting requests.',
      validApiKey: 'configured',
    },
    {
      failure: { name: 'TimeoutError' },
      expectedStatus: 504,
      expectedMessage: 'took too long',
      validApiKey: 'configured',
    },
    {
      failure: { name: 'APIConnectionError' },
      expectedStatus: 503,
      expectedMessage: 'Could not reach OpenAI.',
      validApiKey: 'configured',
    },
  ];

  for (const { failure, expectedStatus, expectedMessage, validApiKey } of failures) {
    completionError = null;
    const health = await request('/api/ai/health');
    assert.equal((await health.json()).online, true);
    completionError = Object.assign(new Error('private upstream details OPENAI_API_KEY=secret-value'), failure);
    try {
      const response = await request('/api/ai/chat', {
        method: 'POST',
        body: { messages: [{ role: 'user', content: 'Test provider failure handling' }] },
      });
      assert.equal(response.status, expectedStatus);
      const body = await response.text();
      assert.match(body, new RegExp(expectedMessage));
      assert.equal(body.includes('secret-value'), false);
      const status = await request('/api/ai/status');
      assert.equal((await status.json()).data.validApiKey, validApiKey);
    } finally {
      completionError = null;
    }
  }
});
