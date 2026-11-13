import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import {
  createPasswordResetOtp,
  hashPasswordResetOtp,
  verifyPasswordResetOtp,
} from '../lib/passwordResetOtp.js';
import { getPasswordResetEmailConfig } from '../lib/passwordResetEmail.js';
import {
  sendAdminEmailChangeNotice,
  sendAdminEmailChangeOtpEmail,
} from '../lib/emailChangeEmail.js';
import { hashToken, newSessionToken } from '../lib/security.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const profilePatchSchema = z.object({
  full_name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().max(40).nullable().optional(),
}).strict();

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().refine((password) => {
    const length = Array.from(password).length;
    return length >= 12 && length <= 16 && Buffer.byteLength(password, 'utf8') <= 72;
  }),
}).strict();

const emailChangeSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  currentPassword: z.string().min(1).max(256),
}).strict();

const emailChangeLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many email verification attempts. Try again later.',
});
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

function statusError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function writeAudit(executor, { actorId, action, details, ip, severity = 'info' }) {
  await executor.query(
    `INSERT INTO audit_logs
      (actor_id, action, entity_type, entity_id, details, ip_address, outcome, severity)
     VALUES ($1, $2, 'user', $3, $4::jsonb, $5, 'success', $6)`,
    [actorId, action, String(actorId), JSON.stringify(details), ip || null, severity],
  );
}

