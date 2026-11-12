import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import { hashToken } from '../lib/security.js';
import { isStrongPassword } from '../lib/authFlow.js';

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function createPostgresCustomerAccountRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();
  router.use(requirePlatformUser);
  router.use((req, res, next) => {
    if (!['customer', 'organizer'].includes(req.platformUser.role)) {
      return res.status(403).json({ error: 'Customer access is required.' });
    }
    return next();
  });

  router.get('/profile', asyncHandler(async (req, res) => {
    const user = req.platformUser;
    return res.json({
      success: true,
      data: {
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  }));

  router.patch('/profile', asyncHandler(async (req, res) => {
    const parsed = z.object({
      fullName: z.string().trim().min(2).max(160),
      phone: z.string().trim().max(40).optional().default(''),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Profile details are invalid.' });
    }

    await database.inTransaction(async (tx) => {
      const updated = await tx.query(
        'UPDATE users SET full_name = $1, phone = $2 WHERE id = $3 RETURNING id',
        [parsed.data.fullName, parsed.data.phone || null, req.platformUser.id],
      );
      if (!updated.rows[0]) throw httpError('User not found.', 404);
      await tx.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'customer.profile_updated', 'user', $2, $3::jsonb, $4)`,
        [
          req.platformUser.id,
          String(req.platformUser.id),
          JSON.stringify({ fields: ['full_name', 'phone'] }),
          req.ip || null,
        ],
      );
    });

    return res.json({
      data: {
        fullName: parsed.data.fullName,
        email: req.platformUser.email,
        phone: parsed.data.phone || null,
        role: req.platformUser.role,
      },
    });
  }));

  router.post('/profile/password', asyncHandler(async (req, res) => {
    const parsed = z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(16).refine(isStrongPassword),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Provide your current password and a 12–16 character new password with uppercase, lowercase, and a number.',
      });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({ error: 'Choose a new password different from your current password.' });
    }

    try {
      await database.inTransaction(async (tx) => {
        const account = await tx.query(
          'SELECT password_hash FROM users WHERE id = $1 FOR UPDATE',
          [req.platformUser.id],
        );
        if (!account.rows[0] || !await bcrypt.compare(parsed.data.currentPassword, account.rows[0].password_hash)) {
          throw httpError('The current password is incorrect.', 400);
        }
        const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
        await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
          passwordHash,
          req.platformUser.id,
        ]);
        await tx.query(
          'DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2',
          [req.platformUser.id, hashToken(req.cookies.platform_session)],
        );
        await tx.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, severity)
           VALUES ($1, 'customer.password_changed', 'user', $2, $3::jsonb, $4, 'critical')`,
          [
            req.platformUser.id,
            String(req.platformUser.id),
            JSON.stringify({ otherSessionsInvalidated: true }),
            req.ip || null,
          ],
        );
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }

    return res.json({ message: 'Password changed. Other account sessions have been signed out.' });
  }));

  return router;
}
