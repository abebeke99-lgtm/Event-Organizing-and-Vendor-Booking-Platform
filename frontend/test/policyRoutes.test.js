import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const footerSource = await readFile(new URL('../src/AppFooter.js', import.meta.url), 'utf8');

test('footer policy links have their own direct public routes', () => {
  assert.match(footerSource, /href: '\/cookie-policy'.*translate\('cookiePolicy'/);
  assert.match(footerSource, /href: '\/refund-policy'.*translate\('refundPolicy'/);
  assert.match(appSource, /routePath === '\/cookie-policy'.*<CookiePolicyPage \/>/);
  assert.match(appSource, /routePath === '\/refund-policy'.*<RefundPolicyPage \/>/);
});

test('service category detail links use the service taxonomy route', () => {
  assert.match(appSource, /routePath\.startsWith\('\/service-categories\/'\)/);
  assert.match(appSource, /path: `\/service-categories\/\$\{encodeURIComponent\(category\.slug \|\| category\.name\)\}`/);
});
