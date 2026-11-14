import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { buildRoleRedirect, hashToken, normalizeEmail } from '../lib/authFlow.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import {
  REMEMBERED_SESSION_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  setSessionCookie,
} from '../lib/sessionCookie.js';
import { DEFAULT_SYSTEM_SETTINGS, mergeSystemSettings } from '../lib/systemSettings.js';
import { getSystemLockState } from '../lib/rbac.js';
import { newSessionToken } from '../lib/security.js';
import { isTransientPostgresError } from '../lib/postgresRetry.js';
import { normalizeDatabaseAdapter } from '../db.js';
import {
  getPasswordResetEmailConfig,
  getSmtpDiagnostic,
  sendPasswordChangedEmail,
  sendPasswordResetOtpEmail,
} from '../lib/passwordResetEmail.js';
import {
  createPasswordResetCode,
  hashPasswordResetCode,
  hashPasswordResetEmailKey,
  verifyPasswordResetCode,
} from '../lib/passwordResetSecurity.js';

const emailSchema = z.string().trim().email().max(254).transform(normalizeEmail);
const registrationLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many registration attempts. Please try again later.',
});
const resetIpLimits = {
  forgot: createAuthRateLimiter({ windowMs: 15 * 60 * 1000, limit: 20, message: 'Too many requests. Please try again later.' }),
  verify: createAuthRateLimiter({ windowMs: 15 * 60 * 1000, limit: 30, message: 'Too many requests. Please try again later.' }),
  reset: createAuthRateLimiter({ windowMs: 15 * 60 * 1000, limit: 20, message: 'Too many requests. Please try again later.' }),
};
const resetEmailLimits = {
  forgot: createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    message: 'Too many requests. Please try again later.',
    keyGenerator: (req) => hashPasswordResetEmailKey(req.body?.email),
  }),
  verify: createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many requests. Please try again later.',
    keyGenerator: (req) => hashPasswordResetEmailKey(req.body?.email),
  }),
  reset: createAuthRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: 'Too many requests. Please try again later.',
    keyGenerator: (req) => hashPasswordResetEmailKey(req.body?.email),
  }),
};
const setPasswordLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  message: 'Too many password setup attempts. Please try again later.',
});
const loginLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-in attempts. Please try again later.',
  skipSuccessfulRequests: true,
});
function clearSessionCookie(res) {
  res.clearCookie('platform_session', getCookieOptions());
}

function query(database, sql, values = []) {
  if (typeof database?.query !== 'function') {
    throw new TypeError('PostgreSQL database adapter is unavailable.');
  }
  return database.query(sql, values);
}

async function inTransaction(database, work) {
  if (typeof database?.inTransaction !== 'function') {
    throw new TypeError('PostgreSQL transaction support is unavailable.');
  }
  return database.inTransaction(work);
}

