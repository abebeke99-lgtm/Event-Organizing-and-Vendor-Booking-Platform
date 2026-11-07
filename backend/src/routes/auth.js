import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { hashToken, writeAudit } from '../lib/security.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { isStrongPassword } from '../lib/authFlow.js';
import { getPasswordResetEmailConfig, getSmtpDiagnostic, sendPasswordResetOtpEmail } from '../lib/passwordResetEmail.js';
import {
  createPasswordResetOtp,
  hashPasswordResetOtp,
  verifyPasswordResetOtp,
} from '../lib/passwordResetOtp.js';
import { optionalAdmin, requireAdmin } from '../middleware/requireAdmin.js';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { platformLoginHandler, platformLoginLimiter } from './platform.js';

const cookieOptions = () => {
  return {
    ...getCookieOptions(),
    maxAge: 8 * 60 * 60 * 1000,
  };
};

const genericResetMessage = 'If an account exists with this email, a verification code will be sent.';
const invalidOtpMessage = 'The verification code is invalid or has expired.';
const resetAuthorizationMessage = 'Your reset authorization is invalid or has expired. Verify your email code again.';
const resetCookieName = 'password_reset_authorization';
const OTP_EXPIRY_MINUTES = 5;
const RESET_AUTHORIZATION_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const emailSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
}).strict();
const verifyOtpSchema = emailSchema.extend({
  otp: z.string().regex(/^[0-9]{6}$/),
}).strict();
const resetPasswordSchema = z.object({
  newPassword: z.string().min(1).max(256),
}).strict();
const isStrongAdminPassword = (password) => Array.from(password).length >= 12
  && Array.from(password).length <= 16
  && Buffer.byteLength(password, 'utf8') <= 72;

