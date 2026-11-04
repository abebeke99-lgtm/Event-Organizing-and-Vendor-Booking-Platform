import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCreateUserForm } from '../src/adminUserManagementUtils.js';
import { translate } from '../src/language.js';

const key = (value) => value;
const validForm = {
  full_name: 'Taylor Example',
  email: 'taylor@example.test',
  phone: '+1 (202) 555-0123',
  role_id: '4',
  password: 'StrongInitialPassword123',
  confirm_password: 'StrongInitialPassword123',
};

test('create-user validation reports required, format, strength, and match errors', () => {
  const errors = validateCreateUserForm({
    ...validForm,
    full_name: ' ',
    email: 'not-an-email',
    phone: '12x',
    password: 'weak',
    confirm_password: 'different',
    role_id: '',
  }, key);

  assert.deepEqual(errors, {
    full_name: 'adminUserFullNameRequired',
    email: 'adminUserEmailInvalid',
    phone: 'adminUserPhoneInvalid',
    password: 'adminUserPasswordWeak',
    confirm_password: 'adminUserPasswordMismatch',
    role_id: 'adminUserAccountTypeRequired',
  });
});

test('create-user validation accepts an optional phone and backend-compatible password', () => {
  assert.deepEqual(validateCreateUserForm({ ...validForm, phone: '' }, key), {});
});

test('weak passwords retain clear localized validation errors', () => {
  for (const password of ['weak', 'alllowercasepassword123', 'ALLUPPERCASEPASSWORD123', 'NoDigitsPasswordHere', `${'A'.repeat(127)}a1`]) {
    const errors = validateCreateUserForm({ ...validForm, password, confirm_password: password }, (key) => translate(key, 'en'));
    assert.match(errors.password, /at least 16 characters/i);
    assert.match(errors.password, /uppercase/i);
    assert.match(errors.password, /lowercase/i);
    assert.match(errors.password, /number/i);
  }

  const amharicErrors = validateCreateUserForm({ ...validForm, password: 'weak', confirm_password: 'weak' }, (key) => translate(key, 'am'));
  assert.match(amharicErrors.password, /16/);
  assert.match(amharicErrors.password, /128/);
  assert.ok(amharicErrors.password.length > 0);
});
