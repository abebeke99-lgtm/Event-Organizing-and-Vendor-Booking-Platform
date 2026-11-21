import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const languageSource = await readFile(new URL('../src/language.js', import.meta.url), 'utf8');
const registrationStart = appSource.indexOf('function RegisterPage');
const registrationEnd = appSource.indexOf('function ForgotPasswordPage', registrationStart);
const registrationSource = appSource.slice(registrationStart, registrationEnd);
const registrationHandlerStart = appSource.indexOf('async function registerPublic');
const registrationHandlerEnd = appSource.indexOf('async function setPassword', registrationHandlerStart);
const registrationHandlerSource = appSource.slice(registrationHandlerStart, registrationHandlerEnd);

test('public registration renders only the requested fields in order', () => {
  const fields = [...registrationSource.matchAll(/name="(fullName|email|phone|accountType|password|acceptedTerms)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(fields, ['fullName', 'email', 'phone', 'accountType', 'password', 'acceptedTerms']);
  assert.match(registrationSource, /name="fullName" type="text"[\s\S]*?required/);
  assert.match(registrationSource, /name="email" type="email"[\s\S]*?required/);
  assert.match(registrationSource, /name="phone" type="tel"[\s\S]*?required/);
  assert.match(registrationSource, /name="acceptedTerms" type="checkbox"[\s\S]*?required/);
  assert.doesNotMatch(registrationSource, /username|confirmPassword|confirm-password/);
  assert.match(registrationSource, /accountType: 'Customer'/);
  assert.match(registrationSource, /acceptedTerms: false/);
  assert.match(registrationSource, /registerNow/);
  assert.match(registrationSource, /alreadyHaveAccount/);
  assert.match(registrationSource, /passwordStrength/);
  assert.match(registrationSource, /<PasswordField[\s\S]*name="password"/);
  assert.match(registrationSource, /required[\s\S]*registration-terms-error/);
  assert.doesNotMatch(registrationSource, /OAuthButtons|oauth-divider|oauthSignUp/);
});

test('public account dropdown lists all roles in order and defaults to Customer', () => {
  const options = [...registrationSource.matchAll(/<option value="(Customer|Organizer|Vendor)">/g)]
    .map((match) => match[1]);
  assert.deepEqual(options, ['Customer', 'Organizer', 'Vendor']);
  assert.match(registrationSource, /accountType: 'Customer'/);
});

test('registration request contains exactly the public registration fields', () => {
  assert.match(registrationHandlerSource, /JSON\.stringify\(\{fullName,email,phone,accountType,password,acceptedTerms\}\)/);
  assert.doesNotMatch(registrationHandlerSource, /username|confirmPassword|termsAccepted/);
});

test('successful registration navigates to login with a success notice and encoded email', () => {
  assert.match(registrationSource, /onRegistrationComplete\(result\)/);
  assert.match(appSource, /navigatePublic\(`\/login\?registered=1&email=\$\{encodeURIComponent\(registeredUser\.email\)\}`\)/);
  assert.match(appSource, /registrationSucceeded && <div className="alert success"/);
  assert.match(appSource, /const \[email, setEmail\] = useState\(\(\) => queryParams\.get\('email'\) \|\| ''\)/);
});

test('signup and account-created labels are translated in English and Amharic', () => {
  for (const key of ['createAccountHeading', 'fullName', 'emailAddress', 'phoneNumber', 'accountType', 'acceptTerms', 'password', 'registerNow', 'alreadyHaveAccount', 'registrationSuccess', 'registrationDuplicateAccount']) {
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