async function writeAudit(executor, { actorId, action, entityId, details, ip }) {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, 'user', $3, $4::jsonb, $5)`,
    [actorId, action, String(entityId), JSON.stringify(details), ip || null],
  );
}

async function createSession(executor, userId, lifetimeMs = SESSION_LIFETIME_MS) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + lifetimeMs);
  await executor.query(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  );
  return token;
}

export async function createRegistrationNotifications(executor, {
  name,
  userId,
  role = 'customer',
}) {
  const setting = await executor.query(
    `SELECT setting_value FROM system_settings
     WHERE setting_key = 'notify_admin_user_registrations'`,
  );
  if (setting.rows[0] && !['true', '1'].includes(String(setting.rows[0].setting_value).toLowerCase())) {
    return;
  }
  const admins = await executor.query(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active' AND r.is_admin = TRUE AND r.is_active = TRUE`,
  );
  for (const admin of admins.rows) {
    const notification = await executor.query(
      `INSERT INTO notifications
         (user_id, title, message, notification_type, related_entity_type, related_entity_id,
          idempotency_key, delivery_channel, delivery_status)
       VALUES ($1, $2, $3, 'user_registration', 'user', $4, $5, 'in_app', 'delivered')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        admin.id,
        'New user registration',
        `${name} registered with the ${role} role.`,
        String(userId),
        `user-registration:${userId}:${admin.id}`,
      ],
    );
    if (notification.rows[0]) {
      await executor.query(
        `INSERT INTO notification_history (notification_id, actor_id, action, details)
         VALUES ($1, $2, 'created', $3::jsonb)`,
        [notification.rows[0].id, userId, JSON.stringify({ source: 'user_registration', channel: 'in_app' })],
      );
    }
  }
}

export function createPostgresAuthRouter({
  database,
  adminNamespace = false,
  otpHmacSecret = process.env.OTP_HMAC_SECRET,
  otpExpiryMinutes = process.env.OTP_EXPIRY_MINUTES || '10',
  resetOtpEmailSender = sendPasswordResetOtpEmail,
  passwordChangedEmailSender = sendPasswordChangedEmail,
  emailConfiguration = getPasswordResetEmailConfig(),
}) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/availability', async (req, res, next) => {
    try {
      const result = await query(database, 'SELECT setting_key, setting_value FROM system_settings');
      const settings = mergeSystemSettings(result.rows);
      req.app.locals.systemSettings = { ...DEFAULT_SYSTEM_SETTINGS, ...settings };
      const platformState = getSystemLockState(settings);
      return res.json({
        data: {
          platformName: settings.platform_name,
          platformDescription: settings.platform_description,
          maintenanceMode: platformState.locked,
          maintenanceMessage: settings.maintenance_message,
          publicRegistrationEnabled: settings.public_registration_enabled,
          defaultRegistrationRole: settings.default_registration_role,
          supportEmail: settings.support_email,
          supportPhone: settings.support_phone,
          brandingLogoUrl: settings.branding_logo_url,
          platformLocale: settings.platform_locale,
          platformCurrency: settings.platform_currency,
          reportTimezone: settings.report_timezone,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/register', registrationLimiter, async (req, res, next) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(160),
      email: emailSchema,
      password: z.string()
        .min(8, 'Password must be at least 8 characters.')
        .max(128, 'Password must be 128 characters or fewer.')
        .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
          message: 'Password must use 72 UTF-8 bytes or fewer.',
        }),
      role: z.string().optional(),
    }).strict();
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration.' });
    }

    try {
      const registrationSetting = await query(
        database,
        `SELECT setting_value FROM system_settings
         WHERE setting_key = 'public_registration_enabled'`,
      );
      if (registrationSetting.rows[0]
        && !['true', '1'].includes(String(registrationSetting.rows[0].setting_value).toLowerCase())) {
        return res.status(403).json({ error: 'Public registration is currently disabled.' });
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const preferredLanguage = req.language === 'am' ? 'am' : 'en';
      const normalizedEmail = parsed.data.email;
      const roleName = 'customer';
      const created = await inTransaction(database, async (tx) => {
        const role = await tx.query(
          `SELECT id FROM roles
           WHERE LOWER(name) = $1 AND is_active = TRUE AND is_admin = FALSE
           LIMIT 1`,
          [roleName],
        );
        if (!role.rows[0]) {
          const error = new Error('The selected account type is unavailable.');
          error.status = 503;
          throw error;
        }
        const inserted = await tx.query(
          `INSERT INTO users (full_name, email, password_hash, status, preferred_language)
           VALUES ($1, $2, $3, 'active', $4)
           RETURNING id`,
          [parsed.data.name, normalizedEmail, passwordHash, preferredLanguage],
        );
        const userId = inserted.rows[0].id;
        await tx.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [userId, role.rows[0].id],
        );
        await writeAudit(tx, {
          actorId: userId,
          action: 'auth.register',
          entityId: userId,
          details: { role: roleName },
          ip: req.ip,
        });
        await createRegistrationNotifications(tx, { name: parsed.data.name, userId, role: roleName });
        return { id: userId };
      });

      return res.status(201).json({
        data: {
          user: {
            id: created.id,
            name: parsed.data.name,
            full_name: parsed.data.name,
            email: normalizedEmail,
            role: roleName,
            preferred_language: preferredLanguage,
          },
        },
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with this email or phone number already exists.' });
      }
      return next(error);
    }
  });

  router.post('/set-password', setPasswordLimiter, async (req, res, next) => {
    const parsed = z.object({
      token: z.string().min(32).max(128),
      password: z.string()
        .min(8, 'Password must be at least 8 characters.')
        .max(128, 'Password must be 128 characters or fewer.')
        .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
          message: 'Password must use 72 UTF-8 bytes or fewer.',
        }),
    }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password setup request.' });
    }

    try {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      await inTransaction(database, async (tx) => {
        const token = await tx.query(
          `SELECT prt.user_id, u.email, u.status
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
           WHERE prt.token_hash = $1 AND prt.expires_at > NOW()
             AND prt.used_at IS NULL
           FOR UPDATE OF prt, u`,
          [hashToken(parsed.data.token)],
        );
        const invitation = token.rows[0];
        if (!invitation || invitation.status !== 'pending') {
          throw Object.assign(new Error('This invitation link has expired or has already been used.'), { status: 400 });
        }
        await tx.query(
          "UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2",
          [passwordHash, invitation.user_id],
        );
        await tx.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1',
          [invitation.user_id],
        );
        await writeAudit(tx, {
          actorId: invitation.user_id,
          action: 'auth.invitation_password_set',
          entityId: invitation.user_id,
          details: {},
          ip: req.ip,
        });
      });
      return res.json({ success: true, message: 'Password set successfully.' });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  if (!adminNamespace) {
    const resetCryptographyReady = () => {
      const expiry = Number(otpExpiryMinutes);
      return typeof otpHmacSecret === 'string' && Buffer.byteLength(otpHmacSecret, 'utf8') >= 32
        && Number.isInteger(expiry) && expiry >= 1 && expiry <= 30;
    };
    const resetEmailReady = () => Boolean(emailConfiguration);
    const resetServiceUnavailable = (res) => res.status(503).json({
      error: 'Password reset is temporarily unavailable. Please try again later.',
    });
    const genericResetResponse = {
      message: 'If an account exists for this email, a verification code has been sent.',
    };
    const resetEmailSchema = z.object({ email: emailSchema }).strict();
    const resetVerifySchema = resetEmailSchema.extend({ code: z.string().regex(/^\d{6}$/) }).strict();
    const resetPasswordSchema = z.object({
      email: emailSchema,
      resetSessionToken: z.string().min(32).max(256),
      newPassword: z.string()
        .min(8)
        .max(128)
        .refine((value) => Buffer.byteLength(value, 'utf8') <= 72)
        .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)),
      confirmPassword: z.string().min(1).max(128),
    }).strict().refine((value) => value.newPassword === value.confirmPassword, {
      message: 'Passwords do not match.',
      path: ['confirmPassword'],
    });

    router.post('/account/password/forgot',
      resetIpLimits.forgot,
      resetEmailLimits.forgot,
      async (req, res, next) => {
        const parsed = resetEmailSchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
        if (!resetCryptographyReady() || !resetEmailReady()) {
          console.error('Password reset OTP delivery is unavailable: required configuration is missing or invalid.');
          return resetServiceUnavailable(res);
        }
        try {
          const expiryMinutes = Number(otpExpiryMinutes);
          const challenge = await inTransaction(database, async (tx) => {
            const found = await tx.query(
              `SELECT id, full_name, email, status, preferred_language
               FROM users WHERE LOWER(email) = $1 LIMIT 1 FOR UPDATE`,
              [parsed.data.email],
            );
            const user = found.rows[0];
            const userId = user?.id ?? 0;
            const accountCanReceiveEmail = user?.status === 'active';
            const cooldown = await tx.query(
              `SELECT id FROM password_reset_otps
               WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
               ORDER BY created_at DESC LIMIT 1`,
              [userId],
            );
            await tx.query(
              `UPDATE password_reset_otps SET used_at = NOW()
               WHERE user_id = $1 AND used_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM password_reset_otps
                   WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
                 )`,
              [userId],
            );
            await tx.query(
              `UPDATE password_reset_sessions SET used_at = NOW()
               WHERE user_id = $1 AND used_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM password_reset_otps
                   WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
                 )`,
              [userId],
            );
            await tx.query(
              `UPDATE password_reset_otp_challenges
               SET consumed_at = NOW(), reset_token_used_at = NOW()
               WHERE user_id = $1
                 AND NOT EXISTS (
                   SELECT 1 FROM password_reset_otps
                   WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
                 )`,
              [userId],
            );
            const code = createPasswordResetCode();
            const inserted = await tx.query(
              `INSERT INTO password_reset_otps
                 (user_id, otp_hash, expires_at, ip, user_agent)
               SELECT $1, $2, NOW() + ($3 * INTERVAL '1 minute'), $4, $5
               WHERE $1 <> 0
                 AND EXISTS (SELECT 1 FROM users WHERE id = $1 AND status = 'active')
                 AND NOT EXISTS (
                   SELECT 1 FROM password_reset_otps
                   WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
                 )
               RETURNING id`,
              [
                userId,
                hashPasswordResetCode(code, userId, otpHmacSecret),
                expiryMinutes,
                req.ip || null,
                String(req.get('user-agent') || '').slice(0, 512) || null,
              ],
            );
            if (!accountCanReceiveEmail || cooldown.rows[0] || !inserted.rows[0]) return null;
            return { id: inserted.rows[0].id, user, code };
          });
          if (challenge) {
            setImmediate(() => {
              Promise.resolve().then(() => resetOtpEmailSender({
                email: challenge.user.email,
                name: challenge.user.full_name,
                otp: challenge.code,
                language: challenge.user.preferred_language === 'am' ? 'am' : 'en',
                expiryMinutes: Number(otpExpiryMinutes),
              })).catch(async (error) => {
                console.error('Password reset OTP email delivery failed.', getSmtpDiagnostic(error));
                try {
                  await query(
                    database,
                    'UPDATE password_reset_otps SET used_at = NOW() WHERE id = $1 AND used_at IS NULL',
                    [challenge.id],
                  );
                } catch (cleanupError) {
                  console.error('Failed to invalidate an undelivered password reset challenge.');
                }
              });
            });
          }
          return res.status(202).json(genericResetResponse);
        } catch (error) {
          return next(error);
        }
      });

    router.post('/account/password/verify-otp',
      resetIpLimits.verify,
      resetEmailLimits.verify,
      async (req, res, next) => {
        const parsed = resetVerifySchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).json({ error: 'Invalid or expired code.' });
        if (!resetCryptographyReady()) return resetServiceUnavailable(res);
        try {
          const result = await inTransaction(database, async (tx) => {
            const found = await tx.query(
              `SELECT otp.id, otp.user_id, otp.otp_hash, otp.expires_at, otp.attempts,
                      u.status
               FROM password_reset_otps otp
               JOIN users u ON u.id = otp.user_id
               WHERE LOWER(u.email) = $1 AND otp.used_at IS NULL
               ORDER BY otp.created_at DESC LIMIT 1
               FOR UPDATE OF otp`,
              [parsed.data.email],
            );
            const challenge = found.rows[0];
            if (!challenge || challenge.status !== 'active'
              || new Date(challenge.expires_at).getTime() <= Date.now()
              || Number(challenge.attempts) >= 5) return null;
            if (!verifyPasswordResetCode(
              parsed.data.code,
              challenge.user_id,
              String(challenge.otp_hash).trim(),
              otpHmacSecret,
            )) {
              const attempts = Number(challenge.attempts) + 1;
              await tx.query(
                `UPDATE password_reset_otps
                 SET attempts = $1, used_at = CASE WHEN $1 >= 5 THEN NOW() ELSE used_at END
                 WHERE id = $2`,
                [attempts, challenge.id],
              );
              return null;
            }
            await tx.query('UPDATE password_reset_otps SET used_at = NOW() WHERE id = $1', [challenge.id]);
            const resetSessionToken = newSessionToken();
            await tx.query(
              `INSERT INTO password_reset_sessions (user_id, token_hash, expires_at)
               VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
              [challenge.user_id, hashToken(resetSessionToken)],
            );
            return { resetSessionToken };
          });
          if (!result) return res.status(400).json({ error: 'Invalid or expired code.' });
          return res.json(result);
        } catch (error) {
          return next(error);
        }
      });

    router.post('/account/password/reset',
      resetIpLimits.reset,
      resetEmailLimits.reset,
      async (req, res, next) => {
        const parsed = resetPasswordSchema.safeParse(req.body || {});
        if (!parsed.success) {
          const mismatch = parsed.error.issues.some((issue) => issue.path.includes('confirmPassword'));
          return res.status(400).json({
            error: mismatch ? 'Passwords do not match.' : 'Password must be at least 8 characters and include uppercase, lowercase, and a number.',
          });
        }
        if (!resetCryptographyReady()) return resetServiceUnavailable(res);
        try {
          const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
          const changed = await inTransaction(database, async (tx) => {
            const found = await tx.query(
              `SELECT reset.id AS reset_session_id, reset.user_id, u.email, u.full_name,
                      u.password_hash, u.status, u.preferred_language
               FROM password_reset_sessions reset
               JOIN users u ON u.id = reset.user_id
               WHERE reset.token_hash = $1 AND LOWER(u.email) = $2
                 AND reset.used_at IS NULL AND reset.expires_at > NOW()
               LIMIT 1 FOR UPDATE OF reset, u`,
              [hashToken(parsed.data.resetSessionToken), parsed.data.email],
            );
            const user = found.rows[0];
            if (!user || user.status !== 'active') {
              const error = new Error('Invalid or expired reset session.');
              error.status = 400;
              throw error;
            }
            if (user.password_hash && await bcrypt.compare(parsed.data.newPassword, user.password_hash)) {
              const error = new Error('New password must be different from your current password.');
              error.status = 400;
              throw error;
            }
            await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.user_id]);
            await tx.query(
              'UPDATE password_reset_sessions SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
              [user.user_id],
            );
            await tx.query(
              'UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
              [user.user_id],
            );
            await tx.query('DELETE FROM password_reset_otp_challenges WHERE user_id = $1', [user.user_id]);
            await tx.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.user_id]);
            await tx.query('DELETE FROM user_sessions WHERE user_id = $1', [user.user_id]);
            await tx.query('DELETE FROM admin_sessions WHERE user_id = $1', [user.user_id]);
            await writeAudit(tx, {
              actorId: user.user_id,
              action: 'auth.password_reset',
              entityId: user.user_id,
              details: {},
              ip: req.ip,
            });
            return {
              email: user.email,
              name: user.full_name,
              language: user.preferred_language === 'am' ? 'am' : 'en',
            };
          });
          setImmediate(() => {
            Promise.resolve().then(() => passwordChangedEmailSender(changed)).catch((error) => {
              console.error('Password change notification email failed.', getSmtpDiagnostic(error));
            });
          });
          return res.json({ message: 'Password reset successfully. Please sign in.' });
        } catch (error) {
          if (error.status) return res.status(error.status).json({ error: error.message });
          return next(error);
        }
      });
  }

  router.post('/login', loginLimiter, async (req, res, next) => {
    const schema = z.object({
      email: emailSchema,
      password: z.string().min(1).max(128),
      rememberMe: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });

    try {
      const result = await query(
        database,
        `SELECT u.id, u.full_name, u.email, u.password_hash, u.status,
                LOWER(r.name) AS role, r.is_admin, r.is_active AS role_is_active
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE LOWER(u.email) = $1
         ORDER BY r.is_active DESC,
           CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
                WHEN LOWER(r.name) = 'organizer' THEN 2
                WHEN LOWER(r.name) = 'vendor' THEN 3
                WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
         LIMIT 1`,
        [parsed.data.email],
      );
      const user = result.rows[0];
      if (!user) {
        return res.status(404).json({ error: 'No account found. Please create an account first.' });
      }
      if (!await bcrypt.compare(parsed.data.password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      if (user.status !== 'active') {
        const message = user.status === 'pending'
          ? 'This account is pending verification. Complete account verification before signing in.'
          : 'This account is inactive. Contact support for assistance.';
        return res.status(403).json({ error: message });
      }
      if (!user.role_is_active) {
        return res.status(403).json({ error: 'This account role is inactive. Contact support for assistance.' });
      }
      const role = user.is_admin || ['admin', 'administrator'].includes(user.role)
        ? 'admin'
        : user.role;
      if (!['admin', 'organizer', 'vendor', 'customer'].includes(role)) {
        return res.status(403).json({ error: 'This account role is not permitted to sign in.' });
      }
      const token = await inTransaction(database, async (tx) => {
        await tx.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        const lifetimeMs = parsed.data.rememberMe
          ? REMEMBERED_SESSION_LIFETIME_MS
          : SESSION_LIFETIME_MS;
        const sessionToken = await createSession(tx, user.id, lifetimeMs);
        if (role === 'vendor') {
          await tx.query(
            `INSERT INTO vendor_profiles (user_id, business_name)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO NOTHING`,
            [user.id, user.full_name],
          );
        }
        await writeAudit(tx, {
          actorId: user.id,
          action: 'auth.login',
          entityId: user.id,
          details: { role },
          ip: req.ip,
        });
        return sessionToken;
      });
      setSessionCookie(res, token, parsed.data.rememberMe);
      return res.json({
        user: { id: user.id, name: user.full_name, email: user.email, role },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.cookies?.platform_session;
      if (token) {
        await query(database, 'DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
      }
      const adminToken = adminNamespace ? req.cookies?.admin_session : null;
      if (adminToken) {
        await query(database, 'DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(adminToken)]);
      }
      clearSessionCookie(res);
      if (adminNamespace) res.clearCookie('admin_session', getCookieOptions());
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const adminSession = adminNamespace && Boolean(req.cookies?.admin_session);
      const token = adminSession ? req.cookies.admin_session : req.cookies?.platform_session;
      if (!token) return res.json({ user: null });
      const result = await query(
        database,
        `SELECT u.id, u.full_name, u.email, u.phone, u.preferred_language, u.status,
                CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator')
                  THEN 'admin' ELSE LOWER(r.name) END AS role,
                r.is_admin, vp.id AS vendor_profile_id, vp.business_name, sc.name AS category_name,
                (SELECT STRING_AGG(role_names.name, ', ' ORDER BY role_names.name)
                 FROM (
                   SELECT DISTINCT CASE
                     WHEN role.is_admin = TRUE OR LOWER(role.name) IN ('admin', 'administrator') THEN 'Admin'
                     ELSE role.name
                   END AS name
                   FROM user_roles user_role
                   JOIN roles role ON role.id = user_role.role_id AND role.is_active = TRUE
                   WHERE user_role.user_id = u.id
                 ) role_names) AS roles
         FROM ${adminSession ? 'admin_sessions' : 'user_sessions'} s
         JOIN users u ON u.id = s.user_id
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         LEFT JOIN vendor_profiles vp ON vp.user_id = u.id
         LEFT JOIN service_categories sc ON sc.id = vp.category_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'
           AND r.is_active = TRUE
         ORDER BY CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
           WHEN LOWER(r.name) = 'organizer' THEN 2 WHEN LOWER(r.name) = 'vendor' THEN 3
           WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
         LIMIT 1`,
        [hashToken(token)],
      );
      const rows = Array.isArray(result) ? (result[0] || []) : (result?.rows || []);
      const user = rows[0];
      if (adminNamespace) {
        if (!user) {
          clearSessionCookie(res);
          if (adminSession) res.clearCookie('admin_session', getCookieOptions());
          return res.status(401).json({ error: 'Authentication required.' });
        }
        if (!(user.is_admin || ['admin', 'administrator'].includes(user.role))) {
          return res.json({ user: null });
        }
        return res.json({
          user: user
            ? {
                id: user.id,
                name: user.full_name,
                email: user.email,
                phone: user.phone,
                role: 'admin',
                status: user.status,
                roles: (user.roles || '').split(',').map((role) => role.trim()).filter(Boolean),
              }
            : null,
        });
      }
      if (!user) {
        clearSessionCookie(res);
        return res.status(401).json({ message: 'Unauthorized' });
      }
      return res.json({
        data: {
          user: {
            id: user.id,
            name: user.full_name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            preferred_language: user.preferred_language,
            ...(user.role === 'vendor' && user.vendor_profile_id
              ? {
                  vendorProfile: {
                    id: Number(user.vendor_profile_id),
                    businessName: user.business_name,
                    category: user.category_name || null,
                  },
                }
              : {}),
          },
        },
      });
    } catch (error) {
      if (isTransientPostgresError(error)) return next(error);
      const cookieName = adminNamespace && req.cookies?.admin_session ? 'admin_session' : 'platform_session';
      if (req.cookies?.[cookieName]) {
        res.clearCookie(cookieName, getCookieOptions());
        if (adminNamespace) {
          return res.status(401).json({ error: 'Authentication required.' });
        }
        return res.status(401).json({ message: 'Unauthorized' });
      }
      return next(error);
    }
  });

  router.get('/redirect', async (req, res, next) => {
    try {
      const token = req.cookies?.platform_session;
      if (!token) return res.status(401).json({ error: 'Authentication required.' });
      const result = await query(
        database,
        `SELECT LOWER(r.name) AS role, r.is_admin
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
         WHERE s.token_hash = $1 AND s.expires_at > NOW()
         ORDER BY r.is_admin DESC, r.id
         LIMIT 1`,
        [hashToken(token)],
      );
      const row = result.rows[0];
      if (!row) return res.status(401).json({ error: 'Authentication required.' });
      const role = row.is_admin ? 'admin' : row.role;
      return res.json({ redirect: buildRoleRedirect(role) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
