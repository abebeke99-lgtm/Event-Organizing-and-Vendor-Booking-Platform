import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const componentSource = await readFile(new URL('../src/AdminUserManagement.jsx', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/adminUserManagement.css', import.meta.url), 'utf8');

test('create-user password fields retain separate accessible show and hide controls', () => {
  assert.match(componentSource, /type=\{passwordVisible \? 'text' : 'password'\}/);
  assert.match(componentSource, /type=\{confirmPasswordVisible \? 'text' : 'password'\}/);
  assert.match(componentSource, /setPasswordVisible\(\(visible\) => !visible\)/);
  assert.match(componentSource, /setConfirmPasswordVisible\(\(visible\) => !visible\)/);
  assert.equal((componentSource.match(/className="um-password-toggle"/g) || []).length, 2);
  assert.equal((componentSource.match(/aria-label=\{t\([\s\S]{0,100}adminUserShowPassword/g) || []).length, 2);
  assert.equal((componentSource.match(/title=\{t\([\s\S]{0,100}adminUserShowPassword/g) || []).length, 2);
  assert.doesNotMatch(componentSource, /<span>\{t\([\s\S]{0,80}adminUserShowPassword/);
});

test('create-user modal removes the password helper and generator without weakening inline validation', () => {
  assert.doesNotMatch(componentSource, /adminUserPasswordNotice|adminUserGeneratePassword|generateSecurePassword|um-generate-password/);
  assert.match(componentSource, /showFieldError\('password'\)/);
  assert.match(componentSource, /aria-invalid=\{Boolean\(errors\.password\)\}/);
  assert.match(componentSource, /minLength=\{?16\}?/);
  assert.match(componentSource, /maxLength=\{?128\}?/);
  assert.match(styleSource, /\.um-field-error\{[^}]*color:#bd3441/);
  assert.doesNotMatch(styleSource, /um-password-tools|um-generate-password/);
});

test('password visibility labels are localized and toggle between show and hide', () => {
  assert.equal(translate('adminUserShowPassword', 'en'), 'Show password');
  assert.equal(translate('adminUserHidePassword', 'en'), 'Hide password');
  assert.ok(translate('adminUserShowPassword', 'am'));
  assert.ok(translate('adminUserHidePassword', 'am'));
  assert.match(componentSource, /passwordVisible \? 'adminUserHidePassword' : 'adminUserShowPassword'/);
  assert.match(componentSource, /confirmPasswordVisible \? 'adminUserHidePassword' : 'adminUserShowPassword'/);
});
