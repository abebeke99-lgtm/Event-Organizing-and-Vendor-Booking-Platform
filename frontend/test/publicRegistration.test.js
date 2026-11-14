import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const languageSource = await readFile(new URL('../src/language.js', import.meta.url), 'utf8');
const registrationStart = appSource.indexOf('function RegisterPage');
const registrationEnd = appSource.indexOf('function ForgotPasswordPage', registrationStart);
const registrationSource = appSource.slice(registrationStart, registrationEnd);

test('public registration only renders customer account fields and no social signup', () => {
  assert.match(registrationSource, /name="name"/);
  assert.match(registrationSource, /name="email"/);
  assert.match(registrationSource, /name="password"/);
  assert.match(registrationSource, /name="confirm-password"/);
  assert.match(registrationSource, /registerNow/);
  assert.match(registrationSource, /alreadyHaveAccount/);
  assert.doesNotMatch(registrationSource, /accountType|registrationRole|OAuthButtons|oauth-divider|oauthSignUp/);
});

test('successful registration navigates to login with a success notice and encoded email', () => {
  assert.match(registrationSource, /onRegistrationComplete\(result\)/);
  assert.match(appSource, /navigatePublic\(`\/login\?registered=1&email=\$\{encodeURIComponent\(registeredUser\.email\)\}`\)/);
  assert.match(appSource, /registrationSucceeded && <div className="alert success"/);
  assert.match(appSource, /const \[email, setEmail\] = useState\(\(\) => queryParams\.get\('email'\) \|\| ''\)/);
});

test('signup and account-created labels are translated in English and Amharic', () => {
  for (const key of ['createAccountHeading', 'fullName', 'emailAddress', 'password', 'confirmPassword', 'registerNow', 'alreadyHaveAccount', 'registrationSuccess', 'registrationDuplicateEmail']) {
    assert.ok(translate(key, 'en'), `missing English ${key}`);
    assert.ok(translate(key, 'am'), `missing Amharic ${key}`);
  }
  assert.equal(translate('registrationSuccess', 'en'), 'Account created successfully. Please sign in.');
  assert.match(languageSource, /registrationSuccess: "መለያው/);
});

test('provider sign-in remains on the login page while signup provider labels are removed', () => {
  const loginSource = appSource.slice(appSource.indexOf('function LoginPage'), registrationStart);
  assert.match(loginSource, /<OAuthButtons/);
  assert.doesNotMatch(languageSource, /oauthSignUpGoogle|oauthSignUpMicrosoft/);
});
