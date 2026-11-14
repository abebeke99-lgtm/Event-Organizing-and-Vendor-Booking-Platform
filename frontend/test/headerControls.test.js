import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNotificationBadgeCount, getMissingTranslationKeys, translate } from '../src/language.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const navigationSource = await readFile(new URL('../src/PublicNavigation.jsx', import.meta.url), 'utf8');
const homepageSearchSource = await readFile(new URL('../src/HomepageSearch.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('header and homepage search remain available', () => {
  assert.match(appSource, /className="public-search-anchor"/);
  assert.match(appSource, /aria-controls="header-search-panel"/);
  assert.match(appSource, /onClick=\{\(\) => \{ setNotificationsOpen\(false\); setSearchOpen\(\(open\) => !open\); \}\}/);
  assert.match(appSource, /searchInputRef\.current\?\.focus\(\)/);
  assert.match(appSource, /event\.key === 'Escape'[\s\S]*?closeSearch\(\)/);
  assert.match(appSource, /onNavigate\(`\/search\?q=\$\{encodeURIComponent\(query\)\}`\)/);
  assert.match(homepageSearchSource, /className="hero-search homepage-search"/);
  assert.match(homepageSearchSource, /placeholder=\{t\('searchAll'\)\}/);
});

test('notifications remain authenticated-only and display capped unread counts', () => {
  assert.match(appSource, /isAuthenticated && authSessionState\.status === 'authenticated'[\s\S]*?PUBLIC_NOTIFICATION_ENDPOINTS\[role\]/);
  assert.match(appSource, /PUBLIC_NOTIFICATION_COUNT_ENDPOINTS = \{[\s\S]*?customer: '\/customer\/overview'[\s\S]*?organizer: '\/platform\/organizer\/overview'[\s\S]*?vendor: '\/vendor\/overview'/);
  assert.match(appSource, /<div className="header-actions public-header-actions">/);
  assert.match(appSource, /\{notificationEndpoint && <div className="public-notification-anchor">/);
  assert.match(appSource, /className="public-notification-anchor"/);
  assert.match(appSource, /aria-expanded=\{notificationsOpen\} aria-controls="header-notifications-panel"/);
  assert.match(appSource, /setNotificationsOpen\(\(open\) => !open\)/);
  assert.match(appSource, /unreadCount > 0 && <span className="notification-count"/);
  assert.equal(formatNotificationBadgeCount(0), '0');
  assert.equal(formatNotificationBadgeCount(1), '1');
  assert.equal(formatNotificationBadgeCount(99), '99');
  assert.equal(formatNotificationBadgeCount(100), '99+');
  assert.equal(formatNotificationBadgeCount(-2), '0');
});

test('language and theme controls persist choices and expose both localized labels', () => {
  assert.match(appSource, /setLanguage\(nextLanguage\)/);
  assert.match(appSource, /<option value="en">English<\/option>/);
  assert.match(appSource, /<option value="am">አማርኛ<\/option>/);
  assert.match(appSource, /<LanguageSelector user=\{user\} showIcon=\{false\} \/>/);
  assert.match(appSource, /function LanguageSelector\(\{ user, isAdmin = false, showIcon = true \}\)/);
  assert.match(appSource, /\{showIcon && <Languages size=\{16\} aria-hidden="true" \/>}/);
  assert.match(appSource, /aria-label=\{translate\('languageLabel', language\)\}/);
  assert.match(appSource, /onClick=\{\(\) => setTheme\(nextTheme\)\}/);
  assert.match(appSource, /aria-pressed=\{theme === 'dark'\}/);
  assert.match(styleSource, /html\[data-theme="dark"\] \.public-header-icon-button/);
  for (const key of ['languageLabel', 'switchToLightMode', 'switchToDarkMode']) {
    assert.ok(translate(key, 'en'), `missing English translation for ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic translation for ${key}`);
    assert.equal(getMissingTranslationKeys('am').includes(key), false, `missing Amharic translation for ${key}`);
  }
  assert.equal(translate('languageLabel', 'en'), 'Change language');
  assert.equal(translate('languageLabel', 'am'), 'ቋንቋ ቀይር');
});

test('logged-out actions switch to a role-aware account menu when signed in', () => {
  assert.match(appSource, /\{isAuthenticated \? <details className="public-account"/);
  assert.match(appSource, /<button type="button" className="public-login-button" onClick={onOpenLogin}/);
  assert.match(appSource, /<button type="button" className="public-register-button" onClick={onOpenRegister}/);
  assert.match(appSource, /translate\(`\$\{role\}Dashboard`, language\)/);
  assert.match(appSource, /onNavigate\(dashboardPath\)/);
  assert.match(appSource, /onNavigate\(accountSettingsPath\)/);
  assert.match(appSource, /onLogout\(\)/);
});

test('mobile navigation is operable, scroll-locks, restores focus, and closes on route changes', () => {
  assert.match(appSource, /aria-controls="public-primary-navigation"/);
  assert.match(navigationSource, /className=\{`site-nav \$\{mobileOpen \? 'open' : ''\}`\}/);
  assert.match(navigationSource, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(navigationSource, /if \(mobileOpenRef\.current\) \{\s*onCloseMobile\(\)/);
  assert.match(navigationSource, /requestAnimationFrame\(\(\) => document\.querySelector\('\.mobile-nav-toggle'\)\?\.focus\(\)\)/);
  assert.match(navigationSource, /event\.key !== 'Tab'/);
});

test('remaining header controls have touch-sized targets and bilingual labels', () => {
  assert.match(styleSource, /\.public-header-icon-button\{[^}]*width:44px;height:44px/);
  assert.match(styleSource, /\.public-header-icon-button:focus-visible/);
  assert.match(styleSource, /\.public-login-button,.public-register-button\{min-height:44px/);
  assert.match(styleSource, /\.contact-top-bar-actions \.language-picker select\{height:44px\}/);
  assert.match(styleSource, /\.language-picker select:focus-visible/);
  assert.match(styleSource, /\.public-search-panel/);
  for (const key of ['searchAll', 'searchLoading', 'searchNoResults', 'searchFailed', 'contactInfoUnavailable', 'skipToContent', 'accountSettings', 'signOut', 'notificationsLoading', 'notificationUpdateFailed']) {
    assert.ok(translate(key, 'en'), `missing English translation for ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic translation for ${key}`);
    assert.equal(getMissingTranslationKeys('am').includes(key), false, `missing Amharic translation for ${key}`);
  }
});
