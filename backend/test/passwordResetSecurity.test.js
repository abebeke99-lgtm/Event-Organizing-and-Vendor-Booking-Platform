import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPasswordResetCode,
  hashPasswordResetCode,
  hashPasswordResetEmailKey,
  verifyPasswordResetCode,
} from '../src/lib/passwordResetSecurity.js';

const secret = 'test-secret-with-at-least-32-bytes';

test('reset OTP generation and HMAC verification enforce six digits and constant-length hashes', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = createPasswordResetCode();
    assert.match(code, /^\d{6}$/);
    const hash = hashPasswordResetCode(code, 42, secret);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(verifyPasswordResetCode(code, 42, hash, secret), true);
    assert.equal(verifyPasswordResetCode(code, 43, hash, secret), false);
    assert.equal(verifyPasswordResetCode('12345', 42, hash, secret), false);
  }
});

test('per-email limiter keys are stable, normalized, and do not contain the address', () => {
  const first = hashPasswordResetEmailKey(' Person@Example.com ');
  assert.equal(first, hashPasswordResetEmailKey('person@example.com'));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /person|example/i);
});
