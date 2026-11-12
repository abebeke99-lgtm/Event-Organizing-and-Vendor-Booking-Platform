import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { buildRoleRedirect, hashToken, isStrongPassword, normalizeEmail } from '../lib/authFlow.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { DEFAULT_SYSTEM_SETTINGS, mergeSystemSettings } from '../lib/systemSettings.js';
import { getSystemLockState } from '../lib/rbac.js';
import { newSessionToken } from '../lib/security.js';
import { isTransientPostgresError } from '../lib/postgresRetry.js';
import { normalizeDatabaseAdapter } from '../db.js';

const emailSchema = z.string().trim().email().max(254).transform(normalizeEmail);
const registrationLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many registration attempts. Please try again later.',
});
const passwordRecoveryLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many password recovery requests. Please try again later.',
});
const loginLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-in attempts. Please try again later.',
  skipSuccessfulRequests: true,
});
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

function setSessionCookie(res, token) {
  res.cookie('platform_session', token, getCookieOptions({
    maxAge: sessionLifetimeMs,
  }));
}

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

async function createSession(executor, userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await executor.query(
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  );
  return token;
}

async function createRegistrationNotifications(executor, {
  name,
  userId,
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
        `${name} registered as a customer.`,
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

export function createPostgresAuthRouter({ database, adminNamespace = false }) {
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
      password: z.string().min(12).max(16).refine(isStrongPassword),
    }).strict();
    if (req.body && Object.hasOwn(req.body, 'role')) {
      return res.status(403).json({ error: 'Public registration is limited to customer accounts.' });
    }
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
      const created = await inTransaction(database, async (tx) => {
        const role = await tx.query(
          `SELECT id FROM roles
           WHERE LOWER(name) = 'customer' AND is_active = TRUE AND is_admin = FALSE
           LIMIT 1`,
        );
        if (!role.rows[0]) {
          const error = new Error('Customer registration is unavailable.');
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
        const token = await createSession(tx, userId);
        await writeAudit(tx, {
          actorId: userId,
          action: 'auth.register',
          entityId: userId,
          details: { role: 'Customer' },
          ip: req.ip,
        });
        await createRegistrationNotifications(tx, { name: parsed.data.name, userId });
        return { id: userId, token };
      });

      setSessionCookie(res, created.token);
      return res.status(201).json({
        data: {
          user: {
            id: created.id,
            name: parsed.data.name,
            full_name: parsed.data.name,
            email: normalizedEmail,
            role: 'customer',
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

  router.post('/password-recovery', passwordRecoveryLimiter, async (req, res, next) => {
    const parsed = emailSchema.safeParse(req.body?.email);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    try {
      await writeAudit(database, {
        actorId: null,
        action: 'auth.password_recovery_requested',
        entityType: 'user',
        entityId: null,
        details: { email: parsed.data.toLowerCase() },
        ip: req.ip,
      });
      return res.json({ message: 'If the account exists, recovery instructions will be sent.' });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    const schema = z.object({
      email: emailSchema,
      password: z.string().min(1).max(128),
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
      if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) {
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
        const sessionToken = await createSession(tx, user.id);
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
      setSessionCookie(res, token);
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
                r.is_admin, vp.id AS vendor_profile_id, vp.business_name, sc.name AS category_name
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
