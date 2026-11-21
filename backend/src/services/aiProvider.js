import '../lib/environment.js';

const PROVIDERS = {
  openai: {
    keyName: 'OPENAI_API_KEY',
    defaultModel: 'gpt-6.2-sol',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  gemini: {
    keyName: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash-lite',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
  groq: {
    keyName: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  },
};

const PLACEHOLDER_KEY = /^(?:(?:your|replace|placeholder|change|todo|example|sample|dummy|fake|test)(?:$|[-_\s])|(?:sk-|gsk_|AIza)(?:(?:proj|svcacct)-)?(?:your|replace|placeholder|change|todo|example|sample|dummy|fake|test|x{4,}|\.{3,})(?:$|[-_\s])|<[^>]*>|\$\{[^}]+\}|x{4,}|\.{3,})/i;

export function getAiProviderConfiguration(environment = process.env) {
  const provider = (environment.AI_PROVIDER || 'openai').trim().toLowerCase();
  const definition = PROVIDERS[provider];
  if (!definition) {
    throw new Error('AI_PROVIDER must be one of: openai, gemini, groq.');
  }
  const configuredKey = environment[definition.keyName]?.trim() || null;
  const placeholderKeyDetected = Boolean(configuredKey && PLACEHOLDER_KEY.test(configuredKey));
  const apiKey = placeholderKeyDetected ? null : configuredKey;
  return {
    provider,
    keyName: definition.keyName,
    apiKey,
    configured: Boolean(apiKey),
    placeholderKeyDetected,
    model: (environment.AI_MODEL || (provider === 'openai' && environment.OPENAI_MODEL)
      || definition.defaultModel).trim(),
  };
}

const REQUEST_TIMEOUT_MS = 20_000;

function providerError(provider, response) {
  const error = new Error(`${provider} request failed.`);
  error.providerName = provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Gemini' : 'Groq';
  error.status = response.status;
  error.headers = response.headers;
  return error;
}

function responseText(provider, body) {
  if (provider === 'gemini') {
    return body?.candidates?.[0]?.content?.parts
      ?.map(({ text }) => text || '')
      .join('') || '';
  }
  return body?.choices?.[0]?.message?.content || '';
}

function requestBody(provider, model, messages, maxCompletionTokens, stream = false) {
  if (provider === 'gemini') {
    const system = messages.filter(({ role }) => role === 'system').map(({ content }) => content).join('\n');
    const contents = messages
      .filter(({ role }) => role !== 'system')
      .map(({ role, content }) => ({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      }));
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: maxCompletionTokens },
    };
  }
  return {
    model,
    messages,
    ...(provider === 'groq'
      ? { max_tokens: maxCompletionTokens }
      : { max_completion_tokens: maxCompletionTokens }),
    ...(stream ? { stream: true } : {}),
  };
}

function endpointFor(provider, model, stream = false) {
  if (provider === 'gemini') {
    return `${PROVIDERS.gemini.endpoint}/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  return PROVIDERS[provider].endpoint;
}

async function* readServerSentEvents(body, provider) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        const text = provider === 'gemini'
          ? payload?.candidates?.[0]?.content?.parts?.map(({ text: part }) => part || '').join('')
          : payload?.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) {
          yield { choices: [{ delta: { content: text } }] };
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createAiProvider({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  client = null,
} = {}) {
  const configuration = getAiProviderConfiguration(environment);
  const { provider, apiKey, configured, model } = configuration;

  async function send(messages, {
    selectedModel = model,
    maxCompletionTokens = 1200,
    signal,
    timeout = REQUEST_TIMEOUT_MS,
    stream = false,
  } = {}) {
    if (!configured) {
      const error = new Error(`AI chat is not configured. Set ${configuration.keyName} on the backend.`);
      error.status = 503;
      error.code = 'MISSING_API_KEY';
      throw error;
    }

    if (provider === 'openai' && client?.chat?.completions?.create) {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout);
      return client.chat.completions.create({
        model: selectedModel,
        messages,
        max_completion_tokens: maxCompletionTokens,
        ...(stream ? { stream: true } : {}),
      }, { signal: requestSignal, timeout });
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(provider === 'gemini'
        ? { 'x-goog-api-key': apiKey }
        : { Authorization: `Bearer ${apiKey}` }),
    };
    let response;
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
    try {
      response = await fetchImpl(endpointFor(provider, selectedModel, stream), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody(provider, selectedModel, messages, maxCompletionTokens, stream)),
        signal: requestSignal,
      });
    } catch (cause) {
      if (['AbortError', 'TimeoutError'].includes(cause?.name)) throw cause;
      const error = new Error(`${provider} connection failed.`);
      error.name = 'APIConnectionError';
      throw error;
    }
    if (!response.ok) {
      throw providerError(provider, response);
    }
    return stream ? response.body : response.json();
  }

  return {
    provider,
    model,
    configured,
    placeholderKeyDetected: configuration.placeholderKeyDetected,
    keyName: configuration.keyName,
    async generateReply(messages, options = {}) {
      const result = await send(messages, options);
      if (provider === 'openai' && client?.chat?.completions?.create) {
        return result.choices?.[0]?.message?.content || '';
      }
      return responseText(provider, result);
    },
    async verifyModel(selectedModel, options = {}) {
      if (!configured) throw Object.assign(new Error('AI provider is not configured.'), { status: 503 });
      if (provider === 'openai' && client?.models?.retrieve) {
        return client.models.retrieve(selectedModel, options);
      }
      await this.generateReply([{ role: 'user', content: 'Reply with the single word OK.' }], {
        ...options,
        selectedModel,
        maxCompletionTokens: 8,
      });
    },
    async generateStream(messages, options = {}) {
      const result = await send(messages, { ...options, stream: true });
      if (provider === 'openai' && client?.chat?.completions?.create) return result;
      return readServerSentEvents(result, provider);
    },
  };
}
