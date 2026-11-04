import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('public header stays above page content and reserves its scroll position', () => {
  assert.match(styleSource, /\.site-header\{[^}]*position:sticky;top:0;z-index:40;width:100%;background:var\(--card\)/);
  assert.match(styleSource, /html\{scroll-padding-top:112px\}/);
  assert.match(styleSource, /@media\(max-width:1120px\)\{[\s\S]*?html\{scroll-padding-top:152px\}/);
  assert.match(styleSource, /html\[data-theme="dark"\] \.site-header\{background:var\(--card\)/);
});

test('header content and actions cannot shrink into the viewport edge', () => {
  assert.match(styleSource, /\.site-header-inner\{[^}]*width:100%;max-width:1440px;min-width:0;display:flex/);
  assert.match(appSource, /className="header-actions public-header-actions"/);
  assert.match(styleSource, /\.public-header-actions\{flex:0 0 auto;min-width:0;white-space:nowrap\}/);
  assert.match(styleSource, /@media\(max-width:1120px\)\{[\s\S]*?\.public-header-actions\{order:4;flex:0 0 100%;width:100%;margin:0;justify-content:flex-end;flex-wrap:wrap\}/);
  assert.doesNotMatch(styleSource, /\.site-header[^}]*width:100vw/);
});
