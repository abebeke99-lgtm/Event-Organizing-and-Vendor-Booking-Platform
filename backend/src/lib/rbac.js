export const ROLE_PERMISSION_MATRIX = Object.freeze({
  admin: [
    'admin:*',
    'users.view',
    'users.manage',
    'users.lock',
    'roles.manage',
    'roles.permissions.manage',
    'vendors.view',
    'vendors.verify',
    'vendors.manage',
    'events.manage',
    'bookings.manage',
    'bookings.moderate',
    'payments.view',
    'reports.view',
    'notifications.manage',
    'system.settings.manage',
    'system.modules.manage',
    'system.security.manage',
  ],
  organizer: [
    'events.create',
    'events.manage_own',
    'events.view_own',
    'bookings.create',
    'bookings.view_own',
    'bookings.cancel_own',
    'vendors.view',
    'quotes.manage_own',
    'notifications.view_own',
    'payments.view_own',
  ],
  vendor: [
    'vendors.view_own',
    'vendors.manage_own',
    'services.manage_own',
    'bookings.view_own',
    'bookings.accept_own',
    'payments.view_own',
    'reviews.view_own',
    'notifications.view_own',
  ],
  customer: [
    'bookings.create',
    'bookings.view_own',
    'bookings.cancel_own',
    'vendors.view',
    'events.view_own',
    'payments.view_own',
    'favorites.manage_own',
    'messages.view_own',
    'notifications.view_own',
  ],
});

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
]);

export function getRolePermissionPolicy(roleName) {
  const normalizedRole = String(roleName ?? '').trim().toLowerCase();
  return Object.hasOwn(ROLE_PERMISSION_MATRIX, normalizedRole)
    ? ROLE_PERMISSION_MATRIX[normalizedRole]
    : [];
}

export function isCriticalPermission(permissionKey) {
  const normalized = String(permissionKey ?? '').trim();
  return CRITICAL_PERMISSION_KEYS.includes(normalized)
    || /^system\./i.test(normalized)
    || /\.(?:export|refund)$/i.test(normalized);
}

export function describePermission(permissionKey) {
  const normalized = String(permissionKey ?? '').trim();
  const separator = normalized.indexOf('.');
  if (separator < 1) {
    return { module: normalized === 'admin:*' ? 'administrator' : normalized, action: normalized === 'admin:*' ? 'all' : 'manage' };
  }
  return { module: normalized.slice(0, separator), action: normalized.slice(separator + 1) };
}

export function normalizePermissionKeys(permissionKeys = []) {
  const entries = new Set();

  for (const entry of Array.isArray(permissionKeys) ? permissionKeys : []) {
    const normalized = String(entry ?? '').trim();
    if (normalized) entries.add(normalized);
  }

  return [...entries];
}

export function hasPermission(permissionSet = [], requiredPermission = '') {
  const permissions = normalizePermissionKeys(permissionSet);
  const permission = String(requiredPermission ?? '').trim();

  if (!permission) return permissions.length > 0;
  if (permissions.includes('*') || permissions.includes('admin:*')) return true;
  if (permissions.includes(permission)) return true;

  const modulePrefix = permission.split('.')[0];
  if (permissions.includes(`${modulePrefix}:*`)) return true;

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
