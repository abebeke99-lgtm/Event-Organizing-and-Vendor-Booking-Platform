export function getCookieOptions(overrides = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const secure = isProduction && process.env.COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: isProduction ? process.env.COOKIE_SAME_SITE || 'none' : 'lax',
    path: '/',
    ...overrides,
  };
}
