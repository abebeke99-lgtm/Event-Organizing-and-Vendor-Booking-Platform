import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { createPostgresOAuthRouter } from '../src/routes/postgresOAuth.js';
import { requirePlatformAvailable } from '../src/middleware/rbac.js';

async function withOAuthServer(callback, {
  database = { query: async () => ({ rows: [] }) },
  oauthService = {
    getProviderStatuses: () => [
      { id: 'google', configured: true, status: 'configured' },
      { id: 'microsoft', configured: false, status: 'not_configured' },
    ],
    createAuthorizationUrl: (provider) => `https://provider.example.test/${provider}`,
    getFrontendUrl: (path, query) => {
      const url = new URL(path, 'https://eventhub.example.test');
      for (const [key, value] of Object.entries(query || {})) {
        if (typeof value === 'string') url.searchParams.set(key, value);
      }
      return url.href;
    },
  },
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/platform/oauth', createPostgresOAuthRouter({ database, oauthService }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('provider discovery returns all provider identifiers and safe status fields', async () => {
  await withOAuthServer(async (origin) => {
    const response = await fetch(`${origin}/api/platform/oauth/providers`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      providers: [
        { id: 'google', configured: true, status: 'configured' },
        { id: 'microsoft', configured: false, status: 'not_configured' },
      ],
    });
  });
});

test('only Google and Microsoft start routes use provider-specific authorization URLs', async () => {
  await withOAuthServer(async (origin) => {
    for (const provider of ['google', 'microsoft']) {
      const response = await fetch(`${origin}/api/platform/oauth/${provider}/start?intent=login`, {
        redirect: 'manual',
      });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), `https://provider.example.test/${provider}`);
    }
  }, {
    oauthService: {
      getProviderStatuses: () => ['google', 'microsoft']
        .map((id) => ({ id, configured: true, status: 'configured' })),
      createAuthorizationUrl: (provider) => `https://provider.example.test/${provider}`,
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
    },
  });
});

