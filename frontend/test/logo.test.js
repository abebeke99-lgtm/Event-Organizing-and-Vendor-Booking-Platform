import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const logoComponent = await readFile(new URL('../src/components/Logo.js', import.meta.url), 'utf8');
const logoSvg = await readFile(new URL('../public/assets/logo.svg', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('shared logo exposes all required sizes and variants from the SVG source', () => {
  for (const size of ['xs: 32', 'sm: 48', 'md: 80', 'lg: 120', 'xl: 160']) {
    assert.ok(logoComponent.includes(size), `missing logo size ${size}`);
  }
  for (const symbol of ['eh-full', 'eh-icon', 'eh-mono-white']) {
    assert.ok(logoComponent.includes(symbol), `missing logo variant ${symbol}`);
    assert.match(logoSvg, new RegExp(`<symbol id="${symbol}"`));
  }
  assert.match(logoComponent, /EH logo/);
  assert.match(logoComponent, /image\/svg\+xml/);
});

test('application branding uses the shared logo for auth, navigation, splash, sidebar, and error states', () => {
  assert.match(appSource, /import Logo from '\.\/components\/Logo\.js'/);
  assert.match(appSource, /import AuthCard from '\.\/components\/AuthCard\.jsx'/);
  assert.match(appSource, /import SplashScreen from '\.\/components\/SplashScreen\.jsx'/);
  assert.match(appSource, /className="dashboard-brand" href="\/"/);
  assert.match(appSource, /function EmptyState[\s\S]*?<Logo size="md"/);
  assert.doesNotMatch(appSource, /eventhub-logo\.png|eventhub-symbol\.png/);
});

test('browser icons use the shared calendar SVG at favicon and Apple touch sizes', () => {
  assert.match(htmlSource, /rel="icon" type="image\/svg\+xml" sizes="32x32" href="\/assets\/logo\.svg"/);
  assert.match(htmlSource, /rel="apple-touch-icon" sizes="180x180" href="\/assets\/logo\.svg"/);
});
