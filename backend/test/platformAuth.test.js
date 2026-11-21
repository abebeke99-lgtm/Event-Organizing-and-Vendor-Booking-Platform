import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { hashPassword, isPublicRole, parsePublicLogin, parsePublicRegistration } from '../src/lib/platformAuth.js';

const validRegistration = (overrides = {}) => ({
  fullName: 'Hana Bekele',
  username: 'hana_bekele',
  email: 'HANA@example.com',
  phone: '0986481821',
  password: 'StrongPass123!',
  accountType: 'Customer',
  acceptedTerms: true,
  ...overrides,
});

test('public registration accepts supported non-administrator account types', () => {
  for (const accountType of ['Customer', 'Organizer', 'Vendor']) {
    assert.equal(parsePublicRegistration(validRegistration({ accountType })).success, true);
  }
  for (const accountType of ['Admin', 'Other']) {
    assert.equal(parsePublicRegistration(validRegistration({ accountType })).success, false);
  }
});

test('registration normalizes username, email, phone, and trims name', () => {
  const result = parsePublicRegistration(validRegistration({
    fullName: '  Hana Bekele ',
    username: ' Hana_Bekele ',
    email: ' HANA@example.com ',
    phone: ' (098) 648-1821 ',
  }));
  assert.equal(result.success, true);
  assert.equal(result.data.fullName, 'Hana Bekele');
  assert.equal(result.data.email, 'hana@example.com');
  assert.equal(result.data.username, 'hana_bekele');
  assert.equal(result.data.phone, '+251986481821');
  assert.equal(parsePublicRegistration(validRegistration({ fullName: 'H', email: 'bad' })).success, false);
});

test('registration requires a username, valid phone, and accepted terms and defaults to customer', () => {
  for (const invalid of [
    { username: '' },
    { phone: '' },
    { phone: 'not-a-phone' },
    { acceptedTerms: false },
  ]) {
    assert.equal(parsePublicRegistration(validRegistration(invalid)).success, false);
  }
  assert.equal(parsePublicRegistration(validRegistration({ accountType: undefined })).data.accountType, 'customer');
});

test('registration enforces password complexity and required terms acceptance', () => {
  for (const password of ['Short1!', 'lowercase12!', 'UPPERCASE12!', 'NoNumber!', '        ']) {
    assert.equal(parsePublicRegistration(validRegistration({ password })).success, false);
  }
  assert.equal(parsePublicRegistration(validRegistration({ acceptedTerms: false })).success, false);
  assert.equal(parsePublicRegistration(validRegistration({ password: 'NoSpecial123' })).success, true);
  assert.equal(parsePublicRegistration(validRegistration({ password: 'ValidPass123!' })).success, true);
});

test('login accepts normalized email or username and rejects invalid identifiers', () => {
  const result = parsePublicLogin({ email: ' USER@example.com ', password: 'any-password' });
  assert.equal(result.success, true);
  assert.equal(result.data.email, 'user@example.com');
  assert.equal(parsePublicLogin({ email: ' Hana_Bekele ', password: 'any-password' }).data.email, 'hana_bekele');
  assert.equal(parsePublicLogin({ email: 'bad!', password: 'any-password' }).success, false);
  assert.equal(parsePublicLogin({ email: 'bad', password: '' }).success, false);
});

test('password hashing uses bcrypt and does not preserve plaintext', async () => {
  const password = 'StrongPass123';
  const passwordHash = await hashPassword(password);
  assert.notEqual(passwordHash, password);
  assert.equal(await bcrypt.compare(password, passwordHash), true);
  assert.equal(await bcrypt.compare('WrongPass123', passwordHash), false);
});

test('public role guard rejects privileged and unknown roles', () => {
  assert.equal(isPublicRole('customer'), true);
  assert.equal(isPublicRole('vendor'), true);
  assert.equal(isPublicRole('organizer'), true);
  assert.equal(isPublicRole('admin'), false);
  assert.equal(isPublicRole(''), false);
});