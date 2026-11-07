import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getLanguage, getMissingTranslationKeys, getTranslationKeyDifferences, setLanguage, translate, translateText } from '../src/language.js';
import { jsxDEV } from '../src/i18n/jsx-dev-runtime.js';
import { jsxs } from '../src/i18n/jsx-runtime.js';

test('switches shared English and Amharic event labels', () => {
  setLanguage('am');
  assert.equal(getLanguage(), 'am');
  assert.equal(translate('upcomingExperiences'), 'መጪ ዝግጅቶች');
  assert.equal(translate('requestFailure'), 'ጥያቄዎን ማስቀመጥ አልተቻለም። እንደገና ይሞክሩ።');
  setLanguage('en');
  assert.equal(translate('eventHighlight'), 'EVENT HIGHLIGHT');
});

test('footer social labels switch between English and Amharic', () => {
  assert.equal(translate('followUs', 'en'), 'Follow Us');
  assert.equal(translate('followUs', 'am'), 'ይከታተሉን');
  assert.deepEqual(
    ['telegram', 'youtube', 'facebook', 'linkedin'].map((key) => translate(key, 'am')),
    ['ቴሌግራም', 'ዩቲዩብ', 'ፌስቡክ', 'ሊንክድኢን'],
  );
});

test('navigation feature labels are translated in English and Amharic', () => {
  assert.equal(translate('navigationEventCalendar', 'en'), 'Event Calendar');
  assert.equal(translate('navigationCompareVendors', 'am'), 'አቅራቢዎችን ያወዳድሩ');
  assert.equal(translate('navigationCustomerOnly', 'am'), 'ይህ ባህሪ ለደንበኛ መለያዎች ብቻ ይገኛል።');
  assert.equal(translate('aboutUsMenu', 'am'), 'ስለ እኛ ምናሌ');
  assert.equal(translateText('Help & Support', 'am'), 'እገዛ እና ድጋፍ');
});

test('AI chat labels are translated in English and Amharic', () => {
  assert.equal(translate('aiChatAssistant', 'en'), 'AI Assistant');
  assert.equal(translate('aiChatAssistant', 'am'), 'የAI ረዳት');
  assert.equal(translate('aiChatArchive', 'am'), 'ወደ ማህደር አስገባ');
});

test('footer attribution is translated without a copyright symbol or design credit', () => {
  assert.equal(translate('footerCopyright', 'en'), '{year} EventHub. All Rights Reserved.');
  assert.equal(translate('footerCopyright', 'am'), '{year} EventHub. መብቱ በሕግ የተጠበቀ ነው።');
  assert.equal(translate('footerDeveloper', 'en'), 'Developed by Bekele Abebe');
  assert.equal(translate('footerDeveloper', 'am'), 'በBekele Abebe የተሰራ');
});

test('About page values are translated in English and Amharic', () => {
  assert.deepEqual(
    ['trustTransparency', 'qualityService', 'customerSatisfaction'].map((key) => translate(key, 'en')),
    ['Trust and Transparency', 'Quality Service', 'Customer Satisfaction'],
  );
  assert.deepEqual(
    ['trustTransparency', 'qualityService', 'customerSatisfaction'].map((key) => translate(key, 'am')),
    ['እምነት እና ግልጽነት', 'ጥራት ያለው አገልግሎት', 'የደንበኛ እርካታ'],
  );
});

