import '../src/lib/environment.js';
import { createAiProvider } from '../src/services/aiProvider.js';
import { redactSensitiveContent } from '../src/lib/aiChatSecurity.js';

const REQUEST_TIMEOUT_MS = 20_000;

async function runSmokeTest() {
  let aiProvider;
  try {
    aiProvider = createAiProvider();
  } catch {
    console.log('Provider: unavailable');
    console.log('Model: unavailable');
    console.log('Result: failure (invalid AI provider configuration)');
    process.exitCode = 1;
    return;
  }

  console.log(`Provider: ${aiProvider.provider}`);
  console.log(`Model: ${aiProvider.model}`);

  if (!aiProvider.configured) {
    console.log(`Result: failure (selected provider key is ${aiProvider.placeholderKeyDetected ? 'a placeholder' : 'missing'}; configure it in backend/.env)`);
    process.exitCode = 1;
    return;
  }

  try {
    const reply = await aiProvider.generateReply([
      { role: 'user', content: 'Reply briefly: EventHub AI smoke test OK.' },
    ], {
      maxCompletionTokens: 80,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (typeof reply !== 'string' || !reply.trim()) {
      console.log('Result: failure (empty reply)');
      process.exitCode = 1;
      return;
    }

    console.log('Result: success');
    console.log(`Reply: ${redactSensitiveContent(reply).slice(0, 100)}`);
  } catch (error) {
    const status = Number(error?.status);
    console.log(`Result: failure${Number.isInteger(status) ? ` (HTTP ${status})` : ''}`);
    process.exitCode = 1;
  }
}

await runSmokeTest();
