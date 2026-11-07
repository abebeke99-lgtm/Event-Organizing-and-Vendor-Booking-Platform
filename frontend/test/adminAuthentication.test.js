import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';
import {
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

test('all supported roles sign in through one normalized platform endpoint', async () => {
  for (const role of ['admin', 'organizer', 'vendor', 'customer']) {
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
  assert.equal(dashboardPathForRole('admin'), '/admin/dashboard');
  assert.equal(dashboardPathForRole('organizer'), '/organizer/dashboard');
  assert.equal(dashboardPathForRole('vendor'), '/vendor/dashboard');
  assert.equal(dashboardPathForRole('customer'), '/customer/dashboard');
  assert.equal(dashboardPathForRole('unknown'), '/login');
});

test('legacy admin login URL redirects to the unified login route', () => {
  assert.equal(getAdministratorRouteRedirect('/admin/login'), '/login');
  assert.equal(getAdministratorRouteRedirect('/admin', null), '/login');
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
