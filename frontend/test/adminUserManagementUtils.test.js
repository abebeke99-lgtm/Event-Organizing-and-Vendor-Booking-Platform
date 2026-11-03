import test from 'node:test';
import assert from 'node:assert/strict';

import { generateSecurePassword, validateCreateUserForm } from '../src/adminUserManagementUtils.js';

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

test('secure password generation satisfies the backend password policy', () => {
  const password = generateSecurePassword();
  assert.equal(password.length, 52);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.notEqual(password, generateSecurePassword());
});
