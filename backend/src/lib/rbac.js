const ADMIN_PERMISSION_SET = Object.freeze([
  'admin:*',
  'dashboard.view', 'dashboard.analytics', 'dashboard.reports', 'dashboard.export',
  'users.view', 'users.create', 'users.edit', 'users.delete', 'users.activate', 'users.deactivate', 'users.suspend', 'users.restore', 'users.assign_role', 'users.manage_permissions',
  'roles.view', 'roles.create', 'roles.edit', 'roles.delete', 'roles.activate', 'roles.deactivate', 'roles.assign_permissions', 'roles.view_history',
  'permissions.view', 'permissions.create', 'permissions.edit', 'permissions.delete', 'permissions.assign', 'permissions.revoke',
  'events.view', 'events.create', 'events.edit', 'events.delete', 'events.publish', 'events.unpublish', 'events.approve', 'events.reject', 'events.manage_all',
  'vendors.view', 'vendors.create', 'vendors.edit', 'vendors.delete', 'vendors.verify', 'vendors.reject', 'vendors.suspend', 'vendors.restore',
  'services.view', 'services.create', 'services.edit', 'services.delete', 'services.approve', 'services.reject', 'services.publish',
  'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.cancel', 'bookings.approve', 'bookings.reject', 'bookings.manage_status', 'bookings.view_all', 'bookings.manage', 'bookings.moderate',
  'quotations.view', 'quotations.create', 'quotations.edit', 'quotations.approve', 'quotations.reject', 'quotations.manage',
  'payments.view', 'payments.process', 'payments.refund', 'payments.manage', 'payments.export', 'payments.reports',
  'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
  'content.view', 'content.create', 'content.edit', 'content.delete', 'content.publish', 'content.manage',
  'messages.view', 'messages.send', 'messages.delete', 'notifications.view', 'notifications.manage',
  'reviews.view', 'reviews.create', 'reviews.edit', 'reviews.delete', 'reviews.moderate',
  'reports.view', 'reports.generate', 'reports.export',
  'settings.view', 'settings.edit', 'system.manage', 'system.security', 'audit_logs.view', 'audit_logs.export',
  'system.settings.manage', 'system.modules.manage', 'system.security.manage', 'users.manage', 'users.lock', 'roles.manage', 'roles.permissions.manage', 'vendors.manage', 'complaints.manage', 'notifications.manage', 'reports.view'
]);

const ORGANIZER_PERMISSION_SET = Object.freeze([
  'dashboard.view', 'dashboard.analytics',
  'events.view', 'events.create', 'events.edit', 'events.delete', 'events.publish', 'events.unpublish', 'events.manage_own', 'events.view_own',
  'bookings.create', 'bookings.view_own', 'bookings.cancel_own', 'bookings.manage_status',
  'vendors.view', 'quotes.manage_own', 'notifications.view_own', 'payments.view_own',
  'messages.view', 'messages.send'
]);

const VENDOR_PERMISSION_SET = Object.freeze([
  'dashboard.view',
  'vendors.view', 'vendors.view_own', 'vendors.manage_own', 'vendors.edit',
  'services.view', 'services.create', 'services.edit', 'services.delete', 'services.publish', 'services.manage_own',
  'bookings.view_own', 'bookings.accept_own', 'bookings.manage_status',
  'payments.view_own', 'reviews.view_own', 'notifications.view_own', 'messages.view'
]);

const CUSTOMER_PERMISSION_SET = Object.freeze([
  'dashboard.view',
  'bookings.create', 'bookings.view_own', 'bookings.cancel_own',
  'vendors.view', 'events.view_own', 'payments.view_own', 'favorites.manage_own', 'messages.view_own', 'notifications.view_own',
  'reviews.create', 'reviews.view'
]);

const VISITOR_PERMISSION_SET = Object.freeze(['dashboard.view']);

export const ROLE_PERMISSION_MATRIX = Object.freeze({
  admin: [...ADMIN_PERMISSION_SET],
  administrator: [...ADMIN_PERMISSION_SET],
  organizer: [...ORGANIZER_PERMISSION_SET],
  vendor: [...VENDOR_PERMISSION_SET],
  customer: [...CUSTOMER_PERMISSION_SET],
  visitor: [...VISITOR_PERMISSION_SET],
  guest: [...VISITOR_PERMISSION_SET],
});

export const DEFAULT_SYSTEM_ROLES = Object.freeze(['administrator', 'organizer', 'vendor', 'customer', 'visitor']);
export const ASSIGNABLE_PLATFORM_ROLES = Object.freeze(['organizer', 'vendor', 'customer']);

export const CRITICAL_PERMISSION_KEYS = Object.freeze([
  'admin:*',
  'roles.manage',
  'roles.permissions.manage',
  'system.settings.manage',
  'system.modules.manage',
  'system.security.manage',
  'users.manage',
  'users.lock',
  'payments.manage',
  'payments.refund',
  'payments.export',
  'bookings.export',
  'reports.export',
]);

