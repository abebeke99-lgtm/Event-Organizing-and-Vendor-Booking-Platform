import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAiChatRouter } from '../src/routes/aiChat.js';
import { createAiProvider, getAiProviderConfiguration } from '../src/services/aiProvider.js';

const providers = [
  {
    name: 'openai',
    keyName: 'OPENAI_API_KEY',
    defaultModel: 'gpt-6.2-sol',
    placeholder: 'your_openai_api_key_here',
    validKey: 'sk-proj-abcdef1234567890',
    model: 'gpt-test',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    response: { choices: [{ message: { content: 'OpenAI reply' } }] },
    getReply: (reply) => reply.choices[0].message.content,
  },
  {
    name: 'gemini',
    keyName: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash-lite',
    placeholder: 'your_gemini_api_key_here',
    validKey: 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz012345678',
    model: 'gemini-test',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    response: { candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }] },
    getReply: (reply) => reply.candidates[0].content.parts[0].text,
  },
  {
    name: 'groq',
    keyName: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    placeholder: 'gsk_placeholder_key',
    validKey: 'gsk_0123456789abcdef0123456789abcdef',
    model: 'groq-test',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    response: { choices: [{ message: { content: 'Groq reply' } }] },
    getReply: (reply) => reply.choices[0].message.content,
  },
];

for (const provider of providers) {
  test(`${provider.name} reports missing and placeholder keys as unconfigured`, () => {
    const missing = getAiProviderConfiguration({ AI_PROVIDER: provider.name });
    assert.equal(missing.configured, false);
    assert.equal(missing.keyName, provider.keyName);
    assert.equal(missing.placeholderKeyDetected, false);
    assert.equal(missing.model, provider.defaultModel);

    const placeholder = getAiProviderConfiguration({
      AI_PROVIDER: provider.name,
      [provider.keyName]: provider.placeholder,
    });
    assert.equal(placeholder.configured, false);
    assert.equal(placeholder.placeholderKeyDetected, true);
    assert.equal(placeholder.apiKey, null);
  });

  test(`${provider.name} uses a valid-looking key for mocked requests`, async () => {
    let requestUrl;
    let requestOptions;
    const ai = createAiProvider({
      environment: {
        AI_PROVIDER: provider.name,
        AI_MODEL: provider.model,
        [provider.keyName]: provider.validKey,
      },
      fetchImpl: async (url, options) => {
        requestUrl = url;
        requestOptions = options;
        return {
          ok: true,
          async json() {
            return provider.response;
          },
        };
      },
    });

    assert.equal(ai.configured, true);
    assert.equal(ai.provider, provider.name);
    assert.equal(ai.model, provider.model);
    assert.equal(Object.hasOwn(ai, 'apiKey'), false);
    assert.equal(await ai.generateReply([{ role: 'user', content: 'Hello' }]), provider.getReply(provider.response));
    assert.equal(requestUrl, provider.endpoint);
    assert.equal(requestOptions.method, 'POST');
    assert.equal(requestOptions.headers['Content-Type'], 'application/json');
    if (provider.name === 'gemini') {
      assert.equal(requestOptions.headers['x-goog-api-key'], provider.validKey);
    } else {
      assert.equal(requestOptions.headers.Authorization, `Bearer ${provider.validKey}`);
    }
    assert.equal(JSON.parse(requestOptions.body).model, provider.name === 'gemini' ? undefined : provider.model);
  });
}

test('unconfigured providers reject generation with a 503 without making a network request', async () => {
  for (const provider of providers) {
    let requestMade = false;
    const ai = createAiProvider({
      environment: { AI_PROVIDER: provider.name },
      fetchImpl: async () => {
        requestMade = true;
        throw new Error('Fetch must not be called for a missing key.');
      },
    });

    await assert.rejects(ai.generateReply([{ role: 'user', content: 'Hello' }]), { status: 503 });
    assert.equal(requestMade, false);
  }
});

