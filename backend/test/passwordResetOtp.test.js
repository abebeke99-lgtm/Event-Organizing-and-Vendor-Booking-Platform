import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPasswordResetOtp,
  hashPasswordResetOtp,
  verifyPasswordResetOtp,
} from '../src/lib/passwordResetOtp.js';

test('reset OTP uses a six-digit value and stores a salted password hash', async () => {
  const otp = createPasswordResetOtp();
  const stored = await hashPasswordResetOtp(otp);

  assert.match(otp, /^[0-9]{6}$/);
  assert.match(stored.hash, /^[a-f0-9]{128}$/);
  assert.match(stored.salt, /^[a-f0-9]{32}$/);
  assert.notEqual(stored.hash, otp);
  assert.equal(await verifyPasswordResetOtp(otp, stored.hash, stored.salt), true);
  const incorrectOtp = otp === '000000' ? '000001' : '000000';
  assert.equal(await verifyPasswordResetOtp(incorrectOtp, stored.hash, stored.salt), false);
});

test('reset OTP verification rejects malformed stored values and codes', async () => {
  assert.equal(await verifyPasswordResetOtp('12345', 'a'.repeat(128), 'b'.repeat(32)), false);
  assert.equal(await verifyPasswordResetOtp('123456', 'not-a-hash', 'b'.repeat(32)), false);
});
