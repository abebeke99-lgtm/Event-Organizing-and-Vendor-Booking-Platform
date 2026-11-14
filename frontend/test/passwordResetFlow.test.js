import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const pageSource = appSource.slice(
  appSource.indexOf('function ForgotPasswordPage('),
  appSource.indexOf('function SetPasswordPage('),
);

test('password reset is one three-step page with translated English and Amharic copy', () => {
  for (const key of [
    'forgotPasswordTitle',
    'resetEmailCopy',
    'sendOtp',
    'verifyCodeTitle',
    'verifyCodeAction',
    'createNewPasswordTitle',
    'resendOtp',
    'useDifferentEmail',
    'passwordStrength',
    'passwordResetLoginSuccess',
  ]) {
    assert.ok(translate(key, 'en'), `missing English ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic ${key}`);
  }
  assert.match(pageSource, /step === 1/);
  assert.match(pageSource, /step === 2/);
  assert.match(pageSource, /step === 3/);
  assert.match(pageSource, /placeholder="name@example\.com"/);
  assert.doesNotMatch(pageSource, /LanguageSelector/);
  assert.match(pageSource, /navigateBrowserPath\(`\/login\?passwordReset=1&email=/);
});

test('OTP entry supports six numeric boxes, one-time-code autocomplete, paste, and keyboard navigation', () => {
  assert.match(pageSource, /Array\.from\(\{ length: 6 \}/);
  assert.match(pageSource, /autoComplete=\{index === 0 \? 'one-time-code' : 'off'\}/);
  assert.match(pageSource, /inputMode="numeric"/);
  assert.match(pageSource, /onPaste=\{handleOtpPaste\}/);
  assert.match(pageSource, /event\.key === 'Backspace'/);
  assert.match(pageSource, /event\.key === 'ArrowLeft'/);
  assert.match(pageSource, /event\.key === 'ArrowRight'/);
  assert.match(pageSource, /secondsLeft/);
});

test('reset uses the verified reset-session token and removes the separate legacy reset pages', () => {
  assert.match(pageSource, /await onReset\(email\.trim\(\), resetSessionToken, password, confirmPassword\)/);
  assert.doesNotMatch(appSource, /function VerifyResetOtpPage|function ResetPasswordPage/);
  assert.doesNotMatch(appSource, /\/verify-reset-otp|\/reset-password/);
  assert.match(appSource, /\/platform\/account\/password\/forgot/);
  assert.match(appSource, /\/platform\/account\/password\/verify-otp/);
  assert.match(appSource, /\/platform\/account\/password\/reset/);
});
