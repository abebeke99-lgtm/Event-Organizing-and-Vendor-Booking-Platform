import bcrypt from 'bcryptjs';
import { createApp } from './backend/src/app.js';

const syntheticPassword = 'SyntheticAdminPassword12';
const passwordHash = await bcrypt.hash(syntheticPassword, 4);
const users = new Map([
  ['active-admin@example.test', { id: 21, full_name: 'Synthetic Admin', email: 'active-admin@example.test', password_hash: passwordHash, status: 'active', role: 'admin', is_admin: 1, role_is_active: 1 }],
  ['customer@example.test', { id: 24, full_name: 'Synthetic Customer', email: 'customer@example.test', password_hash: passwordHash, status: 'active', role: 'customer', is_admin: 0, role_is_active: 1 }],
]);
const sessions = new Map();
function findUserById(id) { return [...users.values()].find((user) => String(user.id) === String(id)); }
function findSession(tokenHash) { return sessions.get(tokenHash); }

const database = {
  async execute(statement, values = []) {
    if (statement.includes('FROM system_settings')) return [[], []];
    if (statement.includes('FROM users u') && statement.includes('LOWER(u.email) = ?')) {
      const user = users.get(values[0]);
      return [user ? [user] : [], []];
    }
    if (statement.startsWith('UPDATE users SET last_login_at')) return [{ affectedRows: 1 }, []];
    if (statement.includes('FROM users u') && statement.includes('GROUP_CONCAT(DISTINCT r.name')) {
      const session = findSession(values[0]);
      const user = findUserById(session?.user_id);
      return [user?.is_admin ? [{ ...user, roles: 'Admin' }] : [], []];
    }
    if (statement.includes('FROM user_sessions s') && statement.includes('SELECT 1 FROM user_sessions')) {
      const user = findUserById(findSession(values[0])?.user_id);
      return [user && user.status === 'active' && !user.is_admin ? [{ 1: 1 }] : [], []];
    }
    if (statement.includes('FROM user_sessions s') && statement.includes('GROUP_CONCAT(DISTINCT p.permission_key')) {
      const user = findUserById(findSession(values[0])?.user_id);
      return [user && user.status === 'active' && user.role_is_active ? [{ ...user, permission_keys: '' }] : [], []];
    }
    if (statement.includes('FROM user_sessions s') && statement.includes('WHERE s.token_hash = ?')) {
      const session = findSession(values[0]);
      const user = findUserById(session?.user_id);
      if (!user || user.status !== 'active') return [[], []];
      return [[{
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: null,
        preferred_language: 'en',
        status: user.status,
        role: user.is_admin ? 'admin' : user.role,
        is_admin: user.is_admin,
        vendor_profile_id: null,
        business_name: null,
        category_name: null,
      }]];
    }
    if (statement.includes('FROM admin_sessions s') && statement.includes('WHERE s.token_hash = ?')) {
      const session = findSession(values[0]);
      const user = findUserById(session?.user_id);
      if (!user || user.status !== 'active') return [[], []];
      return [[{ id: user.id, full_name: user.full_name, email: user.email, phone: null, preferred_language: 'en', status: user.status, role: 'admin', is_admin: 1, vendor_profile_id: null, business_name: null, category_name: null }]];
    }
    if (statement.includes('profile_photo IS NOT NULL')) {
      const user = findUserById(values[0]);
      return [user ? [{ id: user.id, full_name: user.full_name, email: user.email, phone: null, status: user.status, created_at: '2026-01-01 00:00:00', has_profile_photo: 0, roles: user.is_admin ? 'Admin' : '' }] : [], []];
    }
    if (statement.startsWith('INSERT INTO user_sessions')) {
      sessions.set(values[0], { user_id: values[1], expires_at: values[2] });
      return [{ affectedRows: 1, insertId: 1 }, []];
    }
    if (statement.includes('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    return [[], []];
  },
  async query() { return [[],[]]; },
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      async execute(statement, values = []) {
        if (statement.startsWith('INSERT INTO user_sessions')) {
          sessions.set(values[0], { user_id: values[1], expires_at: values[2] });
        }
        return [{ affectedRows: 1, insertId: 1 }, []];
      },
      release() {},
    };
  },
};

const app = createApp({ database });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const response = await fetch(`${baseUrl}/api/platform/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'customer@example.test', password: syntheticPassword }),
});
const cookieHeader = response.headers.get('set-cookie') || '';
const token = cookieHeader.match(/platform_session=([^;]+)/)?.[1];
console.log('login status', response.status);
console.log('login body', await response.text());
console.log('cookieHeader', cookieHeader);
console.log('token', token);
const denied = await fetch(`${baseUrl}/api/admin/dashboard/overview`, {
  headers: { Cookie: `platform_session=${token}` },
});
console.log('denied status', denied.status);
console.log('denied body', await denied.text());
server.close();
