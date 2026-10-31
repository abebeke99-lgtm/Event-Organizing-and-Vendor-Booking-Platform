import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const OTP_BYTES = 64;

export function createPasswordResetOtp() {
  return String(randomInt(100000, 1000000));
}

export async function hashPasswordResetOtp(otp) {
  const salt = randomBytes(16);
  const hash = await scrypt(otp, salt, OTP_BYTES, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPasswordResetOtp(otp, expectedHash, saltHex) {
  if (!/^[0-9]{6}$/.test(otp) || !/^[a-f0-9]{128}$/.test(expectedHash || '')
    || !/^[a-f0-9]{32}$/.test(saltHex || '')) return false;
  const actualHash = await scrypt(otp, Buffer.from(saltHex, 'hex'), OTP_BYTES, {
    N: 2 ** 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actualHash, Buffer.from(expectedHash, 'hex'));
}
