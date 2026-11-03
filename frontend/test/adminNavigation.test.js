import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_DASHBOARD_SLUGS, adminPathForSlug, adminSlugFromPath } from '../src/adminNavigation.js';

test('all administrator dashboard destinations round-trip through their routes', () => {
  for (const slug of ADMIN_DASHBOARD_SLUGS) {
    assert.equal(adminSlugFromPath(adminPathForSlug(slug)), slug);
  }
});

test('system settings keeps its own route instead of opening account preferences', () => {
  assert.equal(adminPathForSlug('settings'), '/admin/settings');
  assert.equal(adminSlugFromPath('/admin/settings'), 'settings');
});

test('overview has a canonical route and unknown sections fall back safely', () => {
  assert.equal(adminPathForSlug('overview'), '/admin');
  assert.equal(adminSlugFromPath('/admin'), 'overview');
  assert.equal(adminSlugFromPath('/admin/not-a-section'), 'overview');
  assert.equal(adminSlugFromPath('/customer/dashboard'), null);
});