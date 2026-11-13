import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { buildRoleRedirect, hashToken, normalizeEmail } from '../lib/authFlow.js';
import { getCookieOptions } from '../lib/cookieOptions.js';
import { createAuthRateLimiter } from '../middleware/authRateLimit.js';
import { OAuthProviderError, createOAuthProviderService } from '../lib/oauthProviders.js';
import { normalizeDatabaseAdapter } from '../db.js';

const stateLifetimeMs = 10 * 60 * 1000;
const supportedProviders = new Set(['google', 'facebook', 'apple']);
const oauthLimiter = createAuthRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many social sign-in attempts. Please try again later.',
});
const providerService = createOAuthProviderService();

function query(database, sql, values = []) {
  return database.query(sql, values);
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function withTransaction(database, work) {
  if (typeof database?.inTransaction === 'function') {
    return database.inTransaction(work);
  }
  if (typeof database?.connect === 'function') {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors to preserve the original failure signal.
      }
      throw error;
    } finally {
      if (typeof client.release === 'function') {
        client.release();
      }
    }
  }
  throw new TypeError('A PostgreSQL database adapter is required for OAuth.');
}

function setBrowserCookie(res, token, provider) {
  res.cookie('oauth_browser', token, getCookieOptions({
    maxAge: stateLifetimeMs,
    path: '/api/platform/oauth',
    sameSite: provider === 'apple' && process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  }));
}

function oauthErrorRedirect(providerService, intent, code) {
  return providerService.getFrontendUrl(intent === 'link' ? '/account/connections' : '/login', {
    oauth: 'error',
    reason: code,
  });
}

async function getPlatformUser(database, req) {
  const token = req.cookies?.platform_session;
  if (!token) return null;
  const result = await query(
    database,
    `SELECT u.id, u.full_name, u.email
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id AND u.status = 'active'
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
       AND EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND r.is_active = TRUE AND r.is_admin = FALSE
       )
     LIMIT 1`,
    [hashToken(token)],
  );
  return result.rows[0] || null;
}

async function getPrimaryRole(database, userId) {
  const result = await query(
    database,
    `SELECT u.id, u.full_name, u.email, u.status, LOWER(r.name) AS role, r.is_admin,
            r.is_active AS role_is_active
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1
     ORDER BY r.is_active DESC,
       CASE WHEN r.is_admin = TRUE OR LOWER(r.name) IN ('admin', 'administrator') THEN 1
            WHEN LOWER(r.name) = 'organizer' THEN 2
            WHEN LOWER(r.name) = 'vendor' THEN 3
            WHEN LOWER(r.name) = 'customer' THEN 4 ELSE 5 END
     LIMIT 1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user || user.status !== 'active' || !user.role_is_active) return null;
  const role = user.is_admin || ['admin', 'administrator'].includes(user.role)
    ? 'admin'
    : user.role;
  if (role === 'admin' || !['organizer', 'vendor', 'customer'].includes(role)) return null;
  return { ...user, role };
}

async function createSession(database, userId) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await query(
    database,
    'INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt],
  );
  return token;
}

function setSessionCookie(res, token) {
  res.cookie('platform_session', token, getCookieOptions({
    maxAge: 8 * 60 * 60 * 1000,
  }));
}

async function completeLogin(database, req, identity) {
  return withTransaction(database, async (tx) => {
    const linked = await tx.query(
      `SELECT u.id, u.full_name, u.email
       FROM oauth_identities oi
       JOIN users u ON u.id = oi.user_id
       WHERE oi.provider = $1 AND oi.provider_subject = $2
       FOR UPDATE OF oi`,
      [identity.provider, identity.subject],
    );
    let user;
    if (linked.rows[0]) {
      user = await getPrimaryRole(tx, linked.rows[0].id);
      if (!user) throw new OAuthProviderError('account_unavailable');
      await tx.query(
        `UPDATE oauth_identities SET provider_email = $3, email_verified = $4, updated_at = NOW()
         WHERE provider = $1 AND provider_subject = $2`,
        [identity.provider, identity.subject, identity.email, identity.emailVerified],
      );
    } else {
      if (!identity.email || !identity.emailVerified) {
        throw new OAuthProviderError('email_verification_required');
      }
      const emailCollision = await tx.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [
        normalizeEmail(identity.email),
      ]);
      if (emailCollision.rows[0]) throw new OAuthProviderError('account_conflict');

      const registrationSetting = await tx.query(
        `SELECT setting_value FROM system_settings
         WHERE setting_key = 'public_registration_enabled'`,
      );
      if (registrationSetting.rows[0]
        && !['true', '1'].includes(String(registrationSetting.rows[0].setting_value).toLowerCase())) {
        throw new OAuthProviderError('registration_disabled');
      }

      const role = await tx.query(
        `SELECT id FROM roles
         WHERE LOWER(name) = 'customer' AND is_active = TRUE AND is_admin = FALSE
         LIMIT 1`,
      );
      if (!role.rows[0]) throw new OAuthProviderError('provider_unavailable');
      const name = identity.name || identity.email.split('@')[0];
      const passwordHash = await bcrypt.hash(randomToken(48), 12);
      const inserted = await tx.query(
        `INSERT INTO users (full_name, email, password_hash, status, preferred_language)
         VALUES ($1, $2, $3, 'active', $4)
         RETURNING id, full_name, email`,
        [name.slice(0, 160), normalizeEmail(identity.email), passwordHash, req.language === 'am' ? 'am' : 'en'],
      );
      user = { ...inserted.rows[0], role: 'customer' };
      await tx.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [user.id, role.rows[0].id],
      );
      await tx.query(
        `INSERT INTO oauth_identities
           (user_id, provider, provider_subject, provider_email, email_verified)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, identity.provider, identity.subject, identity.email, identity.emailVerified],
      );
      await tx.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, 'auth.oauth_register', 'user', $1, $2::jsonb, $3)`,
        [user.id, JSON.stringify({ provider: identity.provider, role: 'customer' }), req.ip || null],
      );
    }

    await tx.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    const sessionToken = await createSession(tx, user.id);
    await tx.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'auth.oauth_login', 'user', $1, $2::jsonb, $3)`,
      [user.id, JSON.stringify({ provider: identity.provider, role: user.role }), req.ip || null],
    );
    return { user, sessionToken };
  });
}

