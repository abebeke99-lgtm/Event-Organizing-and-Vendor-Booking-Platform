const ROLES = ['admin', 'organizer', 'vendor', 'customer'];

export function getDashboardBenchmarkAccounts(environment = process.env) {
  const missing = [];
  const accounts = ROLES.map((role) => {
    const prefix = `EVENTHUB_BENCHMARK_${role.toUpperCase()}`;
    const email = environment[`${prefix}_EMAIL`]?.trim().toLowerCase();
    const name = environment[`${prefix}_NAME`]?.trim();
    const password = environment[`${prefix}_PASSWORD`];

    if (!email) missing.push(`${prefix}_EMAIL`);
    if (!name) missing.push(`${prefix}_NAME`);
    if (!password) missing.push(`${prefix}_PASSWORD`);
    return { role, email, name, password };
  });

  if (missing.length) {
    throw new Error(`Missing benchmark account environment variables: ${missing.join(', ')}.`);
  }

  for (const account of accounts) {
    if (!/^[^\s@]+@[^\s@]+\.test$/i.test(account.email) || account.email.length > 254) {
      throw new Error('Benchmark account emails must use unique, non-routable .test addresses.');
    }
    if (account.name.length > 160) {
      throw new Error('Benchmark account names must be no longer than 160 characters.');
    }
    const passwordLength = Array.from(account.password).length;
    if (passwordLength < 16 || passwordLength > 16 || Buffer.byteLength(account.password, 'utf8') > 72
      || !/[A-Z]/.test(account.password) || !/[a-z]/.test(account.password) || !/\d/.test(account.password)) {
      throw new Error('Each benchmark password must be 16 characters and contain uppercase, lowercase, and a number.');
    }
  }

  if (new Set(accounts.map(({ email }) => email)).size !== accounts.length) {
    throw new Error('Benchmark account emails must be unique.');
  }
  if (new Set(accounts.map(({ password }) => password)).size !== accounts.length) {
    throw new Error('Use a unique password for each benchmark role.');
  }

  return accounts;
}
