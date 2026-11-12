import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getOpenAiApiKey, getOpenAiApiKeyStatus } from '../src/lib/openaiConfig.js';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendDirectory, '..');

test('OpenAI API key configuration rejects missing and example placeholders', () => {
  for (const value of [
    '',
    '   ',
    'your_openai_api_key',
    'your_api_key_here',
    'replace-with-your-key',
    'replace_me',
    'replace_with_your_real_openai_api_key',
    'sk-placeholder',
    'sk-placeholder-12345',
    'sk-example',
    'sk-proj-...',
    'example-api-key',
    'placeholder',
    '<api-key>',
  ]) {
    assert.equal(getOpenAiApiKey({ OPENAI_API_KEY: value }), null);
  }
  assert.deepEqual(getOpenAiApiKeyStatus({ OPENAI_API_KEY: 'sk-placeholder' }), {
    placeholderKeyDetected: true,
    validApiKey: 'missing',
  });
});

test('OpenAI API key configuration trims a real-looking secret without logging it', () => {
  assert.equal(getOpenAiApiKey({ OPENAI_API_KEY: '  sk-proj-abcdef1234567890  ' }), 'sk-proj-abcdef1234567890');
  assert.deepEqual(getOpenAiApiKeyStatus({ OPENAI_API_KEY: 'sk-proj-abcdef1234567890' }), {
    placeholderKeyDetected: false,
    validApiKey: 'configured',
  });
});

test('backend environment loads from the repository root and backend workspace', () => {
  const configUrl = pathToFileURL(resolve(backendDirectory, 'src', 'lib', 'openaiConfig.js')).href;
  const source = `import { getOpenAiApiKey } from ${JSON.stringify(configUrl)};
const key = process.env.OPENAI_API_KEY?.trim();
console.log(JSON.stringify({
  loaded: Boolean(key),
  placeholder: key === 'replace_with_your_real_openai_api_key',
  configured: Boolean(getOpenAiApiKey()),
}));`;

  for (const cwd of [repositoryRoot, backendDirectory]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: '' },
    });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.loaded, true);
    assert.equal(report.configured, !report.placeholder);
  }
});

test('a deployment process key takes precedence over the backend env file', () => {
  const configUrl = pathToFileURL(resolve(backendDirectory, 'src', 'lib', 'openaiConfig.js')).href;
  const source = `import { getOpenAiApiKey, getOpenAiApiKeyStatus } from ${JSON.stringify(configUrl)};
const key = getOpenAiApiKey();
console.log(JSON.stringify({
  processValueWon: key === 'runtime-value-for-precedence-test',
  placeholderKeyDetected: getOpenAiApiKeyStatus().placeholderKeyDetected,
}));`;

  for (const cwd of [repositoryRoot, backendDirectory]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: 'runtime-value-for-precedence-test' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      processValueWon: true,
      placeholderKeyDetected: false,
    });
  }
});

test('backend startup script loads its environment from both supported working directories', () => {
  const startScript = resolve(backendDirectory, 'scripts', 'start.js');

  for (const cwd of [repositoryRoot, backendDirectory]) {
    const result = spawnSync(process.execPath, [startScript], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OPENAI_API_KEY: '',
        PORT: 'invalid',
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1, output);
    assert.match(output, /PORT must be an integer between 1 and 65535\./);
    assert.doesNotMatch(output, /Database connected\./);
  }
});
