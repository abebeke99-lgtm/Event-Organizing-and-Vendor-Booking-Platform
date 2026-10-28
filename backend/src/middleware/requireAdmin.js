import { pool } from '../db.js';
import { ROLE_PERMISSION_MATRIX } from '../lib/rbac.js';
import { hashToken } from '../lib/security.js';

export async function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_session;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles
       FROM admin_sessions s JOIN users u ON u.id = s.user_id
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE
       GROUP BY u.id, u.full_name, u.email, u.phone, u.status LIMIT 1`,
      [hashToken(token)]
    );
    if (!rows.length) return res.status(403).json({ error: 'Administrator access required.' });
    req.admin = rows[0];
    req.user = { ...rows[0], permissions: [...ROLE_PERMISSION_MATRIX.admin], roles: (rows[0].roles || '').split(',').map((name) => name.trim()).filter(Boolean) };
    req.permissions = [...ROLE_PERMISSION_MATRIX.admin];
    next();
  } catch (error) {
    next(error);
  }
}
