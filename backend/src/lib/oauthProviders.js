import { createRemoteJWKSet, jwtVerify } from 'jose';
import { normalizeEmail } from './authFlow.js';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const OAUTH_TIMEOUT_MS = 10_000;
const microsoftJwks = new Map();

export class OAuthProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OAuthProviderError';
    this.code = code;
  }
}

function configuredUrl(value, { production, callback = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.hash
      || (production && url.protocol !== 'https:')
      || (callback && url.search)) return null;
    return url;
  } catch {
    return null;
  }
}

function configuredCallback(environment, provider) {
  const callbackUrl = configuredUrl(environment[`${provider.toUpperCase()}_CALLBACK_URL`], {
    production: environment.NODE_ENV === 'production',
    callback: true,
  });
  return callbackUrl?.pathname === `/api/platform/oauth/${provider}/callback`
    ? callbackUrl
    : null;
}

function readProviderConfig(provider, environment = process.env) {
  if (provider === 'google') {
    const callbackUrl = configuredCallback(environment, provider);
    if (!environment.GOOGLE_CLIENT_ID?.trim()
      || !environment.GOOGLE_CLIENT_SECRET?.trim()
      || !callbackUrl) return null;
    return {
      clientId: environment.GOOGLE_CLIENT_ID.trim(),
      clientSecret: environment.GOOGLE_CLIENT_SECRET.trim(),
      callbackUrl: callbackUrl.href,
    };
  }

  if (provider === 'microsoft') {
    const callbackUrl = configuredCallback(environment, provider);
    const tenantId = environment.MICROSOFT_TENANT_ID?.trim().toLowerCase();
    if (!environment.MICROSOFT_CLIENT_ID?.trim()
      || !environment.MICROSOFT_CLIENT_SECRET?.trim()
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId || '')
      || !callbackUrl) return null;
    return {
      clientId: environment.MICROSOFT_CLIENT_ID.trim(),
      clientSecret: environment.MICROSOFT_CLIENT_SECRET.trim(),
      tenantId,
      callbackUrl: callbackUrl.href,
    };
  }

  return null;
}

function frontendOrigin(environment = process.env) {
  const configured = environment.FRONTEND_URL || environment.WEB_ORIGIN;
  const url = configuredUrl(configured, { production: environment.NODE_ENV === 'production' });
  if (!url) throw new OAuthProviderError('frontend_unavailable');
  return url.origin;
}

function requireResponse(response) {
  if (!response.ok) throw new OAuthProviderError('provider_unavailable');
  return response.json().catch(() => {
    throw new OAuthProviderError('provider_unavailable');
  });
}

async function postForm(fetchImpl, endpoint, values) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
  } catch {
    throw new OAuthProviderError('provider_unavailable');
  }
  return requireResponse(response);
}

function identity({ provider, subject, email, emailVerified, name }) {
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 255) {
    throw new OAuthProviderError('invalid_identity');
  }
  const normalizedEmail = typeof email === 'string' && email.trim()
    ? normalizeEmail(email)
    : null;
  if (normalizedEmail && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) {
    throw new OAuthProviderError('invalid_identity');
  }
  return {
    provider,
    subject: subject.trim(),
    email: normalizedEmail,
    emailVerified: emailVerified === true,
    name: typeof name === 'string' ? name.trim().slice(0, 160) : '',
  };
}

export function createOAuthProviderService({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  verifyJwt = jwtVerify,
} = {}) {
  function getProviderStatuses() {
    return ['google', 'microsoft'].map((id) => {
      const configured = Boolean(readProviderConfig(id, environment));
      return { id, configured, status: configured ? 'configured' : 'not_configured' };
    });
  }

  function getEnabledProviders() {
    return getProviderStatuses()
      .filter((provider) => provider.configured)
      .map((provider) => provider.id);
  }

  function getFrontendUrl(path, query = {}) {
    const url = new URL(path, frontendOrigin(environment));
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') url.searchParams.set(key, value);
    }
    return url.href;
  }

  function createAuthorizationUrl(provider, { state, nonce, codeChallenge }) {
    const config = readProviderConfig(provider, environment);
    if (!config) throw new OAuthProviderError('provider_not_configured');

    let url;
    if (provider === 'google') {
      url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
    } else {
      const config = readProviderConfig(provider, environment);
      if (!config) throw new OAuthProviderError('provider_unavailable');
      url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        response_type: 'code',
        response_mode: 'query',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
    }
    return url.href;
  }

  async function exchangeAuthorizationCode(provider, {
    code,
    codeVerifier,
    nonce,
  }) {
    const config = readProviderConfig(provider, environment);
    if (!config) throw new OAuthProviderError('provider_unavailable');

    if (provider === 'google') {
      const tokens = await postForm(fetchImpl, 'https://oauth2.googleapis.com/token', {
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      });
      if (typeof tokens.id_token !== 'string') throw new OAuthProviderError('invalid_identity');
      let payload;
      try {
        ({ payload } = await verifyJwt(tokens.id_token, GOOGLE_JWKS, {
          issuer: GOOGLE_ISSUERS,
          audience: config.clientId,
          algorithms: ['RS256'],
          clockTolerance: 5,
        }));
      } catch {
        throw new OAuthProviderError('invalid_identity');
      }
      if (payload.nonce !== nonce) throw new OAuthProviderError('invalid_identity');
      return identity({
        provider,
        subject: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name,
      });
    }

    if (provider === 'microsoft') {
      const tokens = await postForm(fetchImpl,
        `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.callbackUrl,
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          scope: 'openid email profile',
        });
      if (typeof tokens.id_token !== 'string') throw new OAuthProviderError('invalid_identity');
      let payload;
      try {
        const keys = microsoftJwks.get(config.tenantId) || createRemoteJWKSet(
          new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
        );
        microsoftJwks.set(config.tenantId, keys);
        ({ payload } = await verifyJwt(tokens.id_token, keys, {
          issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
          audience: config.clientId,
          algorithms: ['RS256'],
          clockTolerance: 5,
        }));
      } catch {
        throw new OAuthProviderError('invalid_identity');
      }
      if (payload.nonce !== nonce || payload.tid !== config.tenantId) {
        throw new OAuthProviderError('invalid_identity');
      }
      const verifiedEmail = payload.email_verified === true;
      return identity({
        provider,
        subject: payload.sub,
        email: verifiedEmail ? payload.email : null,
        emailVerified: verifiedEmail,
        name: payload.name,
      });
    }
    throw new OAuthProviderError('provider_unavailable');
  }

  return {
    getEnabledProviders,
    getProviderStatuses,
    createAuthorizationUrl,
    exchangeAuthorizationCode,
    getFrontendUrl,
  };
}
