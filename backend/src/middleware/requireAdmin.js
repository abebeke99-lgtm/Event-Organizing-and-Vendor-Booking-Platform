import { pool } from '../db.js';
import { ROLE_PERMISSION_MATRIX } from '../lib/rbac.js';
import { hashToken } from '../lib/security.js';
import { getCookieOptions } from '../lib/cookieOptions.js';

function clearAdminCookie(res) {
  res.clearCookie('admin_session', getCookieOptions());
}

function clearPlatformCookie(res) {
  res.clearCookie('platform_session', getCookieOptions());
}

async function findAdministrator(req) {
  const clauses = [];
  const values = [];
  const isPostgres = req.app?.locals?.databaseDialect === 'postgres';
  if (req.cookies?.admin_session) {
    const marker = isPostgres ? `$${values.length + 1}` : '?';
    clauses.push(`EXISTS (SELECT 1 FROM admin_sessions s WHERE s.user_id = u.id AND s.token_hash = ${marker} AND s.expires_at > NOW())`);
    values.push(hashToken(req.cookies.admin_session));
  }
  if (req.cookies?.platform_session) {
    const marker = isPostgres ? `$${values.length + 1}` : '?';
    clauses.push(`EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = u.id AND s.token_hash = ${marker} AND s.expires_at > NOW())`);
    values.push(hashToken(req.cookies.platform_session));
  }
  if (!clauses.length) return null;

  const database = req.app?.locals?.database || pool;
  if (isPostgres) {
    const result = await database.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status,
         STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
         AND (${clauses.join(' OR ')})
       GROUP BY u.id
       LIMIT 1`,
      values,
    );
    return result.rows[0] || null;
  }
  const [rows] = await database.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status,
       GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
       AND (${clauses.join(' OR ')})
     GROUP BY u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status
     LIMIT 1`,
    values,
  );
  return rows[0] || null;
}

async function hasActivePlatformSession(req) {
  const database = req.app?.locals?.database || pool;
  if (req.app?.locals?.databaseDialect === 'postgres') {
    const result = await database.query(
      `SELECT 1
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [hashToken(req.cookies.platform_session)],
    );
    return result.rows.length > 0;
  }
  const [rows] = await database.execute(
    `SELECT 1
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id AND u.status = 'active'
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
     WHERE s.token_hash = ? AND s.expires_at > NOW()
     LIMIT 1`,
    [hashToken(req.cookies.platform_session)],
  );
  return rows.length > 0;
}

function attachAdministrator(req, administrator) {
  req.admin = { ...administrator, role: 'admin' };
  req.user = {
    ...req.admin,
    role: 'admin',
    permissions: [...ROLE_PERMISSION_MATRIX.admin],
    roles: (req.admin.roles || '').split(',').map((name) => name.trim()).filter(Boolean),
  };
  req.permissions = [...ROLE_PERMISSION_MATRIX.admin];
}

export async function requireAdmin(req, res, next) {
  try {
    const administrator = await findAdministrator(req);
    if (!administrator) {
      if (req.cookies?.admin_session) clearAdminCookie(res);
      if (req.cookies?.platform_session) {
        const database = req.app?.locals?.database || pool;
        if (req.app?.locals?.databaseDialect === 'postgres') {
          const accounts = await database.query(
            `SELECT 1 FROM user_sessions s
             JOIN users u ON u.id = s.user_id AND u.status = 'active'
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
             WHERE s.token_hash = $1 AND s.expires_at > NOW() AND r.is_admin = FALSE
             LIMIT 1`,
            [hashToken(req.cookies.platform_session)],
          );
          if (accounts.rows.length) return res.status(403).json({ error: 'Access denied.' });
          clearPlatformCookie(res);
          return res.status(401).json({ error: 'Authentication required.' });
        }
        const [accounts] = await database.execute(
          `SELECT 1 FROM user_sessions s
           JOIN users u ON u.id = s.user_id AND u.status = 'active'
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
           WHERE s.token_hash = ? AND s.expires_at > NOW() AND r.is_admin = FALSE
           LIMIT 1`,
          [hashToken(req.cookies.platform_session)],
        );
        if (accounts.length) return res.status(403).json({ error: 'Access denied.' });
        clearPlatformCookie(res);
      }
      return res.status(401).json({ error: 'Authentication required.' });
    }
    attachAdministrator(req, administrator);
    return next();
  } catch (error) {
    return next(error);
  }
}

export function optionalAdmin(req, res, next) {
  if (!req.cookies?.admin_session && !req.cookies?.platform_session) {
    req.admin = null;
    return next();
  }
  findAdministrator(req)
    .then((administrator) => {
      if (administrator) {
        attachAdministrator(req, administrator);
        return next();
      }

      if (req.cookies.admin_session) clearAdminCookie(res);
      if (!req.cookies.platform_session) {
        return res.status(401).json({ error: 'Authentication required.' });
      }
      return hasActivePlatformSession(req).then((hasSession) => {
        if (!hasSession) {
          clearPlatformCookie(res);
          return res.status(401).json({ error: 'Authentication required.' });
        }
        req.admin = null;
        return next();
      });
    })
    .catch(next);
}
