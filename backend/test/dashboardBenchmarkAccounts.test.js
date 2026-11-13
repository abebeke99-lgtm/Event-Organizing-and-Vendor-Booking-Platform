import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDashboardBenchmarkAccounts } from '../src/lib/dashboardBenchmarkAccounts.js';

function validEnvironment() {
  const environment = {};
  const passwords = {
    ADMIN: 'AdmnSafeP2026XYZ',
    ORGANIZER: 'OrganSafe2026XYZ',
    VENDOR: 'VendorSafe2026XY',
    CUSTOMER: 'CustomSafe2026XY',
  };
  for (const role of Object.keys(passwords)) {
    environment[`EVENTHUB_BENCHMARK_${role}_EMAIL`] = `${role.toLowerCase()}@eventhub.test`;
    environment[`EVENTHUB_BENCHMARK_${role}_NAME`] = `${role} Benchmark`;
    environment[`EVENTHUB_BENCHMARK_${role}_PASSWORD`] = passwords[role];
  }
  return environment;
}

test('benchmark account configuration normalizes emails and returns all four roles', () => {
  const environment = validEnvironment();
  environment.EVENTHUB_BENCHMARK_ADMIN_EMAIL = 'ADMIN@EVENTHUB.TEST';
  const accounts = getDashboardBenchmarkAccounts(environment);

  assert.deepEqual(accounts.map(({ role }) => role), ['admin', 'organizer', 'vendor', 'customer']);
  assert.equal(accounts[0].email, 'admin@eventhub.test');
});

test('benchmark account configuration rejects missing values and routable email domains', () => {
  assert.throws(() => getDashboardBenchmarkAccounts({}), /Missing benchmark account environment variables/);

  const environment = validEnvironment();
  environment.EVENTHUB_BENCHMARK_VENDOR_EMAIL = 'vendor@example.com';
  assert.throws(() => getDashboardBenchmarkAccounts(environment), /\.test addresses/);
});

test('benchmark account configuration rejects duplicate identities or passwords', () => {
  const duplicateEmailEnvironment = validEnvironment();
  duplicateEmailEnvironment.EVENTHUB_BENCHMARK_CUSTOMER_EMAIL = 'admin@eventhub.test';
  assert.throws(() => getDashboardBenchmarkAccounts(duplicateEmailEnvironment), /emails must be unique/);

  const duplicatePasswordEnvironment = validEnvironment();
  duplicatePasswordEnvironment.EVENTHUB_BENCHMARK_CUSTOMER_PASSWORD =
    duplicatePasswordEnvironment.EVENTHUB_BENCHMARK_ADMIN_PASSWORD;
  assert.throws(() => getDashboardBenchmarkAccounts(duplicatePasswordEnvironment), /unique password/);
});
