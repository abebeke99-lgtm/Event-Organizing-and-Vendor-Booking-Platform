import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getLanguage, getMissingTranslationKeys, setLanguage, translate, translateText } from '../src/language.js';

test('switches shared English and Amharic event labels', () => {
  setLanguage('am');
  assert.equal(getLanguage(), 'am');
  assert.equal(translate('upcomingExperiences'), 'መጪ ዝግጅቶች');
  assert.equal(translate('requestFailure'), 'ጥያቄዎን ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።');
  setLanguage('en');
  assert.equal(translate('eventHighlight'), 'EVENT HIGHLIGHT');
});

test('translates exact interface phrases and falls back for missing keys', () => {
  assert.equal(translateText('Find Vendors', 'am'), 'አገልግሎት ሰጪዎችን ፈልግ');
  assert.equal(translate('missingTranslationKey', 'am'), 'missingTranslationKey');
  assert.equal(translate('login', 'unknown'), 'Login');
});

test('ignores unsupported language changes and preserves the active preference', () => {
  setLanguage('en');
  setLanguage('fr');
  assert.equal(getLanguage(), 'en');
  setLanguage('am');
  assert.equal(getLanguage(), 'am');
  setLanguage('en');
});

test('English and Amharic resources contain the same translation keys', () => {
  assert.deepEqual(getMissingTranslationKeys('am'), []);
});

test('locale resources do not declare duplicate keys', async () => {
  const source = await readFile(new URL('../src/language.js', import.meta.url), 'utf8');
  const locales = [...source.matchAll(/^  (en|am): \{([\s\S]*?)^  \},/gm)];
  for (const [, locale, body] of locales) {
    const entries = [...body.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*):\s*'((?:[^'\\]|\\.)*)'/g)];
    const keys = entries.map((match) => match[1]);
    const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
    const duplicateValues = duplicates.map((key) => `${key}: ${entries.filter((entry) => entry[1] === key).map((entry) => entry[2]).join(' | ')}`);
    assert.deepEqual(duplicates, [], `${locale} has duplicate translation keys: ${duplicateValues.join('; ')}`);
  }
});