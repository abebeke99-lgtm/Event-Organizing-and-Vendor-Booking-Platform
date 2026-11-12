import { pool } from '../db.js';
import { getRolePermissionPolicy, isCriticalPermission } from '../lib/rbac.js';
import { hashToken } from '../lib/security.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { isTransientPostgresError } from '../lib/postgresRetry.js';

function normalizePermissionKeys(value) {
  if (Array.isArray(value)) return value.filter((permission) => typeof permission === 'string' && permission.trim());
  if (typeof value === 'string') return value.split(',').map((permission) => permission.trim()).filter(Boolean);
  return [];
}

async function loadPlatformUser(req, { includeAdmins = false } = {}) {
  const database = req.app?.locals?.database || pool;
  if (req.app?.locals?.databaseDialect === 'postgres') {
    const adminRoleFilter = includeAdmins ? '' : 'AND r.is_admin = FALSE';
    const result = await database.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status,
         CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator')
           THEN 'admin' ELSE LOWER(r.name) END AS role,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.permission_key), NULL) AS permission_keys
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
         AND r.is_active = TRUE ${adminRoleFilter}
       GROUP BY u.id, r.name, r.is_admin
       ORDER BY CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
         WHEN LOWER(r.name) = 'organizer' THEN 2 WHEN LOWER(r.name) = 'vendor' THEN 3
         WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
       LIMIT 1`,
      [hashToken(req.cookies.platform_session)],
    );
    const rows = Array.isArray(result) ? (result[0] || []) : (result?.rows || []);
    const user = rows[0];
    if (!user) return null;

    const allowedPermissions = new Set(getRolePermissionPolicy(user.role));
    const permissions = normalizePermissionKeys(user.permission_keys)
      .filter((permission) => allowedPermissions.has(permission) && !isCriticalPermission(permission));
    return { ...user, name: user.full_name, permissions };
  }
  const adminRoleFilter = includeAdmins ? '' : 'AND r.is_admin = FALSE';
  const [rows] = await database.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status,
       CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator')
         THEN 'admin' ELSE LOWER(r.name) END AS role,
       GROUP_CONCAT(DISTINCT p.permission_key ORDER BY p.permission_key SEPARATOR ',') AS permission_keys
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active'
       AND r.is_active = TRUE ${adminRoleFilter}
     GROUP BY u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status, r.name, r.is_admin
     ORDER BY CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
       WHEN LOWER(r.name) = 'organizer' THEN 2 WHEN LOWER(r.name) = 'vendor' THEN 3
       WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
     LIMIT 1`,
    [hashToken(req.cookies.platform_session)],
  );
  const user = rows[0];
  if (!user) return null;

  const allowedPermissions = new Set(getRolePermissionPolicy(user.role));
  const permissions = (user.permission_keys || '')
    .split(',')
    .filter((permission) => permission && allowedPermissions.has(permission) && !isCriticalPermission(permission));
  return { ...user, name: user.full_name, permissions };
}

function clearPlatformCookie(res) {
  res.clearCookie('platform_session', getCookieOptions());
}

export async function requirePlatformUser(req, res, next) {
  if (!req.cookies?.platform_session) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const user = await loadPlatformUser(req);
    if (!user) {
      clearPlatformCookie(res);
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.platformUser = user;
    req.user = user;
    req.permissions = user.permissions;
    return next();
  } catch (error) {
    if (isTransientPostgresError(error)) return next(error);
    clearPlatformCookie(res);
    if (req.cookies?.platform_session) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    return next(error);
  }
}

export function optionalPlatformUser(req, res, next) {
  if (!req.cookies?.platform_session) {
    req.platformUser = null;
    return next();
  }
  loadPlatformUser(req, { includeAdmins: true })
    .then((user) => {
      if (!user) {
        clearPlatformCookie(res);
        return res.status(401).json({ message: 'Unauthorized' });
      }
      req.platformUser = user;
      return next();
    })
    .catch((error) => {
      if (isTransientPostgresError(error)) return next(error);
      clearPlatformCookie(res);
      return res.status(401).json({ message: 'Unauthorized' });
    });
}

export function requirePlatformRole(...allowedRoles) {
  return (req, res, next) => requirePlatformUser(req, res, (error) => {
    if (error) return next(error);
    if (res.headersSent) return;
    if (!allowedRoles.includes(req.platformUser.role)) return res.status(403).json({ error: 'Access denied.' });
    next();
  });
}
