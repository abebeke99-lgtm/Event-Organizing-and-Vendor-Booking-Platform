import assert from 'node:assert/strict';
import test from 'node:test';
import { readSeedConfiguration, SeedConfigurationError } from '../scripts/seed.js';

const adminTestPassword = ['A', 'a', '1', 'x'.repeat(11)].join('');
const sampleTestPassword = ['A', 'a', '1', 'x'.repeat(21)].join('');
const shortSampleTestPassword = ['A', 'a', '1', 'x'.repeat(20)].join('');

test('seed configuration names missing administrator variables without exposing values', () => {
  assert.throws(
    () => readSeedConfiguration({}),
    (error) => {
      assert.ok(error instanceof SeedConfigurationError);
      assert.match(error.message, /ADMIN_EMAIL/);
      assert.match(error.message, /ADMIN_PASSWORD/);
      return true;
    },
  );
});

test('seed configuration allows an administrator-only seed when sample passwords are omitted', () => {
  const accounts = readSeedConfiguration({
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: adminTestPassword,
  });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].role, 'admin');
});

test('seed configuration rejects partially configured sample passwords', () => {
  assert.throws(
    () => readSeedConfiguration({
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: adminTestPassword,
      SEED_ORGANIZER_PASSWORD: sampleTestPassword,
    }),
    (error) => {
      assert.ok(error instanceof SeedConfigurationError);
      assert.match(error.message, /SEED_VENDOR_PASSWORD/);
      assert.match(error.message, /SEED_CUSTOMER_PASSWORD/);
      return true;
    },
  );
});

test('seed configuration rejects sample passwords that do not meet login policy', () => {
  assert.throws(
    () => readSeedConfiguration({
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: adminTestPassword,
      SEED_ORGANIZER_PASSWORD: shortSampleTestPassword,
      SEED_VENDOR_PASSWORD: sampleTestPassword,
      SEED_CUSTOMER_PASSWORD: sampleTestPassword,
    }),
    (error) => {
      assert.ok(error instanceof SeedConfigurationError);
      assert.match(error.message, /SEED_ORGANIZER_PASSWORD/);
      assert.match(error.message, /at least 24 characters/);
      assert.doesNotMatch(error.message, /weak/i);
      return true;
    },
  );
});

test('seed configuration requires sample passwords to contain at least 24 characters', () => {
  assert.throws(
    () => readSeedConfiguration({
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: adminTestPassword,
      SEED_ORGANIZER_PASSWORD: shortSampleTestPassword,
      SEED_VENDOR_PASSWORD: sampleTestPassword,
      SEED_CUSTOMER_PASSWORD: sampleTestPassword,
    }),
    (error) => {
      assert.ok(error instanceof SeedConfigurationError);
      assert.match(error.message, /SEED_ORGANIZER_PASSWORD/);
      assert.match(error.message, /at least 24 characters/);
      return true;
    },
  );
});

test('seed configuration rejects an administrator address that collides with a sample account', () => {
  assert.throws(
    () => readSeedConfiguration({
      ADMIN_EMAIL: 'organizer@example.com',
      ADMIN_PASSWORD: adminTestPassword,
      SEED_ORGANIZER_PASSWORD: sampleTestPassword,
      SEED_VENDOR_PASSWORD: sampleTestPassword,
      SEED_CUSTOMER_PASSWORD: sampleTestPassword,
    }),
    /ADMIN_EMAIL must be different from the sample account email addresses/,
  );
});
