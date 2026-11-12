import './environment.js';

const PLACEHOLDER_API_KEY = /^(?:(?:your|replace|placeholder|change|todo|example|sample|dummy|fake|test)(?:$|[-_\s])|sk-(?:(?:proj|svcacct)-)?(?:your|replace|placeholder|change|todo|example|sample|dummy|fake|test|x{4,}|\.{3,})(?:$|[-_\s])|<[^>]*>|\$\{[^}]+\}|x{4,}|\.{3,})/i;

function readOpenAiApiKey(environment) {
  const key = environment.OPENAI_API_KEY?.trim();
  if (!key) return { key: null, placeholderKeyDetected: false };
  if (PLACEHOLDER_API_KEY.test(key)) return { key: null, placeholderKeyDetected: true };
  return { key, placeholderKeyDetected: false };
}

export function getOpenAiApiKey(environment = process.env) {
  return readOpenAiApiKey(environment).key;
}

export function getOpenAiApiKeyStatus(environment = process.env) {
  const { key, placeholderKeyDetected } = readOpenAiApiKey(environment);
  return {
    placeholderKeyDetected,
    validApiKey: key ? 'configured' : 'missing',
  };
}
