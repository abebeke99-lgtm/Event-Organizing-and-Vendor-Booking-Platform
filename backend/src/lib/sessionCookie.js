import { getCookieOptions } from './cookieOptions.js';

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const REMEMBERED_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function setSessionCookie(res, token, rememberMe = false) {
  res.cookie('platform_session', token, getCookieOptions({
    maxAge: rememberMe ? REMEMBERED_SESSION_LIFETIME_MS : SESSION_LIFETIME_MS,
  }));
}