test('provider requests abort when their configured timeout elapses', async () => {
  const provider = providers[0];
  const ai = createAiProvider({
    environment: {
      AI_PROVIDER: provider.name,
      [provider.keyName]: provider.validKey,
    },
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });

  const pendingRequest = ai.generateReply([{ role: 'user', content: 'Hello' }], { timeout: 10 });
  const expectedTimeout = assert.rejects(pendingRequest, { name: 'TimeoutError' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  await expectedTimeout;
});

test('AI health reports the selected provider and configuration without exposing keys', async () => {
  const environmentNames = ['AI_PROVIDER', 'AI_MODEL', ...providers.map(({ keyName }) => keyName)];
  const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const displayNames = { openai: 'OpenAI', gemini: 'Gemini', groq: 'Groq' };
  try {
    for (const provider of providers) {
      process.env.AI_PROVIDER = provider.name;
      process.env.AI_MODEL = provider.model;
      for (const { keyName } of providers) delete process.env[keyName];
      process.env[provider.keyName] = provider.validKey;

      const app = express();
      app.use('/api/ai', createAiChatRouter({
        providerFetch: async () => ({
          ok: true,
          async json() {
            return provider.response;
          },
        }),
      }));
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/health`);
        assert.equal(response.status, 200);
        const health = await response.json();
        assert.equal(health.configured, true);
        assert.equal(health.provider, displayNames[provider.name]);
        assert.equal(health.online, true);
        assert.equal(JSON.stringify(health).includes(provider.validKey), false);
      } finally {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }

      delete process.env[provider.keyName];
      const unconfiguredApp = express();
      unconfiguredApp.use('/api/ai', createAiChatRouter({
        providerFetch: async () => {
          throw new Error('Unconfigured health checks must not make network requests.');
        },
      }));
      const unconfiguredServer = unconfiguredApp.listen(0, '127.0.0.1');
      await once(unconfiguredServer, 'listening');
      try {
        const response = await fetch(`http://127.0.0.1:${unconfiguredServer.address().port}/api/ai/health`);
        const health = await response.json();
        assert.equal(health.configured, false);
        assert.equal(health.provider, displayNames[provider.name]);
      } finally {
        await new Promise((resolve, reject) => {
          unconfiguredServer.close((error) => error ? reject(error) : resolve());
          unconfiguredServer.closeAllConnections();
        });
      }
    }
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

async function postChat(fetchImpl, messages = [{ role: 'user', content: 'Find an event' }]) {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', createAiChatRouter({
    providerFetch: fetchImpl,
    loadContext: async () => ({ events: [], vendors: [], services: [], categories: [] }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
  } finally {
    await new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
      server.closeAllConnections();
    });
  }
}

async function withOpenAiConfiguration(callback, key = 'mock-provider-test-key') {
  const names = ['AI_PROVIDER', 'AI_MODEL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];
  const originalEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.AI_PROVIDER = 'openai';
  process.env.AI_MODEL = 'gpt-test';
  process.env.OPENAI_API_KEY = key;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('public chat maps provider auth, quota, timeout, and network failures without leaking upstream data', async () => {
  await withOpenAiConfiguration(async () => {
    for (const [status, expected, providerBody] of [
      [401, 502, 'private invalid key response'],
      [403, 502, 'private permission response'],
      [429, 429, 'private quota response'],
    ]) {
      let bodyRead = false;
      const response = await postChat(async () => ({
        ok: false,
        status,
        headers: new Headers(),
        async json() {
          bodyRead = true;
          return { error: { message: providerBody } };
        },
      }));
      const responseBody = response.body;
      assert.equal(response.status, expected);
      assert.equal(responseBody.includes(providerBody), false);
      assert.equal(bodyRead, false);
      if (status === 429) assert.match(responseBody, /try again later/i);
      if (status === 401 || status === 403) assert.match(responseBody, /configured credentials/i);
    }

    const networkFailure = await postChat(async () => {
      throw new Error('private network response with mock-provider-test-key');
    });
    assert.equal(networkFailure.status, 502);
    assert.doesNotMatch(networkFailure.body, /private network response|mock-provider-test-key/);

    const timeoutFailure = await postChat(async () => {
      throw Object.assign(new Error('private timeout details'), { name: 'TimeoutError' });
    });
    assert.equal(timeoutFailure.status, 504);
    assert.doesNotMatch(timeoutFailure.body, /private timeout details/);
  });
});

test('public chat returns 503 without calling the provider when the key is unconfigured', async () => {
  await withOpenAiConfiguration(async () => {
    let requestMade = false;
    const response = await postChat(async () => {
      requestMade = true;
      throw new Error('Must not call an unconfigured provider.');
    });
    assert.equal(response.status, 503);
    assert.match(response.body, /not configured/i);
    assert.equal(requestMade, false);
  }, '');
});

test('public chat rejects messages over 1000 characters and histories over 10 messages', async () => {
  await withOpenAiConfiguration(async () => {
    let requestMade = false;
    const fetchImpl = async () => {
      requestMade = true;
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: 'Mock reply' } }] };
        },
      };
    };
    const tooLong = await postChat(fetchImpl, [{ role: 'user', content: 'x'.repeat(1001) }]);
    const tooMany = await postChat(fetchImpl, Array.from({ length: 11 }, (_, index) => ({
      role: index === 10 ? 'user' : 'assistant',
      content: 'Hello',
    })));
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body, /no longer than 1000 characters/);
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body, /up to 10 messages/);
    assert.equal(requestMade, false);
  });
});

test('public chat is limited to 20 requests per minute per IP', async () => {
  await withOpenAiConfiguration(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai', createAiChatRouter({
      providerFetch: async () => ({
        ok: true,
        async json() {
          return { choices: [{ message: { content: 'Mock reply' } }] };
        },
      }),
      loadContext: async () => ({ events: [], vendors: [], services: [], categories: [] }),
    }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      let response;
      for (let attempt = 0; attempt < 21; attempt += 1) {
        response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'Find an event' }] }),
        });
      }
      const responseStatus = response.status;
      const responseBody = await response.text();
      assert.equal(responseStatus, 429);
      assert.match(JSON.parse(responseBody).error, /too many ai requests/i);
    } finally {
      await new Promise((resolveClose, reject) => {
        server.close((error) => error ? reject(error) : resolveClose());
        server.closeAllConnections();
      });
    }
  });
});

test('AI smoke test reports missing keys without printing environment values', () => {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'aiSmokeTest.js');
  const result = spawnSync(process.execPath, [script], {
    cwd: resolve(process.cwd()),
    encoding: 'utf8',
    env: {
      ...process.env,
      AI_PROVIDER: 'groq',
      GROQ_API_KEY: 'your_groq_api_key_here',
    },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /Provider: groq/);
  assert.match(output, /Model: openai\/gpt-oss-120b/);
  assert.match(output, /key is a placeholder/);
  assert.doesNotMatch(output, /your_groq_api_key_here/);
});
