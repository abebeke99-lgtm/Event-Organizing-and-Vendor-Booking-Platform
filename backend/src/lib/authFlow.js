import { createHash, randomBytes } from 'node:crypto';

export function normalizeEmail(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

export function isStrongPassword(password = '') {
  const value = String(password ?? '');
  return value.length >= 12
    && value.length <= 16
    && /[A-Z]/.test(value)
    && /[a-z]/.test(value)
    && /\d/.test(value);
}

export function buildRoleRedirect(role = 'customer') {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  const map = {
    admin: '/admin',
    organizer: '/organizer/dashboard',
    vendor: '/vendor/dashboard',
    customer: '/customer/dashboard',
  };
  return map[normalizedRole] || '/customer/dashboard';
}

export function createSecureToken() {
  return randomBytes(24).toString('hex');
}

export function hashToken(token = '') {
  return createHash('sha256').update(String(token ?? '')).digest('hex');
}

export function safeAuthError() {
  return 'We could not sign you in with those credentials.';
}
