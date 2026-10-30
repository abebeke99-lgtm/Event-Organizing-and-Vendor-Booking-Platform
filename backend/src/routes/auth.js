import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { createSession, hashToken, writeAudit } from '../lib/security.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
const cookieOptions = () => {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAME_SITE || 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
};

router.post('/login', async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password || email.length > 254 || password.length > 256) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.password_hash FROM users u
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.email = ? AND u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE LIMIT 1`, [email]
    );
    const valid = rows.length && await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid administrator credentials.' });
    const session = await createSession(rows[0].id);
    res.cookie('admin_session', session.token, { ...cookieOptions(), expires: session.expiresAt });
    await writeAudit(pool, { actorId: rows[0].id, action: 'auth.login', entityType: 'session', ip: req.ip });
    res.json({ user: { id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email } });
  } catch (error) { next(error); }
});

router.post('/logout', async (req, res, next) => {
  const token = req.cookies?.admin_session;
  try {
    if (token) {
      const [sessions] = await pool.execute('SELECT user_id FROM admin_sessions WHERE token_hash = ?', [hashToken(token)]);
      await pool.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(token)]);
      if (sessions.length) await writeAudit(pool, { actorId: sessions[0].user_id, action: 'auth.logout', entityType: 'session', ip: req.ip });
    }
    res.clearCookie('admin_session', { ...cookieOptions(), maxAge: undefined });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.get('/me', requireAdmin, asyncHandler(async (req, res) => res.json({ user: req.admin })));
export default router;
