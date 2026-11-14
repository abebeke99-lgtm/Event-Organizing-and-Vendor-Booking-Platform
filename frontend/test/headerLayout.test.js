import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const navigationSource = await readFile(new URL('../src/PublicNavigation.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('public header uses a scroll-away utility bar and a sticky main bar', () => {
  assert.match(appSource, /<ContactTopBar contactInfo=\{siteContactInfo\} contactError=\{contactInfoError\}>/);
  assert.match(appSource, /<header className="site-header">/);
  assert.match(styleSource, /:root\{--public-utility:#1B3A78/);
  assert.match(styleSource, /\.contact-top-bar\{min-height:44px\}/);
  assert.match(styleSource, /\.contact-top-bar-inner\{min-height:44px;padding-top:0;padding-bottom:0;flex-direction:row-reverse\}/);
  assert.match(styleSource, /\.contact-top-bar-social \.footer-social-link\{width:36px;height:36px\}/);
  assert.match(styleSource, /\.contact-top-bar-social \.footer-social-link:hover\{border-color:#C9A24B/);
  assert.match(styleSource, /\.site-header\{[^}]*position:sticky;top:0;z-index:40/);
  assert.doesNotMatch(styleSource.match(/\.contact-top-bar\{([^}]*)\}/)?.[1] || '', /position:\s*(?:sticky|fixed)/);
  assert.match(styleSource, /--public-utility:#12376b/);
});

test('main header retains logo, navigation, and its search control', () => {
  assert.match(styleSource, /\.site-header-inner\{[^}]*max-width:1560px[^}]*display:grid;grid-template-columns/);
  assert.match(appSource, /<Logo className="site-brand-logo site-brand-logo-full" size="sm" variant="full" \/>/);
  assert.match(styleSource, /\.site-brand\{flex-direction:row\}/);
  assert.match(styleSource, /\.site-brand-logo-full\{width:56px!important;height:auto!important\}/);
  assert.match(styleSource, /\.site-brand-copy>strong\{color:var\(--eh-navy\);font-size:24px/);
  assert.match(styleSource, /\.site-brand-copy \.site-brand-tagline\{margin:0;color:#7A8BA8;font-size:11px;font-weight:600;letter-spacing:\.2em/);
  assert.match(appSource, /className="header-actions public-header-actions"/);
  assert.match(appSource, /className="public-search-anchor"/);
  assert.match(appSource, /aria-controls="header-search-panel"/);
  assert.match(styleSource, /\.public-search-panel/);
  assert.doesNotMatch(styleSource, /\.site-header[^}]*width:100vw/);
});

test('tablet and mobile breakpoints use the drawer and keep search controls available', () => {
  assert.match(styleSource, /@media\(min-width:768px\) and \(max-width:1099px\)\{[\s\S]*?\.site-nav\{[^}]*position:fixed/);
  assert.match(styleSource, /@media\(max-width:767px\)\{[\s\S]*?\.contact-top-bar-left\{width:100%;min-height:44px;flex-wrap:wrap;justify-content:center;gap:8px\}[\s\S]*?\.site-nav\{[^}]*position:fixed/);
  assert.match(styleSource, /\.public-nav-backdrop\{position:fixed;inset:0/);
  assert.match(navigationSource, /document\.body\.style\.overflow = 'hidden'/);
});

test('skip-to-content and primary content targets are present on public pages', () => {
  assert.match(appSource, /className="skip-to-content" href="#main-content"/);
  assert.match(appSource, /className="platform-landing" id="main-content"/);
  assert.match(appSource, /id="main-content" className="public-main-content"/);
  assert.match(styleSource, /\.skip-to-content:focus\{transform:translateY\(0\)/);
});
