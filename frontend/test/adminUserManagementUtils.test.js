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
};

test('create-user validation reports required, format, and phone errors', () => {
  const errors = validateCreateUserForm({
    ...validForm,
    full_name: ' ',
    email: 'not-an-email',
    phone: '12x',
    role_id: '',
  }, key);

  assert.deepEqual(errors, {
    full_name: 'adminUserFullNameRequired',
    email: 'adminUserEmailInvalid',
    phone: 'adminUserPhoneInvalid',
    role_id: 'adminUserAccountTypeRequired',
  });
});

test('create-user validation accepts an optional phone for a supported role', () => {
  assert.deepEqual(validateCreateUserForm({ ...validForm, phone: '' }, key, '5'), {});
});

test('vendor invitations require a business name and service category', () => {
  const errors = validateCreateUserForm({ ...validForm, role_id: '5' }, key, '5');
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
  }, (messageKey) => translate(messageKey, 'am'), '5');

  assert.match(errors.business_name, /ንግድ/);
  assert.match(errors.category_id, /ምድብ/);
});