test('administrator OAuth returns unknown verified accounts to the login page without creating a session', async () => {
  await withOAuthServer(async (origin) => {
    const response = await fetch(`${origin}/api/platform/oauth/google/callback?state=state-token&code=authorization-code`, {
      headers: { Cookie: 'oauth_browser=browser-token' },
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/admin/login');
    assert.equal(location.searchParams.get('oauth'), 'error');
    assert.equal(location.searchParams.get('reason'), 'admin_account_not_found');
    assert.equal(response.headers.get('set-cookie'), null);
  }, {
    database: {
      async query(sql) {
        if (sql.includes('DELETE FROM oauth_login_states')) {
          return {
            rows: [{
              provider: 'google',
              intent: 'admin-login',
              user_id: null,
              nonce: 'one-time-nonce',
              code_verifier: 'one-time-verifier',
              remember_me: false,
            }],
          };
        }
        if (sql.includes('FROM oauth_identities oi')) return { rows: [] };
        if (sql.includes('FROM users u') && sql.includes("LOWER(u.email)")) return { rows: [] };
        throw new Error('Unexpected OAuth test query.');
      },
    },
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async () => ({
        provider: 'google',
        subject: 'verified-google-subject',
        email: 'new-admin@example.test',
        emailVerified: true,
        name: 'New Administrator',
      }),
    },
  });
});

test('unconfigured providers redirect to a click-time login error without creating state', async () => {
  let databaseQueries = 0;
  await withOAuthServer(async (origin) => {
    for (const provider of ['google', 'microsoft']) {
      const publicResponse = await fetch(
        `${origin}/api/platform/oauth/${provider}/start`,
        { redirect: 'manual' },
      );
      assert.equal(publicResponse.status, 302);
      const publicLocation = new URL(publicResponse.headers.get('location'));
      assert.equal(publicLocation.pathname, '/login');
      assert.equal(publicLocation.searchParams.get('oauth'), 'error');
      assert.equal(publicLocation.searchParams.get('reason'), 'provider_not_configured');
      assert.equal(publicLocation.searchParams.get('provider'), provider);
      assert.equal(publicResponse.headers.get('set-cookie'), null);

      const response = await fetch(
        `${origin}/api/platform/oauth/${provider}/start?intent=admin-login`,
        { redirect: 'manual' },
      );
      assert.equal(response.status, 302);
      const location = new URL(response.headers.get('location'));
      assert.equal(location.pathname, '/admin/login');
      assert.equal(location.searchParams.get('oauth'), 'error');
      assert.equal(location.searchParams.get('reason'), 'provider_not_configured');
      assert.equal(location.searchParams.get('provider'), provider);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }, {
    database: {
      async query() {
        databaseQueries += 1;
        throw new Error('Unconfigured providers must not create OAuth state.');
      },
    },
    oauthService: {
      getProviderStatuses: () => [
        { id: 'google', configured: false, status: 'not_configured' },
        { id: 'microsoft', configured: false, status: 'not_configured' },
      ],
      createAuthorizationUrl: () => { throw new Error('Must not create authorization URL.'); },
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
    },
  });
  assert.equal(databaseQueries, 0);
});

test('OAuth start does not accept a registration intent or requested role', async () => {
  let insertedStateValues;
  const database = {
    async query(sql, values = []) {
      if (sql.includes('INSERT INTO oauth_login_states')) {
        insertedStateValues = values;
        return { rows: [], rowCount: 1 };
      }
      throw new Error('Unexpected OAuth state query.');
    },
  };
  await withOAuthServer(async (origin) => {
    const registration = await fetch(
      `${origin}/api/platform/oauth/google/start?intent=register&role=vendor`,
      { redirect: 'manual' },
    );
    assert.equal(registration.status, 302);
    assert.deepEqual(insertedStateValues.slice(3, 5), ['login', null]);
    assert.equal(insertedStateValues[8], null);

    const administratorRole = await fetch(
      `${origin}/api/platform/oauth/google/start?intent=register&role=admin`,
      { redirect: 'manual' },
    );
    assert.equal(administratorRole.status, 302);
    assert.deepEqual(insertedStateValues.slice(3, 5), ['login', null]);
    assert.equal(insertedStateValues[8], null);

    for (const provider of ['facebook', 'apple']) {
      const removedProvider = await fetch(`${origin}/api/platform/oauth/${provider}/start`, {
        redirect: 'manual',
      });
      assert.equal(removedProvider.status, 404);
    }
  }, {
    database,
    oauthService: {
      getProviderStatuses: () => ['google', 'microsoft']
        .map((id) => ({ id, configured: true, status: 'configured' })),
      createAuthorizationUrl: (provider) => `https://provider.example.test/${provider}`,
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
    },
  });
});

test('an unknown verified OAuth login redirects to sign-up without creating a session', async () => {
  const stateToken = 'oauth-login-state';
  const database = {
    async query(sql) {
      if (sql.includes('DELETE FROM oauth_login_states')) {
        return { rows: [{
          provider: 'google',
          intent: 'login',
          user_id: null,
          nonce: 'one-time-nonce',
          code_verifier: 'one-time-verifier',
          remember_me: false,
          registration_role: null,
        }] };
      }
      if (sql.includes('FROM oauth_identities oi')) return { rows: [] };
      if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) return { rows: [] };
      throw new Error('Unexpected unknown-account OAuth query.');
    },
    async inTransaction(work) {
      return work(this);
    },
  };
  await withOAuthServer(async (origin) => {
    const response = await fetch(
      `${origin}/api/platform/oauth/google/callback?state=${stateToken}&code=provider-code`,
      { headers: { Cookie: 'oauth_browser=browser-token' }, redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/register');
    assert.equal(location.searchParams.get('oauth'), 'registration_required');
    assert.equal(location.searchParams.get('name'), 'New Provider User');
    assert.equal(location.searchParams.get('email'), 'new-user@example.test');
    assert.equal(response.headers.get('set-cookie'), null);
  }, {
    database,
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async () => ({
        provider: 'google',
        subject: 'verified-google-subject',
        email: 'new-user@example.test',
        emailVerified: true,
        name: 'New Provider User',
      }),
    },
  });
});

test('a cancelled supported-provider callback returns a friendly login error', async () => {
  await withOAuthServer(async (origin) => {
    const response = await fetch(
      `${origin}/api/platform/oauth/google/callback?state=cancelled-state&error=access_denied`,
      { headers: { Cookie: 'oauth_browser=browser-token' }, redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/login');
    assert.equal(location.searchParams.get('oauth'), 'error');
    assert.equal(location.searchParams.get('reason'), 'cancelled');
  }, {
    database: {
      async query(sql) {
        if (sql.includes('DELETE FROM oauth_login_states')) {
          return { rows: [{
            provider: 'google',
            intent: 'login',
            user_id: null,
            nonce: 'one-time-nonce',
            code_verifier: 'one-time-verifier',
            remember_me: false,
            registration_role: null,
          }] };
        }
        throw new Error('A cancelled OAuth response must not perform account queries.');
      },
    },
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async () => {
        throw new Error('A cancelled OAuth response must not exchange a code.');
      },
    },
  });
});

test('legacy provider registration callback sends unknown users to password-based sign-up', async () => {
  const stateToken = 'oauth-register-state';
  const saved = { users: [], roles: [], identities: [], sessions: [] };
  const database = {
    async query(sql, values = []) {
      if (sql.includes('DELETE FROM oauth_login_states')) {
        return { rows: [{
          provider: 'google',
          intent: 'register',
          user_id: null,
          nonce: 'one-time-nonce',
          code_verifier: 'one-time-verifier',
          remember_me: false,
          registration_role: 'organizer',
        }] };
      }
      if (sql.includes('FROM oauth_identities oi')) return { rows: [] };
      if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) return { rows: [] };
      if (sql.includes("setting_key = 'public_registration_enabled'")) return { rows: [] };
      if (sql.includes('SELECT id FROM roles') && sql.includes('LOWER(name) = $1')) {
        assert.equal(values[0], 'organizer');
        return { rows: [{ id: 21 }] };
      }
      if (sql.startsWith('INSERT INTO users')) {
        const user = {
          id: 42,
          full_name: values[0],
          email: values[1],
          password_hash: values[2],
          status: 'active',
        };
        saved.users.push(user);
        return { rows: [{ id: user.id, full_name: user.full_name, email: user.email }] };
      }
      if (sql.startsWith('INSERT INTO user_roles')) {
        saved.roles.push({ userId: values[0], roleId: values[1] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO oauth_identities')) {
        saved.identities.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
      if (sql.includes("setting_key = 'notify_admin_user_registrations'")) return { rows: [] };
      if (sql.startsWith('SELECT DISTINCT u.id')) return { rows: [] };
      if (sql.startsWith('UPDATE users SET last_login_at')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO user_sessions')) {
        saved.sessions.push(values);
        return { rows: [], rowCount: 1 };
      }
      throw new Error('Unexpected provider registration query.');
    },
    async inTransaction(work) {
      return work(this);
    },
  };

  await withOAuthServer(async (origin) => {
    const response = await fetch(
      `${origin}/api/platform/oauth/google/callback?state=${stateToken}&code=provider-code`,
      { headers: { Cookie: 'oauth_browser=browser-token' }, redirect: 'manual' },
    );
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/register');
    assert.equal(location.searchParams.get('oauth'), 'registration_required');
    assert.equal(location.searchParams.get('name'), 'New Provider User');
    assert.equal(location.searchParams.get('email'), 'new-user@example.test');
    assert.equal(saved.users.length, 0);
    assert.equal(saved.roles.length, 0);
    assert.equal(saved.identities.length, 0);
    assert.equal(saved.sessions.length, 0);
    assert.equal(response.headers.get('set-cookie'), null);
  }, {
    database,
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async () => ({
        provider: 'google',
        subject: 'verified-microsoft-subject',
        email: 'new-user@example.test',
        emailVerified: true,
        name: 'New Provider User',
      }),
    },
  });
});

test('an existing email requires correct password confirmation before provider linking', async () => {
  const password = 'ExistingPass123';
  const passwordHash = await bcrypt.hash(password, 10);
  const existingUser = {
    id: 55,
    full_name: 'Existing Organizer',
    email: 'existing@example.test',
    password_hash: passwordHash,
    status: 'active',
    role: 'organizer',
    is_admin: false,
    role_is_active: true,
  };
  const saved = { pending: null, identities: [], sessions: [] };
  const database = {
    async query(sql, values = []) {
      if (sql.includes('DELETE FROM oauth_login_states')) {
        return { rows: [{
          provider: 'google',
          intent: 'login',
          user_id: null,
          nonce: 'one-time-nonce',
          code_verifier: 'one-time-verifier',
          remember_me: true,
          registration_role: null,
        }] };
      }
      if (sql.includes('FROM oauth_identities oi')) return { rows: [] };
      if (sql.includes('SELECT id FROM users WHERE LOWER(email)')) return { rows: [{ id: existingUser.id }] };
      if (sql.includes('LOWER(r.name) AS role')) return { rows: [existingUser] };
      if (sql.startsWith('DELETE FROM oauth_pending_admin_links WHERE provider')) return { rows: [] };
      if (sql.startsWith('INSERT INTO oauth_pending_admin_links')) {
        saved.pending = {
          tokenHash: values[0],
          user_id: values[1],
          provider: values[2],
          provider_subject: values[3],
          provider_email: values[4],
          remember_me: values[5],
          expires_at: values[6],
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM oauth_pending_admin_links p')) {
        if (values[0] !== saved.pending?.tokenHash || values[1] !== existingUser.email) return { rows: [] };
        return { rows: [{
          ...saved.pending,
          email: existingUser.email,
          full_name: existingUser.full_name,
          password_hash: existingUser.password_hash,
          status: existingUser.status,
        }] };
      }
      if (sql.startsWith('DELETE FROM oauth_pending_admin_links')) {
        if (values[0] !== saved.pending?.tokenHash) return { rows: [] };
        const result = saved.pending;
        saved.pending = null;
        return { rows: [result] };
      }
      if (sql.startsWith('INSERT INTO oauth_identities')) {
        saved.identities.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE users SET last_login_at')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO user_sessions')) {
        saved.sessions.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 };
      throw new Error('Unexpected account-link query.');
    },
    async inTransaction(work) {
      return work(this);
    },
  };

  await withOAuthServer(async (origin) => {
    const callback = await fetch(
      `${origin}/api/platform/oauth/google/callback?state=oauth-link-state&code=provider-code`,
      { headers: { Cookie: 'oauth_browser=browser-token' }, redirect: 'manual' },
    );
    assert.equal(new URL(callback.headers.get('location')).searchParams.get('oauth'), 'link_required');
    assert.equal(saved.pending?.user_id, existingUser.id);
    assert.equal(saved.identities.length, 0);
    assert.equal(saved.sessions.length, 0);
    const pendingCookie = callback.headers.get('set-cookie').match(/admin_oauth_pending=([^;]+)/)[1];

    const rejectedLink = await fetch(`${origin}/api/platform/oauth/admin-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `admin_oauth_pending=${pendingCookie}` },
      body: JSON.stringify({ email: existingUser.email, password: 'wrong-password' }),
    });
    assert.equal(rejectedLink.status, 401);
    assert.equal(saved.identities.length, 0);
    assert.equal(saved.sessions.length, 0);

    const linked = await fetch(`${origin}/api/platform/oauth/admin-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `admin_oauth_pending=${pendingCookie}` },
      body: JSON.stringify({ email: existingUser.email, password }),
    });
    assert.equal(linked.status, 200);
    assert.equal((await linked.json()).user.role, 'organizer');
    assert.equal(saved.identities.length, 1);
    assert.equal(saved.sessions.length, 1);
  }, {
    database,
    oauthService: {
      getProviderStatuses: () => [],
      createAuthorizationUrl: () => '',
      getFrontendUrl: (path, query) => {
        const url = new URL(path, 'https://eventhub.example.test');
        for (const [key, value] of Object.entries(query || {})) {
          if (typeof value === 'string') url.searchParams.set(key, value);
        }
        return url.href;
      },
      exchangeAuthorizationCode: async () => ({
        provider: 'google',
        subject: 'verified-google-subject',
        email: existingUser.email,
        emailVerified: true,
        name: 'Existing Organizer',
      }),
    },
  });
});

test('provider discovery is available while platform availability is being checked', async () => {
  let continued = false;
  await requirePlatformAvailable({
    path: '/providers',
    app: { locals: { database: { query: async () => { throw new Error('must not query PostgreSQL'); } } } },
  }, {}, () => { continued = true; });
  assert.equal(continued, true);
});
