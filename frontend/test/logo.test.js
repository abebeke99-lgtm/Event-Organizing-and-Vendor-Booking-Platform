import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import BrandLogo from '../src/components/common/BrandLogo.js';

const logoComponent = await readFile(new URL('../src/components/Logo.js', import.meta.url), 'utf8');
const logoSvg = await readFile(new URL('../public/assets/logo.svg', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const brandLogoSource = await readFile(new URL('../src/components/common/BrandLogo.js', import.meta.url), 'utf8');
const brandLogoEntry = await readFile(new URL('../src/components/common/BrandLogo.jsx', import.meta.url), 'utf8');
const footerSource = await readFile(new URL('../src/AppFooter.js', import.meta.url), 'utf8');
const authCardSource = await readFile(new URL('../src/components/AuthCard.jsx', import.meta.url), 'utf8');
const authLayoutSource = await readFile(new URL('../src/components/AuthLayout.jsx', import.meta.url), 'utf8');
const officialLogo = await readFile(new URL('../public/eventhub-logo.png', import.meta.url));
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
  assert.match(appSource, /import BrandLogo from '\.\/components\/common\/BrandLogo\.jsx'/);
  assert.match(appSource, /<BrandLogo[\s\S]*?className="site-brand"[\s\S]*?linkTo="\/"/);
  assert.match(appSource, /import AuthCard from '\.\/components\/AuthCard\.jsx'/);
  assert.match(appSource, /import SplashScreen from '\.\/components\/SplashScreen\.jsx'/);
  assert.match(appSource, /className="dashboard-brand" href="\/"/);
  assert.match(appSource, /function EmptyState[\s\S]*?<Logo size="md"/);
  assert.doesNotMatch(appSource, /eventhub-logo\.png|eventhub-symbol\.png/);
});

test('official EventHub artwork is the shared logo in header, footer, and authentication', () => {
  assert.ok(officialLogo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(officialLogo.readUInt32BE(16), 1152);
  assert.equal(officialLogo.readUInt32BE(20), 768);
  assert.match(brandLogoSource, /src: '\/eventhub-logo\.png'/);
  assert.match(brandLogoSource, /alt: 'EventHub – Plan\. Book\. Celebrate\.'/);
  assert.match(brandLogoSource, /objectFit: 'contain'/);
  assert.match(brandLogoSource, /href: linkTo/);
  assert.match(brandLogoEntry, /export \{ default \} from '\.\/BrandLogo\.js'/);
  assert.match(footerSource, /import BrandLogo from '\.\/components\/common\/BrandLogo\.js'/);
  assert.match(footerSource, /className: 'footer-brand-logo-link', size: '160px', linkTo: '\/'/);
  assert.match(authCardSource, /import BrandLogo from '\.\/common\/BrandLogo\.jsx'/);
  assert.match(authLayoutSource, /import BrandLogo from '\.\/common\/BrandLogo\.jsx'/);
});

test('BrandLogo applies configurable size, class, and homepage-capable link props', () => {
  const markup = renderToStaticMarkup(React.createElement(BrandLogo, {
    size: 96,
    className: 'test-brand',
    linkTo: '/events',
  }));

  assert.match(markup, /class="brand-logo-link test-brand" href="\/events"/);
  assert.match(markup, /src="\/eventhub-logo\.png"/);
  assert.match(markup, /alt="EventHub – Plan\. Book\. Celebrate\."/);
  assert.match(markup, /style="width:96px;height:auto;object-fit:contain"/);
});

test('browser icons use the shared calendar SVG at favicon and Apple touch sizes', () => {
  assert.match(htmlSource, /rel="icon" type="image\/svg\+xml" sizes="32x32" href="\/assets\/logo\.svg"/);
  assert.match(htmlSource, /rel="apple-touch-icon" sizes="180x180" href="\/assets\/logo\.svg"/);
});
