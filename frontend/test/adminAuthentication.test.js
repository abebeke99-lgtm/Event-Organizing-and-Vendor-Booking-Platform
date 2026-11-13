import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';
import {
  authenticateAdministrator,
  authenticatePlatformUser,
  dashboardPathForRole,
  getAdministratorRouteRedirect,
} from '../src/adminAuthentication.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const adminProfileSource = await readFile(new URL('../src/AdminProfile.jsx', import.meta.url), 'utf8');
const loginSource = appSource.slice(
  appSource.indexOf('function LoginPage('),
  appSource.indexOf('function RegisterPage('),
);
const registerSource = appSource.slice(
  appSource.indexOf('function RegisterPage('),
  appSource.indexOf('function ForgotPasswordPage('),
);

test('administrator login verifies the shared-auth session before returning an admin', async () => {
  const calls = [];
  const loginUser = { id: 12, email: 'admin@example.test', role: 'admin' };
  const sessionUser = { ...loginUser, status: 'active', roles: ['Admin'] };
  const user = await authenticateAdministrator(async (...args) => {
    calls.push(args);
    return args[0] === '/auth/login' ? { user: loginUser } : { user: sessionUser };
  }, ' Admin@Example.Test ', 'synthetic-password');

  assert.deepEqual(user, sessionUser);
  assert.equal(calls[0][0], '/auth/login');
  assert.equal(calls[1][0], '/auth/me');
});

test('administrator login rejects a mismatched, missing, or non-admin authenticated session', async () => {
  const loginUser = { id: 12, email: 'admin@example.test', role: 'admin' };
  for (const sessionUser of [
    null,
    { id: 13, email: loginUser.email, role: 'admin', status: 'active', roles: ['Admin'] },
    { id: 12, email: loginUser.email, role: 'customer', status: 'active', roles: ['Customer'] },
    { id: 12, email: loginUser.email, role: 'admin', status: 'suspended', roles: ['Admin'] },
  ]) {
    const calls = [];
    await assert.rejects(
      authenticateAdministrator(async (...args) => {
        calls.push(args);
        return args[0] === '/auth/login' ? { user: loginUser } : { user: sessionUser };
      }, loginUser.email, 'synthetic-password'),
      /session could not be verified/,
    );
    assert.deepEqual(calls.map(([path]) => path), ['/auth/login', '/auth/me', '/auth/logout']);
  }
});

test('platform sign-in accepts only customer, organizer, and vendor accounts', async () => {
  for (const role of ['organizer', 'vendor', 'customer']) {
    const calls = [];
    const user = { id: 12, email: 'user@example.test', role };
    const result = await authenticatePlatformUser(async (...args) => {
      calls.push(args);
      return { user };
    }, '  USER@Example.Test  ', 'synthetic-password');

    assert.deepEqual(result, user);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/platform/login');
    assert.deepEqual(JSON.parse(calls[0][1].body), {
      email: 'user@example.test',
      password: 'synthetic-password',
    });
  }
});

test('platform sign-in revokes a unified login session when the account is an administrator', async () => {
  const paths = [];
  await assert.rejects(
    authenticatePlatformUser(async (path) => {
      paths.push(path);
      return path === '/platform/login'
        ? { user: { id: 12, email: 'admin@example.test', role: 'admin' } }
        : { user: null };
    }, 'admin@example.test', 'synthetic-password'),
    (error) => error.code === 'ADMIN_LOGIN_REQUIRED'
      && error.message === 'Administrator accounts must sign in at /admin/login.',
  );
  assert.deepEqual(paths, ['/platform/login', '/auth/logout']);
});

test('login rejects unsupported or missing roles and preserves backend errors', async () => {
  await assert.rejects(
    authenticatePlatformUser(async () => ({ user: { id: 1, role: 'visitor' } }), 'user@example.test', 'password'),
    /valid account and role/,
  );
  await assert.rejects(
    authenticatePlatformUser(async () => { throw new Error('This account is inactive.'); }, 'user@example.test', 'password'),
    { message: 'This account is inactive.' },
  );
});

