import { pool } from '../db.js';
import {
  getModuleLockState,
  getRolePermissionPolicy,
  getSystemLockState,
  hasPermission,
  isCriticalPermission,
  normalizePermissionKeys,
} from '../lib/rbac.js';
import { loadSystemSettings, updateSystemSettingsCache } from '../lib/systemSettings.js';

export async function getEffectiveUserPermissions(userId, database = pool) {
  if (!userId) return [];
  const [rows] = await database.execute(
    `SELECT DISTINCT p.permission_key, r.name AS role_name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND r.is_active = TRUE`,
    [userId]
  );
  const allowed = new Set(rows.flatMap((row) => getRolePermissionPolicy(row.role_name)));
  return normalizePermissionKeys(rows.map((row) => row.permission_key)
    .filter((permissionKey) => allowed.has(permissionKey) && !isCriticalPermission(permissionKey)));
}

export function requirePermission(requiredPermission) {
  return async (req, res, next) => {
    const permissions = normalizePermissionKeys(req.user?.permissions ?? req.permissions ?? []);
    if (!hasPermission(permissions, requiredPermission)) {
      return res.status(403).json({ error: 'Access denied. The required permission is not assigned to this account.' });
    }
    next();
  };
}

export function requireModuleUnlocked(moduleKey) {
  return (req, res, next) => {
    const locks = req.app.locals?.moduleLocks || {};
    const state = getModuleLockState(locks, moduleKey);
    if (state.locked) {
      return res.status(423).json({ error: 'This module is temporarily locked by an administrator.' });
    }
    next();
  };
}

export async function requirePlatformAvailable(req, res, next) {
  if (req.path === '/logout') return next();
  try {
    const now = Date.now();
    let settings = req.app.locals?.platformSettingsCache;
    if (!settings || settings.expiresAt <= now) {
      const database = req.app.locals?.database || pool;
      const values = await loadSystemSettings(database, ['platform_status', 'maintenance_mode', 'maintenance_message']);
      updateSystemSettingsCache(req.app, values);
      settings = req.app.locals.platformSettingsCache;
    }

    const state = getSystemLockState(settings.values);
    if (state.locked) {
      const message = settings.values.maintenance_message || 'The platform is temporarily unavailable.';
      return res.status(503).json({ error: state.reason || 'Platform unavailable', message });
    }
    next();
  } catch (error) {
    next(error);
  }
}
