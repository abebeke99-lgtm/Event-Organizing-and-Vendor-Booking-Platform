import { pool } from '../db.js';
import { hashToken } from '../lib/security.js';

export async function requirePlatformUser(req, res, next) {
  const token = req.cookies?.platform_session;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, LOWER(r.name) AS role
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active'
         AND r.is_admin = FALSE AND r.is_active = TRUE
       ORDER BY CASE LOWER(r.name) WHEN 'customer' THEN 1 WHEN 'organizer' THEN 2 WHEN 'vendor' THEN 3 ELSE 4 END
       LIMIT 1`,
      [hashToken(token)]
    );
    if (!rows.length) return res.status(401).json({ error: 'Authentication required.' });
    req.platformUser = { ...rows[0], name: rows[0].full_name };
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePlatformRole(...allowedRoles) {
  return (req, res, next) => requirePlatformUser(req, res, (error) => {
    if (error) return next(error);
    if (res.headersSent) return;
    if (!allowedRoles.includes(req.platformUser.role)) return res.status(403).json({ error: 'Access denied.' });
    next();
  });
}