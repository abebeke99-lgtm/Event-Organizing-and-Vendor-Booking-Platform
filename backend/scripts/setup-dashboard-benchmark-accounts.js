import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { getDashboardBenchmarkAccounts } from '../src/lib/dashboardBenchmarkAccounts.js';
import { provisionAdministrator } from '../src/lib/adminProvisioning.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const accounts = getDashboardBenchmarkAccounts(process.env);
const accountByRole = new Map(accounts.map((account) => [account.role, account]));
const emailAddresses = accounts.map(({ email }) => email);

let database;
let server;
let adminCookie;

async function postJson(baseUrl, path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Account setup request ${path} failed with HTTP ${response.status}.`);
  }
  return response;
}

try {
  const environment = await loadNeonTestEnvironment();
  database = createPostgresDatabase(environment);

  const existingAccounts = await database.runtimeAdapter.query(
    'SELECT email FROM users WHERE LOWER(email) = ANY($1::varchar[])',
    [emailAddresses],
  );
  if (existingAccounts.rowCount) {
    throw new Error('One or more benchmark emails already exist; refusing to modify existing accounts.');
  }

  const roleResult = await database.runtimeAdapter.query(
    `SELECT id, LOWER(name) AS name FROM roles
     WHERE is_active = TRUE AND is_admin = FALSE
       AND LOWER(name) = ANY($1::varchar[])`,
    [['organizer', 'vendor']],
  );
  const roleIds = new Map(roleResult.rows.map(({ id, name }) => [name, id]));
  if (!roleIds.has('organizer') || !roleIds.has('vendor')) {
    throw new Error('Active Organizer and Vendor roles are required before account setup.');
  }

  const admin = accountByRole.get('admin');
  await provisionAdministrator(database.runtimeAdapter, {
    email: admin.email,
    name: admin.name,
    password: admin.password,
  });

  const app = createApp({ database: database.runtimeAdapter, databaseDialect: 'postgres' });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await postJson(baseUrl, '/api/auth/login', {
    email: admin.email,
    password: admin.password,
  });
  const setCookie = login.headers.get('set-cookie');
  const platformSession = setCookie?.match(/(?:^|,\s*)platform_session=([^;]+)/)?.[1];
  if (!platformSession) {
    throw new Error('Admin login succeeded but did not issue the expected session cookie.');
  }
  adminCookie = `platform_session=${platformSession}`;

  for (const role of ['organizer', 'vendor']) {
    const account = accountByRole.get(role);
    await postJson(baseUrl, '/api/admin/users', {
      full_name: account.name,
      email: account.email,
      password: account.password,
      role_id: roleIds.get(role),
      status: 'active',
    }, adminCookie);
  }

  const customer = accountByRole.get('customer');
  await postJson(baseUrl, '/api/platform/register', {
    name: customer.name,
    email: customer.email,
    password: customer.password,
  });

  for (const account of accounts) {
    const accountLogin = await postJson(baseUrl, '/api/auth/login', {
      email: account.email,
      password: account.password,
    });
    const cookie = accountLogin.headers.get('set-cookie')?.match(/(?:^|,\s*)platform_session=([^;]+)/)?.[1];
    if (!cookie) throw new Error(`Login verification failed for the ${account.role} benchmark account.`);

    const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `platform_session=${cookie}` },
    });
    const sessionBody = await sessionResponse.json();
    const verifiedRole = account.role === 'admin'
      ? sessionBody.user?.role
      : sessionBody.data?.user?.role;
    if (!sessionResponse.ok || verifiedRole !== account.role) {
      throw new Error(`Session verification failed for the ${account.role} benchmark account.`);
    }

    await postJson(baseUrl, '/api/auth/logout', {}, `platform_session=${cookie}`);
  }

  await postJson(baseUrl, '/api/auth/logout', {}, adminCookie);
  adminCookie = null;
  console.log('Created isolated Neon test accounts for Admin, Organizer, Vendor, and Customer.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Dashboard benchmark account setup failed.');
  process.exitCode = 1;
} finally {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
  if (database) await database.close();
}
