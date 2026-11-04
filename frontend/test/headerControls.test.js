import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNotificationBadgeCount, getMissingTranslationKeys, translate } from '../src/language.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('header search opens and closes accessibly and handles keyboard suggestions', () => {
  assert.match(appSource, /aria-expanded=\{searchOpen\} aria-controls="header-search-panel"/);
  assert.match(appSource, /setSearchOpen\(\(open\) => !open\)/);
  assert.match(appSource, /setNotificationsOpen\(false\);[\s\S]*?setSearchOpen\(false\);/);
  assert.match(appSource, /setActiveSearchSuggestion\(\(index\) => \(index \+ 1\) % searchSuggestions\.length\)/);
  assert.match(appSource, /chooseHeaderSearchSuggestion\(searchSuggestions\[activeSearchSuggestion\]\)/);
  assert.match(appSource, /window\.setTimeout\(async \(\) => \{[\s\S]*?\}, 300\)/);
  assert.match(appSource, /new AbortController\(\)/);
});

test('notification control is authenticated-only and displays capped unread counts', () => {
  assert.match(appSource, /isAuthenticated && authSessionState\.status === 'authenticated'[\s\S]*?PUBLIC_NOTIFICATION_ENDPOINTS\[role\]/);
  assert.match(appSource, /PUBLIC_NOTIFICATION_COUNT_ENDPOINTS = \{[\s\S]*?customer: '\/customer\/overview'[\s\S]*?organizer: '\/platform\/organizer\/overview'[\s\S]*?vendor: '\/vendor\/overview'/);
  assert.match(appSource, /const unreadTotal = role === 'admin' \? response\.unreadCount : countResponse\?\.data\?\.unreadNotifications/);
  assert.match(appSource, /\{notificationEndpoint && <div className="public-notification-anchor">/);
  assert.match(appSource, /aria-expanded=\{notificationsOpen\} aria-controls="header-notifications-panel"/);
  assert.match(appSource, /setNotificationsOpen\(\(open\) => !open\)/);
  assert.match(appSource, /unreadCount > 0 && <span className="notification-count"/);
  assert.equal(formatNotificationBadgeCount(0), '0');
  assert.equal(formatNotificationBadgeCount(1), '1');
  assert.equal(formatNotificationBadgeCount(99), '99');
  assert.equal(formatNotificationBadgeCount(100), '99+');
  assert.equal(formatNotificationBadgeCount(-2), '0');
});

test('header controls have consistent responsive theme-aware styling and bilingual labels', () => {
  assert.match(styleSource, /\.public-header-icon-button\{[^}]*width:40px;height:40px/);
  assert.match(styleSource, /\.public-header-icon-button:focus-visible\{/);
  assert.match(styleSource, /html\[data-theme="dark"\] \.public-header-icon-button\{/);
  assert.match(styleSource, /@media\(max-width:760px\)\{[\s\S]*?\.public-header-tools\{display:none\}/);
  for (const key of ['searchLoading', 'searchNoResults', 'searchFailed', 'notificationsLoading', 'notificationUpdateFailed', 'allCaughtUp', 'markAsRead', 'markAllAsRead', 'viewAllNotifications']) {
    assert.ok(translate(key, 'en'), `missing English translation for ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic translation for ${key}`);
    assert.equal(getMissingTranslationKeys('am').includes(key), false, `missing Amharic translation for ${key}`);
  }
});