test('login routes each role to its own dashboard', () => {
  assert.equal(dashboardPathForRole('admin'), '/admin');
  assert.equal(dashboardPathForRole('organizer'), '/organizer/dashboard');
  assert.equal(dashboardPathForRole('vendor'), '/vendor/dashboard');
  assert.equal(dashboardPathForRole('customer'), '/customer/dashboard');
  assert.equal(dashboardPathForRole('unknown'), '/login');
});

test('administrator routes preserve the dedicated login and protect the dashboard', () => {
  assert.equal(getAdministratorRouteRedirect('/admin/login'), null);
  assert.equal(getAdministratorRouteRedirect('/admin/login', { role: 'admin' }), '/admin');
  assert.equal(getAdministratorRouteRedirect('/admin', null), '/admin/login');
  assert.equal(getAdministratorRouteRedirect('/admin', { role: 'admin' }), null);
  assert.equal(getAdministratorRouteRedirect('/admin', { role: 'customer' }), null);
  assert.equal(getAdministratorRouteRedirect('/login', null), null);
});

test('unified login has no language picker, quick logins, or developer credit', () => {
  assert.match(loginSource, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(loginSource, /aria-label=\{t\(showPassword \? 'hidePassword' : 'showPassword'\)\}/);
  assert.match(loginSource, /className="alert error" role="alert"/);
  assert.match(loginSource, /disabled=\{busy\}/);
  assert.match(loginSource, /Remember me/);
  assert.match(loginSource, /navigateBrowserPath\('\/forgot-password'\)/);
  assert.match(loginSource, /navigateBrowserPath\('\/register'\)/);
  assert.match(loginSource, /<AuthLayout>/);
  assert.doesNotMatch(loginSource, /Quick login|quick-login|eventflow\.test|LanguageSelector|AuthBrand|Developer credit|login-credit/);
  assert.match(appSource, /Back to Home/);
  assert.equal(translate('showPassword', 'en'), 'Show password');
  assert.equal(translate('hidePassword', 'en'), 'Hide password');
  assert.doesNotMatch(appSource, /function AdminLogin|function Login\(/);
  assert.match(appSource, /routePath === '\/admin\/login'/);
  assert.match(appSource, /onLogin=\{loginAdministrator\} administrator/);
  assert.match(appSource, /issue\?\.code === 'ADMIN_LOGIN_REQUIRED'[\s\S]*navigatePublic\('\/admin\/login'\)/);
  assert.doesNotMatch(appSource, /function (?:Customer|Organizer|Vendor)Login/);
});

test('registration uses the shared layout and validates required fields, email, password length, and matching passwords', () => {
  assert.match(registerSource, /<AuthLayout>/);
  assert.match(registerSource, /noValidate/);
  assert.match(registerSource, /registrationEmailRequired/);
  assert.match(registerSource, /validEmailRequired/);
  assert.match(registerSource, /minLength=\{8\}/);
  assert.match(registerSource, /registrationPasswordRequired/);
  assert.match(registerSource, /registrationConfirmPasswordRequired/);
  assert.match(registerSource, /passwordMismatch/);
  assert.match(registerSource, /disabled=\{busy \|\| Boolean\(success\) \|\| !registrationEnabled\}/);
  assert.match(registerSource, /registration-login-link/);
});

test('admin profile retains secure email and password controls', () => {
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/email-change'/);
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/email-change\/verify'/);
  assert.match(adminProfileSource, /apiClient\.post\('\/admin\/profile\/password'/);
  assert.match(adminProfileSource, /minLength=\{12\} maxLength=\{16\}/);
  assert.match(adminProfileSource, /aria-pressed=\{visible\}/);
  assert.match(adminProfileSource, /aria-label=\{label\}/);
});
