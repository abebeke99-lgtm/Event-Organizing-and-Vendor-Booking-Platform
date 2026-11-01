import { pool } from '../db.js';
import { getRolePermissionPolicy, isCriticalPermission } from '../lib/rbac.js';
import { hashToken } from '../lib/security.js';

export async function requirePlatformUser(req, res, next) {
  const token = req.cookies?.platform_session;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const database = req.app?.locals?.database || pool;
    const [rows] = await database.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, LOWER(r.name) AS role,
         GROUP_CONCAT(DISTINCT p.permission_key ORDER BY p.permission_key SEPARATOR ',') AS permission_keys
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active'
         AND r.is_admin = FALSE AND r.is_active = TRUE
       GROUP BY u.id, u.full_name, u.email, u.phone, u.status, r.name
       ORDER BY CASE LOWER(r.name) WHEN 'customer' THEN 1 WHEN 'organizer' THEN 2 WHEN 'vendor' THEN 3 ELSE 4 END
       LIMIT 1`,
      [hashToken(token)]
    );
    if (!rows.length) {
      res.clearCookie('platform_session', {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: process.env.COOKIE_SAME_SITE || 'strict',
        path: '/',
      });
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const allowedPermissions = new Set(getRolePermissionPolicy(rows[0].role));
    const permissions = (rows[0].permission_keys || '')
      .split(',')
      .filter((permission) => permission && allowedPermissions.has(permission) && !isCriticalPermission(permission));
    req.platformUser = { ...rows[0], name: rows[0].full_name, permissions };
    req.user = req.platformUser;
    req.permissions = permissions;
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalPlatformUser(req, res, next) {
  if (!req.cookies?.platform_session) {
    req.platformUser = null;
    return next();
  }
  return requirePlatformUser(req, res, next);
}

export function requirePlatformRole(...allowedRoles) {
  return (req, res, next) => requirePlatformUser(req, res, (error) => {
    if (error) return next(error);
    if (res.headersSent) return;
    if (!allowedRoles.includes(req.platformUser.role)) return res.status(403).json({ error: 'Access denied.' });
    next();
  });
}