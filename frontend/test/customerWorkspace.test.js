import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspaceSource = await readFile(
  new URL('../src/CustomerWorkspace.jsx', import.meta.url),
  'utf8',
);

test('customer service saving uses the saved-services API instead of quotation submission', () => {
  assert.match(workspaceSource, /item\.kind === 'save-service'/);
  assert.match(workspaceSource, /\/customer\/saved-services/);
  assert.match(workspaceSource, /method: 'POST'/);
  assert.doesNotMatch(workspaceSource, /isSaveService && \/platform\/service-quote-requests/);
});

test('customer profile shows account status and registration date', () => {
  assert.match(workspaceSource, /Account status:/);
  assert.match(workspaceSource, /Registered:/);
  assert.match(workspaceSource, /profile\.createdAt/);
});

test('customer password form uses the 12-16 character policy', () => {
  assert.match(workspaceSource, /minLength="12" maxLength="16"/);
  assert.match(workspaceSource, /12–16 characters/);
});

test('customer vendor browsing includes the branded directory hero and search action', () => {
  assert.match(workspaceSource, /customer-vendor-hero/);
  assert.match(workspaceSource, /Browse Vendors/);
  assert.match(workspaceSource, /Find the Perfect Vendor/);
  assert.match(workspaceSource, /customer-vendor-search/);
});

test('vendor cards derive category, location, and description fallbacks from active services', () => {
  assert.match(workspaceSource, /item\.services\?\.find\(\(service\) => service\.category\)/);
  assert.match(workspaceSource, /item\.services\?\.find\(\(service\) => service\.city\)/);
  assert.match(workspaceSource, /item\.services\?\.find\(\(service\) => service\.description\)/);
});
