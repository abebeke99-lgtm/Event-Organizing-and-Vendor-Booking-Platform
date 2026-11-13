import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { normalizeEmail } from './authFlow.js';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const OAUTH_TIMEOUT_MS = 10_000;

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

  if (provider === 'facebook') {
    const callbackUrl = configuredCallback(environment, provider);
    const graphVersion = environment.FACEBOOK_GRAPH_API_VERSION?.trim();
    if (!environment.FACEBOOK_APP_ID?.trim()
      || !environment.FACEBOOK_APP_SECRET?.trim()
      || !callbackUrl
      || !/^v\d+\.\d+$/.test(graphVersion)) return null;
    return {
      appId: environment.FACEBOOK_APP_ID.trim(),
      appSecret: environment.FACEBOOK_APP_SECRET.trim(),
      callbackUrl: callbackUrl.href,
      graphVersion,
    };
  }

  if (provider === 'apple') {
    const callbackUrl = configuredCallback(environment, provider);
    const privateKey = environment.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
    let parsedPrivateKey;
    try {
      parsedPrivateKey = privateKey ? createPrivateKey(privateKey) : null;
    } catch {
      return null;
    }
    if (!environment.APPLE_SERVICE_ID?.trim()
      || !environment.APPLE_TEAM_ID?.trim()
      || !environment.APPLE_KEY_ID?.trim()
      || parsedPrivateKey?.asymmetricKeyType !== 'ec'
      || parsedPrivateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      || !callbackUrl) return null;
    return {
      clientId: environment.APPLE_SERVICE_ID.trim(),
      teamId: environment.APPLE_TEAM_ID.trim(),
      keyId: environment.APPLE_KEY_ID.trim(),
      privateKey,
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

async function getJson(fetchImpl, endpoint, headers = {}) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { Accept: 'application/json', ...headers },
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
  importPrivateKey = importPKCS8,
  signJwt = SignJWT,
} = {}) {
  function getProviderStatuses() {
    return ['google', 'facebook', 'apple'].map((id) => {
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
    if (!config) throw new OAuthProviderError('provider_unavailable');

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
    } else if (provider === 'facebook') {
      url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.callbackUrl,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
      }).toString();
    } else {
      url = new URL('https://appleid.apple.com/auth/authorize');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.callbackUrl,
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state,
        nonce,
      }).toString();
    }
    return url.href;
  }

  async function exchangeAuthorizationCode(provider, {
    code,
    codeVerifier,
    nonce,
    appleUser,
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

    if (provider === 'facebook') {
      const tokenEndpoint = new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
      tokenEndpoint.search = new URLSearchParams({
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.callbackUrl,
        code,
      }).toString();
      const tokens = await getJson(fetchImpl, tokenEndpoint.href);
      if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
        throw new OAuthProviderError('invalid_identity');
      }

      const debugEndpoint = new URL(`https://graph.facebook.com/${config.graphVersion}/debug_token`);
      debugEndpoint.search = new URLSearchParams({
        input_token: tokens.access_token,
        access_token: `${config.appId}|${config.appSecret}`,
      }).toString();
      const debug = await getJson(fetchImpl, debugEndpoint.href);
      const tokenInfo = debug.data;
      if (!tokenInfo
        || tokenInfo.is_valid !== true
        || String(tokenInfo.app_id) !== config.appId
        || !tokenInfo.user_id
        || Number(tokenInfo.expires_at) > 0 && Number(tokenInfo.expires_at) * 1000 <= Date.now()) {
        throw new OAuthProviderError('invalid_identity');
      }

      const profileEndpoint = new URL(`https://graph.facebook.com/${config.graphVersion}/me`);
      profileEndpoint.search = new URLSearchParams({ fields: 'id,name,email' }).toString();
      const profile = await getJson(fetchImpl, profileEndpoint.href, {
        Authorization: `Bearer ${tokens.access_token}`,
      });
      if (String(profile.id) !== String(tokenInfo.user_id)) throw new OAuthProviderError('invalid_identity');
      return identity({
        provider,
        subject: profile.id,
        email: profile.email,
        emailVerified: Boolean(profile.email),
        name: profile.name,
      });
    }

    const secretKey = await importPrivateKey(config.privateKey, 'ES256').catch(() => {
      throw new OAuthProviderError('provider_unavailable');
    });
    const clientSecret = await new signJwt({})
      .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
      .setIssuer(config.teamId)
      .setSubject(config.clientId)
      .setAudience(APPLE_ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secretKey);
    const tokens = await postForm(fetchImpl, 'https://appleid.apple.com/auth/token', {
      client_id: config.clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.callbackUrl,
    });
    if (typeof tokens.id_token !== 'string') throw new OAuthProviderError('invalid_identity');
    let payload;
    try {
      ({ payload } = await verifyJwt(tokens.id_token, APPLE_JWKS, {
        issuer: APPLE_ISSUER,
        audience: config.clientId,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }));
    } catch {
      throw new OAuthProviderError('invalid_identity');
    }
    if (payload.nonce !== nonce) throw new OAuthProviderError('invalid_identity');

    let userName = '';
    if (typeof appleUser === 'string' && appleUser.length <= 2048) {
      try {
        const parsedUser = JSON.parse(appleUser);
        const firstName = typeof parsedUser.name?.firstName === 'string' ? parsedUser.name.firstName : '';
        const lastName = typeof parsedUser.name?.lastName === 'string' ? parsedUser.name.lastName : '';
        userName = `${firstName} ${lastName}`.trim();
      } catch {
        userName = '';
      }
    }
    const verifiedClaim = payload.email_verified;
    return identity({
      provider,
      subject: payload.sub,
      email: payload.email,
      emailVerified: verifiedClaim === true || verifiedClaim === 'true',
      name: userName,
    });
  }

  return {
    getEnabledProviders,
    getProviderStatuses,
    createAuthorizationUrl,
    exchangeAuthorizationCode,
    getFrontendUrl,
  };
}
