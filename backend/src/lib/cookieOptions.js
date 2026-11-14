export function getCookieOptions(overrides = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const secure = isProduction || process.env.COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: process.env.COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax'),
    path: '/',
    ...overrides,
  };
}
