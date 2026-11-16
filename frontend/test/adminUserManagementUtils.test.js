import test from 'node:test';
import assert from 'node:assert/strict';

import { validateCreateUserForm } from '../src/adminUserManagementUtils.js';
import { translate } from '../src/language.js';

const key = (value) => value;
const validForm = {
  full_name: 'Taylor Example',
  email: 'taylor@example.test',
  phone: '+1 (202) 555-0123',
  password: 'StrongPass123',
  confirm_password: 'StrongPass123',
  role_id: '4',
};

test('create-user validation reports required, format, password, and phone errors', () => {
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
    password: 'adminUserPasswordRequirements',
    confirm_password: 'adminUserPasswordMismatch',
    role_id: 'adminUserAccountTypeRequired',
  });
});

test('create-user validation requires a phone and accepts an optional FID number', () => {
  assert.deepEqual(validateCreateUserForm({ ...validForm, fid_number: '' }, key, '5', ['4', '5']), {});
  assert.deepEqual(validateCreateUserForm({ ...validForm, phone: '' }, key, '5', ['4', '5']), {
    phone: 'adminUserPhoneRequired',
  });
});

test('vendor account creation requires a business name and service category', () => {
  const errors = validateCreateUserForm({ ...validForm, role_id: '5' }, key, '5', ['4', '5']);
  assert.deepEqual(errors, {
    business_name: 'adminUserBusinessNameRequired',
    category_id: 'adminUserCategoryRequired',
  });
});

test('vendor fields validate with localized messages', () => {
  const errors = validateCreateUserForm({
    ...validForm,
    role_id: '5',
    business_name: ' ',
    category_id: '',
  }, (messageKey) => translate(messageKey, 'am'), '5', ['4', '5']);

  assert.match(errors.business_name, /ንግድ/);
  assert.match(errors.category_id, /ምድብ/);
});

test('customer and administrator roles are rejected by create-user form validation', () => {
  for (const roleId of ['2', '1']) {
    assert.equal(
      validateCreateUserForm({ ...validForm, role_id: roleId }, key, undefined, ['3', '4']).role_id,
      'adminUserRoleNotAllowed',
    );
  }
});

test('password validation accepts multibyte values within the bcrypt UTF-8 byte limit', () => {
  const password = `${'Ä'.repeat(12)}aA1`;
  const errors = validateCreateUserForm({
    ...validForm,
    password,
    confirm_password: password,
  }, key, undefined, ['4']);
  assert.deepEqual(errors, {});
});