test('translates exact interface phrases and falls back for missing keys', () => {
  assert.equal(translateText('Find Vendors', 'am'), 'አገልግሎት ሰጪዎችን ፈልግ');
  assert.equal(translate('adminUserFullName', 'en'), 'Full Name');
  assert.equal(translate('adminUserEmailAddress', 'en'), 'Email Address');
  assert.equal(translate('adminUserPhoneNumber', 'en'), 'Phone Number');
  assert.equal(translate('adminUserInitialPassword', 'en'), 'Initial Password');
  assert.equal(translate('adminUserConfirmPassword', 'en'), 'Confirm Password');
  assert.equal(translate('adminUserAccountType', 'en'), 'Account Type');
  assert.equal(translate('adminUserAccountStatus', 'en'), 'Account Status');
  assert.equal(translate('adminUserShowPassword', 'en'), 'Show password');
  assert.equal(translate('adminUserHidePassword', 'en'), 'Hide password');
  assert.equal(translate('adminUserStatusSuspended', 'en'), 'Inactive');
  assert.equal(translate('adminUserCreateStatusSuspended', 'en'), 'Suspended');
  assert.equal(translate('adminUserFullName', 'am'), 'ሙሉ ስም');
  assert.equal(translate('noVendorMatches', 'am'), 'የሚመጥን አገልግሎት አልተገኘም');
  assert.equal(translate('tryDifferentFilters', 'am'), 'ሌላ ቃል ወይም ማጣሪያ ይሞክሩ።');
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

test('all navigation translation keys are present in both languages', () => {
  const { missingInSelected, missingInEnglish } = getTranslationKeyDifferences('am');
  assert.deepEqual(missingInSelected.filter((key) => key.startsWith('nav.')), []);
  assert.deepEqual(missingInEnglish.filter((key) => key.startsWith('nav.')), []);
});

test('navigation keys used by public and dashboard code resolve in both languages', async () => {
  const [publicNavigationSource, appSource] = await Promise.all([
    readFile(new URL('../src/publicNavigationUtils.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  ]);
  const keys = new Set(
    [...`${publicNavigationSource}\n${appSource}`.matchAll(/'((?:nav)\.[A-Za-z0-9.]+)'/g)]
      .map((match) => match[1]),
  );
  assert.ok(keys.size > 0);
  for (const key of keys) {
    assert.notEqual(translate(key, 'en'), key, `missing English navigation label: ${key}`);
    assert.notEqual(translate(key, 'am'), key, `missing Amharic navigation label: ${key}`);
  }
});

test('JSX runtime translates dynamic child text and interpolated labels', () => {
  setLanguage('am');
  const category = jsxDEV('span', { children: 'Decoration' }, undefined, false, undefined, undefined);
  const slideControl = jsxDEV('button', { 'aria-label': 'Go to slide 2' }, undefined, false, undefined, undefined);
  const categoryCounts = jsxs('span', { children: [0, ' vendors · ', 0, ' services'] });
  const onChange = () => {};
  const record = { label: 'Decoration' };
  const input = jsxDEV('input', { value: 'Decoration', placeholder: 'Search', onChange, record }, undefined, false, undefined, undefined);
  assert.equal(category.props.children, 'ማስዋብ');
  assert.equal(slideControl.props['aria-label'], 'ወደ 2 ስላይድ ይሂዱ');
  assert.equal(categoryCounts.props.children, '0 አገልግሎት ሰጪዎች · 0 አገልግሎቶች');
  assert.equal(input.props.placeholder, 'ፈልግ');
  assert.equal(input.props.value, 'Decoration');
  assert.equal(input.props.onChange, onChange);
  assert.equal(input.props.record, record);
  assert.equal(translateText('Please sign in to update your profile.', 'am'), 'መገለጫዎን ለማዘመን ይግቡ።');
  assert.equal(translateText('Confirm changing this account to suspended?', 'am'), 'ይህን መለያ ወደ ታግዷል መቀየር ያረጋግጡ?');
  assert.equal(translateText('Apply consequential settings changes (platform_status, maintenance_mode)?', 'am'), 'ከፍተኛ ተጽዕኖ ያላቸውን የቅንብር ለውጦች (የመድረክ ሁኔታ, የጥገና ሁኔታ) ተግብር?');
  setLanguage('en');
  assert.equal(translateText('Go to slide 2'), 'Go to slide 2');
});

test('independently loaded translation runtimes share language state', async () => {
  const secondRuntime = await import('../src/language.js?runtime-copy=2');
  setLanguage('en');
  secondRuntime.setLanguage('am');
  assert.equal(getLanguage(), 'am');
  assert.equal(translate('login'), secondRuntime.translate('login'));
  setLanguage('en');
  assert.equal(secondRuntime.getLanguage(), 'en');
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