async function completeLink(database, req, state, identity) {
  return withTransaction(database, async (tx) => {
    const existing = await tx.query(
      `SELECT user_id FROM oauth_identities
       WHERE provider = $1 AND provider_subject = $2 FOR UPDATE`,
      [identity.provider, identity.subject],
    );
    if (existing.rows[0] && String(existing.rows[0].user_id) !== String(state.user_id)) {
      throw new OAuthProviderError('account_conflict');
    }
    if (!existing.rows[0] && identity.email) {
      const emailOwner = await tx.query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1', [
        normalizeEmail(identity.email),
      ]);
      if (emailOwner.rows[0] && String(emailOwner.rows[0].id) !== String(state.user_id)) {
        throw new OAuthProviderError('account_conflict');
      }
    }
    if (!existing.rows[0]) {
      await tx.query(
        `INSERT INTO oauth_identities
           (user_id, provider, provider_subject, provider_email, email_verified)
         VALUES ($1, $2, $3, $4, $5)`,
        [state.user_id, identity.provider, identity.subject, identity.email, identity.emailVerified],
      );
    } else {
      await tx.query(
        `UPDATE oauth_identities SET provider_email = $3, email_verified = $4, updated_at = NOW()
         WHERE provider = $1 AND provider_subject = $2`,
        [identity.provider, identity.subject, identity.email, identity.emailVerified],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, 'auth.oauth_link', 'user', $1, $2::jsonb, $3)`,
      [state.user_id, JSON.stringify({ provider: identity.provider }), req.ip || null],
    );
  });
}

export function createPostgresOAuthRouter({
  database,
  oauthService = providerService,
} = {}) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required for OAuth.');
  }
  const router = Router();

  router.get('/providers', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ providers: oauthService.getProviderStatuses() });
  });

  router.get('/:provider/start', oauthLimiter, async (req, res, next) => {
    const { provider } = req.params;
    if (!supportedProviders.has(provider)) return res.status(404).json({ error: 'Provider not found.' });
    const intent = req.query.intent === 'link' ? 'link' : 'login';
    try {
      let linkedUser = null;
      if (intent === 'link') {
        linkedUser = await getPlatformUser(database, req);
        if (!linkedUser) return res.status(401).json({ error: 'Sign in before linking an account.' });
      }

      const browserToken = req.cookies?.oauth_browser || randomToken();
      const stateToken = randomToken();
      const nonce = randomToken();
      const codeVerifier = provider === 'google' ? randomToken(48) : null;
      const codeChallenge = codeVerifier
        ? createHash('sha256').update(codeVerifier).digest('base64url')
        : '';
      await query(
        database,
        `INSERT INTO oauth_login_states
           (state_hash, browser_hash, provider, intent, user_id, nonce, code_verifier, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          hash(stateToken),
          hash(browserToken),
          provider,
          intent,
          linkedUser?.id || null,
          nonce,
          codeVerifier,
          new Date(Date.now() + stateLifetimeMs),
        ],
      );
      const authorizationUrl = oauthService.createAuthorizationUrl(provider, {
        state: stateToken,
        nonce,
        codeChallenge,
      });
      setBrowserCookie(res, browserToken, provider);
      return res.redirect(302, authorizationUrl);
    } catch (error) {
      if (error instanceof OAuthProviderError) {
        return res.redirect(302, oauthErrorRedirect(oauthService, intent, error.code));
      }
      return next(error);
    }
  });

  const callbackHandler = async (req, res, next) => {
    const provider = req.params.provider || 'apple';
    if (!supportedProviders.has(provider)) return res.status(404).json({ error: 'Provider not found.' });
    let intent = 'login';
    try {
      const callbackData = req.method === 'POST' ? req.body : req.query;
      const stateToken = typeof callbackData.state === 'string' ? callbackData.state : '';
      const browserToken = req.cookies?.oauth_browser || '';
      if (!stateToken || !browserToken) {
        throw new OAuthProviderError('invalid_state');
      }
      const consumed = await query(
        database,
        `DELETE FROM oauth_login_states
         WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > NOW()
         RETURNING provider, intent, user_id, nonce, code_verifier`,
        [hash(stateToken), hash(browserToken)],
      );
      const state = consumed.rows[0];
      if (!state) throw new OAuthProviderError('invalid_state');
      intent = state.intent;
      if (state.provider !== provider) throw new OAuthProviderError('invalid_state');
      if (callbackData.error) throw new OAuthProviderError('cancelled');
      const code = typeof callbackData.code === 'string' ? callbackData.code : '';
      if (!code || code.length > 4096) throw new OAuthProviderError('invalid_identity');
      const identity = await oauthService.exchangeAuthorizationCode(provider, {
        code,
        codeVerifier: state.code_verifier,
        nonce: state.nonce,
        appleUser: callbackData.user,
      });

      if (state.intent === 'link') {
        const currentUser = await getPlatformUser(database, {
          cookies: { platform_session: req.cookies?.platform_session },
        });
        if (!currentUser || String(currentUser.id) !== String(state.user_id)) {
          throw new OAuthProviderError('session_expired');
        }
        await completeLink(database, req, state, identity);
        return res.redirect(302, oauthService.getFrontendUrl('/account/connections', { oauth: 'linked' }));
      }

      const result = await completeLogin(database, req, identity);
      setSessionCookie(res, result.sessionToken);
      return res.redirect(302, oauthService.getFrontendUrl('/login', { oauth: 'success' }));
    } catch (error) {
      if (error instanceof OAuthProviderError) {
        return res.redirect(302, oauthErrorRedirect(oauthService, intent, error.code));
      }
      if (error.code === '23505') {
        return res.redirect(302, oauthErrorRedirect(oauthService, intent, 'account_conflict'));
      }
      return next(error);
    }
  };
  router.get('/:provider/callback', oauthLimiter, callbackHandler);
  router.post('/apple/callback', oauthLimiter, express.urlencoded({ extended: false, limit: '10kb' }),
    callbackHandler);

  router.get('/identities', async (req, res, next) => {
    try {
      const user = await getPlatformUser(database, req);
      if (!user) return res.status(401).json({ error: 'Authentication required.' });
      const result = await query(
        database,
        `SELECT provider, provider_email, email_verified, created_at
         FROM oauth_identities WHERE user_id = $1 ORDER BY provider`,
        [user.id],
      );
      return res.json({ identities: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/identities/:provider', async (req, res, next) => {
    if (!supportedProviders.has(req.params.provider)) {
      return res.status(404).json({ error: 'Provider not found.' });
    }
    try {
      const user = await getPlatformUser(database, req);
      if (!user) return res.status(401).json({ error: 'Authentication required.' });
      const result = await withTransaction(database, async (tx) => {
        const identities = await tx.query(
          `SELECT provider FROM oauth_identities WHERE user_id = $1 FOR UPDATE`,
          [user.id],
        );
        if (!identities.rows.some((identity) => identity.provider === req.params.provider)) {
          return { status: 404 };
        }
        if (identities.rows.length <= 1) return { status: 409 };
        await tx.query(
          'DELETE FROM oauth_identities WHERE user_id = $1 AND provider = $2',
          [user.id, req.params.provider],
        );
        await tx.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES ($1, 'auth.oauth_unlink', 'user', $1, $2::jsonb, $3)`,
          [user.id, JSON.stringify({ provider: req.params.provider }), req.ip || null],
        );
        return { status: 204 };
      });
      if (result.status === 404) return res.status(404).json({ error: 'Linked provider not found.' });
      if (result.status === 409) {
        return res.status(409).json({ error: 'Link another sign-in method before removing this one.' });
      }
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
