import { pool } from '../db.js';
import { getModuleLockState, getSystemLockState, hasPermission, normalizePermissionKeys } from '../lib/rbac.js';

export async function getEffectiveUserPermissions(userId) {
  if (!userId) return [];
  const [rows] = await pool.execute(
    `SELECT DISTINCT p.permission_key
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND r.is_active = TRUE`,
    [userId]
  );
  return normalizePermissionKeys(rows.map((row) => row.permission_key));
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
  const settings = req.app.locals?.systemSettings || {};
  const state = getSystemLockState(settings);
  if (state.locked) {
    return res.status(423).json({ error: state.reason || 'The platform is temporarily unavailable.' });
  }
  next();
}
