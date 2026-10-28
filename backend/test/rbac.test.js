import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROLE_PERMISSION_MATRIX,
  normalizePermissionKeys,
  hasPermission,
  getSystemLockState,
  getModuleLockState,
} from '../src/lib/rbac.js';

test('role permission matrix contains the required role-specific permissions', () => {
  assert.ok(ROLE_PERMISSION_MATRIX.admin.includes('admin:*'));
  assert.ok(ROLE_PERMISSION_MATRIX.organizer.includes('events.manage_own'));
  assert.ok(ROLE_PERMISSION_MATRIX.vendor.includes('vendors.manage_own'));
  assert.ok(ROLE_PERMISSION_MATRIX.customer.includes('bookings.view_own'));
});

test('permission checks honor wildcard and nested permissions', () => {
  assert.equal(hasPermission(['admin:*'], 'users.view'), true);
  assert.equal(hasPermission(['events.manage_own', 'bookings.view_own'], 'events.manage_own'), true);
  assert.equal(hasPermission(['events.manage_own'], 'events.view_own'), false);
  assert.equal(hasPermission(['system:*'], 'system.modules.manage'), true);
});

test('permission normalization removes duplicates and empty values', () => {
  const result = normalizePermissionKeys([' users.view ', 'users.view', '', 'bookings.create']);
  assert.deepEqual(result, ['users.view', 'bookings.create']);
});

test('system lock and module lock helpers resolve the lock state', () => {
  const system = getSystemLockState({ platform_status: 'locked', maintenance_mode: true });
  assert.equal(system.locked, true);
  assert.equal(system.reason, 'Platform maintenance');
  assert.deepEqual(getModuleLockState({ users: true }, 'users'), { locked: true, reason: 'Module locked by administrator' });
  assert.deepEqual(getModuleLockState({}, 'users'), { locked: false, reason: null });
});