function normalizePermissionToken(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/:/g, '.').replace(/\.+/g, '.');
}

export function getRolePermissionPolicy(roleName) {
  const normalizedRole = String(roleName ?? '').trim().toLowerCase();
  const alias = normalizedRole === 'administrator' ? 'admin' : normalizedRole === 'guest' ? 'visitor' : normalizedRole;
  return Object.hasOwn(ROLE_PERMISSION_MATRIX, alias)
    ? ROLE_PERMISSION_MATRIX[alias]
    : [];
}

export function isCriticalPermission(permissionKey) {
  const normalized = normalizePermissionToken(permissionKey);
  const safetySet = new Set(CRITICAL_PERMISSION_KEYS.map((key) => normalizePermissionToken(key)));
  return safetySet.has(normalized)
    || /^system\./i.test(normalized)
    || /^roles\./i.test(normalized)
    || /\.(?:export|refund|delete|manage|security)$/i.test(normalized)
    || normalized === 'admin.*';
}

export function describePermission(permissionKey) {
  const normalized = normalizePermissionToken(permissionKey);
  if (!normalized) return { module: '', action: 'manage' };
  if (normalized === 'admin.*' || normalized === 'admin:*') {
    return { module: 'administrator', action: 'all' };
  }
  const separator = normalized.lastIndexOf('.');
  if (separator < 1) {
    return { module: normalized, action: 'manage' };
  }
  return { module: normalized.slice(0, separator), action: normalized.slice(separator + 1) };
}

export function normalizePermissionKeys(permissionKeys = []) {
  const entries = new Map();
  const candidateValues = Array.isArray(permissionKeys)
    ? permissionKeys
    : typeof permissionKeys === 'string'
      ? permissionKeys.split(',')
      : [];

  for (const entry of candidateValues) {
    const values = Array.isArray(entry) ? entry : [entry];
    for (const item of values) {
      const normalized = String(item ?? '').trim();
      if (!normalized) continue;
      const token = normalizePermissionToken(normalized);
      if (token) entries.set(token, token);
    }
  }

  return [...entries.values()];
}

export function hasPermission(permissionSet = [], requiredPermission = '') {
  const permissions = normalizePermissionKeys(permissionSet).map((value) => normalizePermissionToken(value));
  const permission = normalizePermissionToken(requiredPermission);

  if (!permission) return permissions.length > 0;
  if (permissions.includes('*')) return true;
  if (permissions.includes('admin.*') || permissions.includes('admin:*')) return true;
  if (permissions.includes(permission)) return true;

  const rawPermission = String(requiredPermission ?? '').trim();
  const aliasMatch = permissions.some((key) => key === normalizePermissionToken(rawPermission)
    || key === normalizePermissionToken(rawPermission.replace(/\./g, ':'))
    || key === rawPermission);
  if (aliasMatch) return true;

  const modulePrefix = permission.split('.')[0];
  const moduleWildcard = `${modulePrefix}.*`;
  const moduleWildcardColon = `${modulePrefix}:*`;
  if (permissions.includes(moduleWildcard) || permissions.includes(moduleWildcardColon)) return true;

  return false;
}

export function getSystemLockState(systemSettings = {}) {
  const platformStatus = String(systemSettings.platform_status ?? systemSettings.system_status ?? '').trim().toLowerCase();
  const maintenanceMode = [true, 'true', '1', 'yes', 'on'].includes(systemSettings.maintenance_mode ?? systemSettings.maintenance ?? false) || String(systemSettings.maintenance_mode ?? systemSettings.maintenance ?? '').trim().toLowerCase() === 'true';

  if (maintenanceMode) {
    return { locked: true, reason: 'Platform maintenance' };
  }

  if (platformStatus === 'locked') {
    return { locked: true, reason: 'Platform lock' };
  }

  if (platformStatus === 'maintenance') {
    return { locked: true, reason: 'Platform maintenance' };
  }

  return { locked: false, reason: null };
}

export function getModuleLockState(moduleLocks = {}, moduleKey = '') {
  const key = String(moduleKey ?? '').trim().toLowerCase();
  if (!key) return { locked: false, reason: null };

  const candidates = [
    moduleLocks[key],
    moduleLocks[`${key}_lock`],
    moduleLocks[`${key}.locked`],
    moduleLocks[`${key}.lock`],
    moduleLocks[`${key}_locked`],
  ];

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const value = String(candidate).trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'locked'].includes(value)) {
      return { locked: true, reason: 'Module locked by administrator' };
    }
    if (['false', '0', 'no', 'off', 'unlocked'].includes(value)) {
      return { locked: false, reason: null };
    }
  }

  return { locked: false, reason: null };
}

export function getRolePermissionMatrix() {
  return structuredClone(ROLE_PERMISSION_MATRIX);
}
