import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';

const sessionToken = 'admin-logout-test-session';
const sessions = new Map([[hashToken(sessionToken), {
  user_id: 7,
  expires_at: new Date(Date.now() + 60_000),
}]]);
const auditActions = [];

const database = {
  async execute(statement, values = []) {
    if (statement.startsWith('SELECT user_id FROM admin_sessions WHERE token_hash = ?')) {
      const session = sessions.get(values[0]);
      return [session ? [{ user_id: session.user_id }] : [], []];
    }
    if (statement.includes('FROM admin_sessions s')) {
      const session = sessions.get(values[0]);
      return [session && session.expires_at > new Date() ? [{
        id: session.user_id,
        full_name: 'Logout Admin',
        email: 'logout-admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : [], []];
    }
    if (statement.startsWith('DELETE FROM admin_sessions WHERE token_hash = ?')) {
      sessions.delete(values[0]);
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('INSERT INTO audit_logs')) {
      auditActions.push(values[1]);
      return [{ insertId: auditActions.length }, []];
    }
    return [[], []];
  },
  async query() {
    return [[], []];
  },
};

const app = createApp({ database });
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test('administrator logout invalidates the server session, clears its cookie, and protects dashboard APIs', async () => {
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: `admin_session=${sessionToken}` },
  });

  assert.equal(response.status, 204);
  const clearedCookie = response.headers.get('set-cookie') || '';
  assert.match(clearedCookie, /admin_session=/);
  assert.match(clearedCookie, /Path=\//i);
  assert.match(clearedCookie, /HttpOnly/i);
  assert.match(clearedCookie, /SameSite=Lax/i);
  assert.equal(sessions.has(hashToken(sessionToken)), false);
  assert.ok(auditActions.includes('auth.logout'));

  const protectedResponse = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `admin_session=${sessionToken}` },
  });
  assert.equal(protectedResponse.status, 401);
  assert.deepEqual(await protectedResponse.json(), { error: 'Authentication required.' });
});

test('expired administrator sessions cannot access protected APIs and have their cookies cleared', async () => {
  const expiredToken = 'expired-admin-logout-session';
  sessions.set(hashToken(expiredToken), {
    user_id: 8,
    expires_at: new Date(Date.now() - 60_000),
  });

  const response = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `admin_session=${expiredToken}` },
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie') || '', /admin_session=/);
});
