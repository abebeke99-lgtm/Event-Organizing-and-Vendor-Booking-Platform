import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { hashPassword, isPublicRole, parsePublicLogin, parsePublicRegistration } from '../src/lib/platformAuth.js';

test('public registration accepts only customer, organizer, and vendor roles', () => {
  for (const role of ['customer', 'organizer', 'vendor']) {
    assert.equal(parsePublicRegistration({ name: 'Hana Bekele', email: 'HANA@example.com', password: 'StrongPass123', role }).success, true);
  }
  assert.equal(parsePublicRegistration({ name: 'Admin User', email: 'admin@example.com', password: 'StrongPass123', role: 'admin' }).success, false);
  assert.equal(parsePublicRegistration({ name: 'Hana Bekele', email: 'hana@example.com', password: 'StrongPass123', role: 'other' }).success, false);
});

test('registration validates name, normalized email, and strong password', () => {
  const result = parsePublicRegistration({ name: '  Hana Bekele ', email: ' HANA@example.com ', password: 'StrongPass123' });
  assert.equal(result.success, true);
  assert.equal(result.data.name, 'Hana Bekele');
  assert.equal(result.data.email, 'hana@example.com');
  assert.equal(result.data.role, 'customer');
  assert.equal(parsePublicRegistration({ name: 'H', email: 'bad', password: 'weak' }).success, false);
});

test('registration passwords must be 12 to 16 characters and meet complexity rules', () => {
  const registration = (password) => parsePublicRegistration({
    name: 'Hana Bekele',
    email: 'hana@example.com',
    password,
  }).success;

  assert.equal(registration('StrongPass12'), true);
  assert.equal(registration('StrongPassword12'), true);
  assert.equal(registration('ShortPass1'), false);
  assert.equal(registration('StrongPassword123'), false);
  assert.equal(registration('alllowercase12'), false);
  assert.equal(registration('ALLUPPERCASE12'), false);
  assert.equal(registration('NoNumbersHere'), false);
});

test('login input is validated and email is normalized', () => {
  const result = parsePublicLogin({ email: ' USER@example.com ', password: 'any-password' });
  assert.equal(result.success, true);
  assert.equal(result.data.email, 'user@example.com');
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
  assert.equal(isPublicRole('vendor'), true);
  assert.equal(isPublicRole('admin'), false);
  assert.equal(isPublicRole(''), false);
});