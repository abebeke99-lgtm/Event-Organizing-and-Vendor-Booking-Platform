import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_SYSTEM_SETTINGS_STORAGE_KEY, createDefaultAdminSystemSettings, loadAdminSystemSettings,
  saveAdminSystemSettings, SYSTEM_SETTINGS_SECTIONS, validateAdminSetting,
} from '../src/adminSystemSettingsData.js';
import { translate } from '../src/language.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('default settings include all 19 sections and use ETB as the currency', () => {
  const defaults = createDefaultAdminSystemSettings();
  assert.equal(SYSTEM_SETTINGS_SECTIONS.length, 19);
  assert.equal(defaults.general.currency, 'ETB');
  assert.equal(defaults.localization.currency, 'ETB');
  assert.deepEqual(defaults.roles.roles.map((role) => role.name), [
    'Administrator', 'Event Organizer', 'Vendor', 'Customer', 'Visitor / Guest',
  ]);
});

test('settings navigation labels have English and Amharic translations', () => {
  for (const section of SYSTEM_SETTINGS_SECTIONS) {
    assert.match(section.translationKey, /^nav\./);
    assert.equal(translate(section.translationKey, 'en'), section.label);
    assert.notEqual(translate(section.translationKey, 'am'), section.translationKey);
  }
});

test('settings save and reload from the browser storage adapter', () => {
  const storage = createStorage();
  const settings = createDefaultAdminSystemSettings();
  settings.general.platformName = 'Demo Events';
  saveAdminSystemSettings(settings, storage, '2026-11-03T00:00:00.000Z');

  const loaded = loadAdminSystemSettings(storage);
  assert.equal(loaded.settings.general.platformName, 'Demo Events');
  assert.equal(loaded.lastSaved, '2026-11-03T00:00:00.000Z');
  assert.equal(storage.getItem(ADMIN_SYSTEM_SETTINGS_STORAGE_KEY) !== null, true);
});

test('invalid saved JSON is surfaced for recovery instead of silently accepted', () => {
  const storage = createStorage({ [ADMIN_SYSTEM_SETTINGS_STORAGE_KEY]: '{broken' });
  assert.throws(() => loadAdminSystemSettings(storage), SyntaxError);
});

test('partial saved objects keep defaults and malformed nested values fail explicitly', () => {
  const partial = createStorage({ [ADMIN_SYSTEM_SETTINGS_STORAGE_KEY]: JSON.stringify({ general: { platformName: 'Custom demo' } }) });
  const loaded = loadAdminSystemSettings(partial);
  assert.equal(loaded.settings.general.platformName, 'Custom demo');
  assert.equal(loaded.settings.general.currency, 'ETB');

  const malformed = createStorage({ [ADMIN_SYSTEM_SETTINGS_STORAGE_KEY]: JSON.stringify({ notifications: { channels: false } }) });
  assert.throws(() => loadAdminSystemSettings(malformed), /must be an object/i);
});

test('setting validation rejects invalid emails, URLs, and out-of-range commissions', () => {
  assert.match(validateAdminSetting('email', 'senderEmail', 'not-an-email'), /valid email/i);
  assert.match(validateAdminSetting('general', 'websiteUrl', 'javascript:alert(1)'), /HTTP or HTTPS/i);
  assert.match(validateAdminSetting('payments', 'platformCommission', '101'), /between 0 and 100/i);
  assert.equal(validateAdminSetting('general', 'platformName', 'EventHub'), '');
});
