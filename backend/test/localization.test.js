import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRequestLanguage,
  localizeResponseBody,
  localizationMiddleware,
  normalizeLanguage,
  translateMessage,
} from '../src/lib/localization.js';

const backendSourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

async function getJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return getJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

test('normalizes supported locale tags and safely falls back for unsupported locales', () => {
  assert.equal(normalizeLanguage('am-ET'), 'am');
  assert.equal(normalizeLanguage('EN_us'), 'en');
  assert.equal(normalizeLanguage('fr-FR'), 'en');
  assert.equal(normalizeLanguage(undefined), 'en');
});

test('translates known backend messages and keeps unknown messages unchanged', () => {
  assert.equal(translateMessage('Authentication required.', 'am'), 'ማረጋገጫ ያስፈልጋል።');
  assert.equal(translateMessage('An unregistered response.', 'am'), 'An unregistered response.');
  assert.equal(translateMessage('Authentication required.', 'en'), 'Authentication required.');
});

test('localizes response errors and validation details without mutating API payloads', () => {
  const body = {
    error: 'Invalid email or password.',
    details: [{ message: 'Enter a valid email address.', path: ['email'] }],
    data: { id: 12, status: 'active' },
  };
  const result = localizeResponseBody(body, 'am');
  assert.notEqual(result, body);
  assert.equal(result.error, 'ኢሜይሉ ወይም የይለፍ ቃሉ ትክክል አይደለም።');
  assert.equal(result.details[0].message, 'ትክክለኛ የኢሜይል አድራሻ ያስገቡ።');
  assert.equal(result.details[0].path, body.details[0].path);
  assert.equal(result.data, body.data);
  assert.equal(body.error, 'Invalid email or password.');
});

test('authenticated preference takes precedence over language headers', () => {
  assert.equal(getRequestLanguage({
    user: { preferred_language: 'am' },
    headers: { 'accept-language': 'en-US' },
  }), 'am');
  assert.equal(getRequestLanguage({ headers: { 'accept-language': 'fr-FR,am-ET;q=0.8,en;q=0.6' } }), 'am');
});

test('middleware localizes JSON after authentication and preserves unknown payloads', () => {
  const req = { headers: { 'accept-language': 'en' }, user: { preferred_language: 'am' } };
  let responseBody;
  const res = {
    json(body) {
      responseBody = body;
      return body;
    },
  };

  localizationMiddleware(req, res, () => {});
  res.json({ message: 'Profile photo saved.', value: 'active' });
  assert.equal(responseBody.message, 'የመገለጫ ፎቶው ተቀምጧል።');
  assert.equal(responseBody.value, 'active');
  assert.equal(req.t('Choose a supported language.'), 'የሚደገፍ ቋንቋ ይምረጡ።');
});

test('all static backend error and message literals have Amharic translations', async () => {
  const sourceFiles = await getJavaScriptFiles(backendSourceRoot);
  const userMessagePattern = /\b(?:error|message):\s*(?:'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)")/g;
  const missingMessages = [];

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    if (!/\bres\.(?:status|json|send)\s*\(/.test(source)) continue;
    for (const match of source.matchAll(userMessagePattern)) {
      const message = match[1] ?? match[2];
      if (translateMessage(message, 'am') === message) missingMessages.push(`${file}: ${message}`);
    }
  }

  assert.deepEqual(missingMessages, []);
});