async function loadProfile(database, userId) {
  const result = await database.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
            (u.profile_photo IS NOT NULL) AS has_profile_photo,
            STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1
     GROUP BY u.id, u.full_name, u.email, u.phone, u.status, u.created_at, u.profile_photo`,
    [userId],
  );
  return result.rows[0] || null;
}

function sessionCookie(res, name, token, expiresAt) {
  res.cookie(name, token, getCookieOptions({ expires: expiresAt }));
}

export function createPostgresAdminProfileRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();
  router.use(requireAdmin);

  router.get('/profile', asyncHandler(async (req, res) => {
    const profile = await loadProfile(database, req.admin.id);
    if (!profile) return res.status(404).json({ error: 'Administrator account not found.' });
    return res.json({ data: profile });
  }));

  router.patch('/profile', asyncHandler(async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data || {}).length) {
      return res.status(400).json({ error: 'Provide a valid name or phone number.' });
    }

    try {
      await database.inTransaction(async (transaction) => {
        const currentResult = await transaction.query(
          'SELECT id, full_name, phone FROM users WHERE id = $1 FOR UPDATE',
          [req.admin.id],
        );
        const current = currentResult.rows[0];
        if (!current) throw statusError('Administrator account not found.', 404);
        const fields = Object.keys(parsed.data).filter((field) => current[field] !== parsed.data[field]);
        if (!fields.length) return;
        const values = fields.map((field) => parsed.data[field]);
        values.push(req.admin.id);
        await transaction.query(
          `UPDATE users SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
           WHERE id = $${values.length}`,
          values,
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'admin.profile_updated',
          details: { fields },
          ip: req.ip,
        });
      });
      const user = await loadProfile(database, req.admin.id);
      if (!user) return res.status(404).json({ error: 'Administrator account not found.' });
      return res.json({ user });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }));

  router.post('/profile/password', asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Provide your current password and a new password between 12 and 16 characters (maximum 72 UTF-8 bytes).',
      });
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({ error: 'Choose a new password different from your current password.' });
    }

    const cookieName = req.cookies?.admin_session ? 'admin_session' : 'platform_session';
    const nextToken = newSessionToken();
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    try {
      await database.inTransaction(async (transaction) => {
        const accountResult = await transaction.query(
          'SELECT password_hash FROM users WHERE id = $1 FOR UPDATE',
          [req.admin.id],
        );
        const account = accountResult.rows[0];
        if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
          throw statusError('The current password is incorrect.', 400);
        }
        const nextPasswordHash = await bcrypt.hash(parsed.data.newPassword, 12);
        await transaction.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
          nextPasswordHash,
          req.admin.id,
        ]);
        await transaction.query('DELETE FROM admin_sessions WHERE user_id = $1', [req.admin.id]);
        await transaction.query('DELETE FROM user_sessions WHERE user_id = $1', [req.admin.id]);
        const table = cookieName === 'admin_session' ? 'admin_sessions' : 'user_sessions';
        await transaction.query(
          `INSERT INTO ${table} (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
          [hashToken(nextToken), req.admin.id, expiresAt],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'admin.password_changed',
          details: { sessions_invalidated: true },
          ip: req.ip,
          severity: 'critical',
        });
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      throw error;
    }

    sessionCookie(res, cookieName, nextToken, expiresAt);
    return res.json({ message: 'Password changed. Other account sessions have been signed out.' });
  }));

  router.post('/profile/email-change', emailChangeLimiter, asyncHandler(async (req, res) => {
    const parsed = emailChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Provide a valid email address and your current password.' });
    }
    const services = req.app.locals.adminEmailChange || {};
    const emailConfigured = services.emailConfigured || (() => Boolean(getPasswordResetEmailConfig()));
    if (!emailConfigured()) {
      return res.status(503).json({ error: 'Email verification is temporarily unavailable.' });
    }

    const otp = (services.otpGenerator || createPasswordResetOtp)();
    const { hash: otpHash, salt: otpSalt } = await (services.otpHasher || hashPasswordResetOtp)(otp);
    let challengeId;
    let currentEmail;
    let fullName;

    try {
      await database.inTransaction(async (transaction) => {
        const accountResult = await transaction.query(
          'SELECT id, full_name, email, password_hash FROM users WHERE id = $1 FOR UPDATE',
          [req.admin.id],
        );
        const account = accountResult.rows[0];
        if (!account || !await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
          throw statusError('The current password is incorrect.', 400);
        }
        currentEmail = account.email;
        fullName = account.full_name;
        if (account.email.toLowerCase() === parsed.data.email) {
          throw statusError('Enter an email address different from your current address.', 400);
        }

        await transaction.query(
          `DELETE FROM admin_email_change_otp_challenges
           WHERE expires_at <= NOW() OR consumed_at IS NOT NULL`,
        );
        const existingEmail = await transaction.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
          [parsed.data.email, req.admin.id],
        );
        if (existingEmail.rows[0]) {
          throw statusError('An account with this email already exists.', 409);
        }

        const currentChallenge = await transaction.query(
          `SELECT last_sent_at > NOW() - INTERVAL '60 seconds' AS cooldown_active
           FROM admin_email_change_otp_challenges WHERE user_id = $1 LIMIT 1 FOR UPDATE`,
          [req.admin.id],
        );
        if (currentChallenge.rows[0]?.cooldown_active) {
          throw statusError('A verification code was sent recently. Try again shortly.', 429);
        }
        await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE user_id = $1', [
          req.admin.id,
        ]);
        const created = await transaction.query(
          `INSERT INTO admin_email_change_otp_challenges
            (user_id, current_email, pending_email, otp_hash, otp_salt, expires_at,
             failed_attempts, consumed_at, last_sent_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes', 0, NULL, NOW())
           RETURNING id`,
          [req.admin.id, account.email, parsed.data.email, otpHash, otpSalt],
        );
        challengeId = created.rows[0].id;
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'admin.profile_email_change_requested',
          details: { verification_sent: true },
          ip: req.ip,
        });
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account or pending request already uses this email.' });
      }
      throw error;
    }

    try {
      await (services.emailSender || sendAdminEmailChangeOtpEmail)({
        email: parsed.data.email,
        name: fullName,
        otp,
      });
    } catch (error) {
      try {
        await database.query(
          'DELETE FROM admin_email_change_otp_challenges WHERE id = $1 AND otp_hash = $2',
          [challengeId, otpHash],
        );
      } catch {
        // The challenge remains short-lived if the database is unavailable.
      }
      return res.status(503).json({
        error: 'The verification email could not be delivered. Try again later.',
      });
    }

    return res.status(202).json({
      message: 'A verification code was sent to the new email address.',
    });
  }));

  router.post('/profile/email-change/verify', emailChangeLimiter, asyncHandler(async (req, res) => {
    const parsed = z.object({ otp: z.string().regex(/^[0-9]{6}$/) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the six-digit verification code.' });

    const services = req.app.locals.adminEmailChange || {};
    const verification = await database.inTransaction(async (transaction) => {
      const accountResult = await transaction.query(
        'SELECT email FROM users WHERE id = $1 FOR UPDATE',
        [req.admin.id],
      );
      const account = accountResult.rows[0];
      const challengeResult = await transaction.query(
        `SELECT id, current_email, pending_email, otp_hash, otp_salt, expires_at, failed_attempts,
                expires_at <= NOW() AS expired
         FROM admin_email_change_otp_challenges WHERE user_id = $1 LIMIT 1 FOR UPDATE`,
        [req.admin.id],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) return { status: 400, error: 'No active email change verification was found.' };
      if (!account || account.email.toLowerCase() !== challenge.current_email.toLowerCase()) {
        await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE id = $1', [challenge.id]);
        return { status: 409, error: 'The account email changed. Request a new verification code.' };
      }
      if (challenge.expired || Number(challenge.failed_attempts) >= 5) {
        await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE id = $1', [challenge.id]);
        return {
          status: 400,
          error: 'The verification code expired or is no longer valid. Request a new code.',
        };
      }

      const valid = await (services.otpVerifier || verifyPasswordResetOtp)(
        parsed.data.otp,
        challenge.otp_hash,
        challenge.otp_salt,
      );
      if (!valid) {
        const attempts = Number(challenge.failed_attempts) + 1;
        if (attempts >= 5) {
          await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE id = $1', [challenge.id]);
          return { status: 400, error: 'The verification code is no longer valid. Request a new code.' };
        }
        await transaction.query(
          'UPDATE admin_email_change_otp_challenges SET failed_attempts = $1 WHERE id = $2',
          [attempts, challenge.id],
        );
        return { status: 400, error: 'The verification code is incorrect.' };
      }

      await transaction.query('SAVEPOINT admin_profile_email_update');
      try {
        await transaction.query('UPDATE users SET email = $1 WHERE id = $2', [
          challenge.pending_email,
          req.admin.id,
        ]);
      } catch (error) {
        if (error.code !== '23505') throw error;
        await transaction.query('ROLLBACK TO SAVEPOINT admin_profile_email_update');
        await transaction.query('RELEASE SAVEPOINT admin_profile_email_update');
        await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE id = $1', [challenge.id]);
        return { status: 409, error: 'An account with this email already exists.' };
      }
      await transaction.query('RELEASE SAVEPOINT admin_profile_email_update');
      await transaction.query('DELETE FROM admin_email_change_otp_challenges WHERE id = $1', [challenge.id]);

      const sessionCookieName = req.cookies?.admin_session ? 'admin_session' : 'platform_session';
      const currentToken = req.cookies?.[sessionCookieName];
      if (sessionCookieName === 'admin_session') {
        await transaction.query(
          'DELETE FROM admin_sessions WHERE user_id = $1 AND token_hash <> $2',
          [req.admin.id, hashToken(currentToken)],
        );
        await transaction.query('DELETE FROM user_sessions WHERE user_id = $1', [req.admin.id]);
      } else {
        await transaction.query('DELETE FROM admin_sessions WHERE user_id = $1', [req.admin.id]);
        await transaction.query(
          'DELETE FROM user_sessions WHERE user_id = $1 AND token_hash <> $2',
          [req.admin.id, hashToken(currentToken)],
        );
      }
      await writeAudit(transaction, {
        actorId: req.admin.id,
        action: 'admin.profile_email_changed',
        details: { sessions_revoked: true },
        ip: req.ip,
        severity: 'critical',
      });
      return { email: challenge.pending_email, previousEmail: challenge.current_email };
    });

    if (verification.status) {
      return res.status(verification.status).json({ error: verification.error });
    }
    setImmediate(() => {
      Promise.resolve()
        .then(() => (services.noticeSender || sendAdminEmailChangeNotice)({
          email: verification.previousEmail,
        }))
        .catch(() => {});
    });
    return res.json({ data: { email: verification.email } });
  }));

  return router;
}
