import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';
import {
  authenticateAdministrator,
  authenticatePlatformUser,
  getAdministratorRouteRedirect,
} from '../src/adminAuthentication.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const adminProfileSource = await readFile(new URL('../src/AdminProfile.jsx', import.meta.url), 'utf8');
const adminLoginSource = appSource.slice(
  appSource.indexOf('function Login({onLogin})'),
  appSource.indexOf('function Overview({ onNavigate })'),
);
const platformLoginSource = appSource.slice(
  appSource.indexOf('function LoginPage('),
  appSource.indexOf('function RegisterPage('),
);

test('administrator sign-in uses only the administrator authentication endpoint', async () => {
  const calls = [];
  const loginUser = { id: 12, email: 'admin@example.test' };
  const user = { ...loginUser, roles: 'Admin' };
  const result = await authenticateAdministrator(async (...args) => {
    calls.push(args);
    return args[0] === '/auth/login' ? { user: loginUser } : { user };
  }, loginUser.email, 'synthetic-password');

  assert.deepEqual(result, user);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], '/auth/login');
  assert.equal(calls[1][0], '/auth/me');
});

test('administrator sign-in rejects an unverified, mismatched, or non-admin session', async () => {
  const loginUser = { id: 12, email: 'admin@example.test' };
  for (const sessionUser of [
    null,
    { id: 12, email: 'other@example.test', roles: 'Admin' },
    { id: 13, email: 'admin@example.test', roles: 'Admin' },
    { id: 12, email: 'admin@example.test', roles: 'Vendor' },
  ]) {
    let requestCount = 0;
    await assert.rejects(
      authenticateAdministrator(async () => {
        requestCount += 1;
        return requestCount === 1 ? { user: loginUser } : { user: sessionUser };
      }, loginUser.email, 'synthetic-password'),
      /session could not be verified/,
    );
    assert.equal(requestCount, 2);
  }
});

test('administrator sign-in surfaces invalid, inactive, and unauthorized errors', async () => {
  for (const message of [
    'Invalid administrator credentials.',
    'This administrator account or role is inactive.',
    'This account is not authorized for administrator access.',
  ]) {
    await assert.rejects(
      authenticateAdministrator(async () => { throw new Error(message); }, 'admin@example.test', 'synthetic-password'),
      { message },
    );
  }
});

test('regular sign-in uses only the public account endpoint and rejects administrator responses', async () => {
  const calls = [];
  await assert.rejects(
    authenticatePlatformUser(async (...args) => {
      calls.push(args);
      return { data: { user: { id: 12, email: 'admin@example.test', role: 'admin' } } };
    }, 'admin@example.test', 'synthetic-password'),
    /customer, organizer, and vendor/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/platform/login');
});

test('regular sign-in accepts customer, organizer, and vendor accounts', async () => {
  for (const role of ['customer', 'organizer', 'vendor']) {
    const user = { id: 12, email: 'user@example.test', role };
    assert.deepEqual(
      await authenticatePlatformUser(async () => ({ data: { user } }), user.email, 'synthetic-password'),
      user,
    );
  }
});

test('administrator routes are limited to /admin/login and authorized administrators', () => {
  assert.equal(getAdministratorRouteRedirect('/admin', null, 'admin'), '/admin/login');
  assert.equal(getAdministratorRouteRedirect('/admin/users', null, 'admin'), '/admin/login');
  assert.equal(getAdministratorRouteRedirect('/admin/login', null, 'admin'), null);
  assert.equal(getAdministratorRouteRedirect('/admin/login', { role: 'admin' }, 'admin'), '/admin');
  assert.equal(getAdministratorRouteRedirect('/admin/users', { role: 'customer' }, 'customer'), '/customer/dashboard');
  assert.equal(getAdministratorRouteRedirect('/customer/dashboard', null, null), null);
});

test('administrator login provides accessible password visibility and authentication errors', () => {
  assert.match(adminLoginSource, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(adminLoginSource, /setShowPassword\(\(visible\)=>!visible\)/);
  assert.match(adminLoginSource, /aria-label=\{translate\(showPassword \? 'hidePassword' : 'showPassword', language\)\}/);
  assert.match(adminLoginSource, /className="alert error" role="alert"/);
  assert.equal(translate('showPassword', 'en'), 'Show password');
  assert.equal(translate('hidePassword', 'en'), 'Hide password');
});

test('regular sign-in does not expose a link to administrator sign-in', () => {
  assert.doesNotMatch(platformLoginSource, /href=["']\/admin\/login["']/);
});

test('administrator profile uses real email verification and secure password controls', () => {
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/email-change'/);
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/email-change\/verify'/);
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/password'/);
  assert.match(adminProfileSource, /minLength=\{16\} maxLength=\{72\}/);
  assert.match(adminProfileSource, /aria-pressed=\{visible\}/);
  assert.match(adminProfileSource, /aria-label=\{label\}/);
});
