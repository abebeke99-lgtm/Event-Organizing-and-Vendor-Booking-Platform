import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function createPasswordResetCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashPasswordResetCode(code, userId, secret) {
  return createHmac('sha256', secret)
    .update(`${userId}:${code}`)
    .digest('hex');
}

export function verifyPasswordResetCode(code, userId, expectedHash, secret) {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/i.test(expectedHash || '')) return false;
  const actual = Buffer.from(hashPasswordResetCode(code, userId, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export function hashPasswordResetEmailKey(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
}