export function createAuthRouter({
  database = pool,
  emailConfigured = () => Boolean(getPasswordResetEmailConfig()),
  emailSender = sendPasswordResetOtpEmail,
  passwordHasher = (password) => bcrypt.hash(password, 12),
  otpGenerator = createPasswordResetOtp,
  otpHasher = hashPasswordResetOtp,
  otpVerifier = verifyPasswordResetOtp,
} = {}) {
  const router = Router();
  const sessionCheckLimiter = createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    skipSuccessfulRequests: true,
    message: 'Too many session checks. Please try again later.',
  });
  const requestOtpLimiter = createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    message: 'Too many verification code requests. Please try again later.',
  });
  const resendOtpLimiter = createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    message: 'Too many verification code requests. Please try again later.',
  });
  const verifyOtpLimiter = createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many verification attempts. Please try again later.',
  });
  const resetPasswordLimiter = createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many password reset attempts. Please try again later.',
  });

  const requestOtp = asyncHandler(async (req, res) => {
    const parsed = emailSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!emailConfigured()) {
      console.error('Password reset unavailable: SMTP configuration is incomplete.');
      return res.status(503).json({ error: 'Password reset is temporarily unavailable.' });
    }

    const otp = otpGenerator();
    const { hash: otpHash, salt: otpSalt } = await otpHasher(otp);
    const [users] = await database.execute(
      'SELECT id, full_name, email FROM users WHERE email = ? LIMIT 1',
      [parsed.data.email]
    );
    const user = users[0];
    if (!user) return res.status(202).json({ message: genericResetMessage });

    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [user.id]);
      const [challenges] = await connection.execute(
        `SELECT id, (last_sent_at > DATE_SUB(NOW(), INTERVAL ${RESEND_COOLDOWN_SECONDS} SECOND)) AS cooldown_active
         FROM password_reset_otp_challenges WHERE user_id = ? LIMIT 1 FOR UPDATE`,
        [user.id]
      );
      if (challenges[0]?.cooldown_active) {
        await connection.rollback();
        return res.status(202).json({ message: genericResetMessage });
      }

      await connection.execute(
        `INSERT INTO password_reset_otp_challenges
          (user_id, otp_hash, otp_salt, expires_at, failed_attempts, consumed_at,
           reset_token_hash, reset_token_expires_at, reset_token_used_at, last_sent_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${OTP_EXPIRY_MINUTES} MINUTE), 0, NULL,
           NULL, NULL, NULL, NOW())
         ON DUPLICATE KEY UPDATE otp_hash = VALUES(otp_hash), otp_salt = VALUES(otp_salt),
           expires_at = VALUES(expires_at), failed_attempts = 0, consumed_at = NULL,
           reset_token_hash = NULL, reset_token_expires_at = NULL, reset_token_used_at = NULL,
           last_sent_at = NOW()`,
        [user.id, otpHash, otpSalt]
      );
      await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.status(202).json({ message: genericResetMessage });
    setImmediate(() => {
      Promise.resolve().then(() => emailSender({ email: user.email, name: user.full_name, otp })).catch(async (error) => {
        console.error('Password reset email delivery failed.', getSmtpDiagnostic(error));
        try {
          await database.execute(
            `UPDATE password_reset_otp_challenges
             SET expires_at = NOW(), consumed_at = NOW()
             WHERE user_id = ? AND otp_hash = ?`,
            [user.id, otpHash]
          );
        } catch (invalidationError) {
          console.error('Failed to invalidate undelivered password reset code.', invalidationError?.code || invalidationError?.name || 'DATABASE_ERROR');
        }
      });
    });
  });

  router.post(['/forgot-password/otp', '/forgot-password'], requestOtpLimiter, requestOtp);
  router.post('/resend-reset-otp', resendOtpLimiter, requestOtp);

  router.post('/verify-reset-otp', verifyOtpLimiter, asyncHandler(async (req, res) => {
    const parsed = verifyOtpSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: invalidOtpMessage });
    const [users] = await database.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [parsed.data.email]);
    const user = users[0];
    if (!user) return res.status(400).json({ error: invalidOtpMessage });

    const connection = await database.getConnection();
    let authorizationToken;
    try {
      await connection.beginTransaction();
      const [challenges] = await connection.execute(
        `SELECT id, otp_hash, otp_salt, failed_attempts, consumed_at,
           (expires_at > NOW()) AS is_unexpired
         FROM password_reset_otp_challenges WHERE user_id = ? LIMIT 1 FOR UPDATE`,
        [user.id]
      );
      const challenge = challenges[0];
      if (!challenge || challenge.consumed_at || !challenge.is_unexpired || challenge.failed_attempts >= 5) {
        await connection.rollback();
        return res.status(400).json({ error: invalidOtpMessage });
      }
      if (!await otpVerifier(parsed.data.otp, challenge.otp_hash, challenge.otp_salt)) {
        await connection.execute(
          'UPDATE password_reset_otp_challenges SET failed_attempts = failed_attempts + 1 WHERE id = ?',
          [challenge.id]
        );
        await connection.commit();
        return res.status(400).json({ error: invalidOtpMessage });
      }

      authorizationToken = randomBytes(32).toString('base64url');
      await connection.execute(
        `UPDATE password_reset_otp_challenges
         SET consumed_at = NOW(), reset_token_hash = ?, reset_token_expires_at = DATE_ADD(NOW(), INTERVAL ${RESET_AUTHORIZATION_MINUTES} MINUTE),
           reset_token_used_at = NULL
         WHERE id = ?`,
        [hashToken(authorizationToken), challenge.id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.cookie(resetCookieName, authorizationToken, {
      ...cookieOptions(),
      path: '/api/auth',
      maxAge: RESET_AUTHORIZATION_MINUTES * 60 * 1000,
    });
    return res.json({ success: true, message: 'Verification successful.' });
  }));

  router.post('/reset-password', resetPasswordLimiter, asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter a password that meets the password requirements.' });
    const authorizationToken = req.cookies?.[resetCookieName];
    if (!authorizationToken) return res.status(400).json({ error: resetAuthorizationMessage });

    const passwordHash = await passwordHasher(parsed.data.newPassword);
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [tokens] = await connection.execute(
        `SELECT user_id FROM password_reset_otp_challenges
         WHERE reset_token_hash = ? AND reset_token_used_at IS NULL AND reset_token_expires_at > NOW()
         LIMIT 1 FOR UPDATE`,
        [hashToken(authorizationToken)]
      );
      const reset = tokens[0];
      if (!reset) {
        await connection.rollback();
        res.clearCookie(resetCookieName, getCookieOptions({ path: '/api/auth' }));
        return res.status(400).json({ error: resetAuthorizationMessage });
      }

      const [roles] = await connection.execute(
        `SELECT MAX(r.is_admin = TRUE) AS has_admin_role
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?`,
        [reset.user_id]
      );
      const isAdmin = Number(roles[0]?.has_admin_role) === 1;
      const passwordValid = isAdmin
        ? isStrongAdminPassword(parsed.data.newPassword)
        : isStrongPassword(parsed.data.newPassword);
      if (!passwordValid) {
        await connection.rollback();
        return res.status(400).json({ error: 'Enter a password that meets the password requirements.' });
      }

      const [updated] = await connection.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [passwordHash, reset.user_id]
      );
      if (updated.affectedRows !== 1) {
        await connection.rollback();
        return res.status(400).json({ error: resetAuthorizationMessage });
      }

      await connection.execute('DELETE FROM password_reset_otp_challenges WHERE user_id = ?', [reset.user_id]);
      await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [reset.user_id]);
      await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [reset.user_id]);
      await connection.execute('DELETE FROM admin_sessions WHERE user_id = ?', [reset.user_id]);
      await writeAudit(connection, {
        actorId: reset.user_id,
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: reset.user_id,
        ip: req.ip,
      });
      await connection.commit();
      res.clearCookie(resetCookieName, getCookieOptions({ path: '/api/auth' }));
      return res.json({ success: true, message: 'Password reset successful.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }));

  router.post('/login', platformLoginLimiter, platformLoginHandler);

  router.post('/logout', async (req, res, next) => {
    const adminToken = req.cookies?.admin_session;
    const platformToken = req.cookies?.platform_session;
    res.clearCookie('admin_session', { ...cookieOptions(), maxAge: undefined });
    res.clearCookie('platform_session', { ...cookieOptions(), maxAge: undefined });
    try {
      if (adminToken) {
        const [sessions] = await database.execute('SELECT user_id FROM admin_sessions WHERE token_hash = ?', [hashToken(adminToken)]);
        await database.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(adminToken)]);
        if (sessions.length) await writeAudit(database, { actorId: sessions[0].user_id, action: 'auth.logout', entityType: 'session', ip: req.ip });
      }
      if (platformToken) {
        const [sessions] = await database.execute('SELECT user_id FROM user_sessions WHERE token_hash = ?', [hashToken(platformToken)]);
        await database.execute('DELETE FROM user_sessions WHERE token_hash = ?', [hashToken(platformToken)]);
        if (sessions.length) await writeAudit(database, { actorId: sessions[0].user_id, action: 'auth.logout', entityType: 'session', ip: req.ip });
      }
      res.status(204).end();
    } catch (error) { next(error); }
  });

  router.get('/me', sessionCheckLimiter, optionalAdmin, (req, res) => res.json({ user: req.admin }));
  return router;
}

export default createAuthRouter();
