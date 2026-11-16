import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const componentSource = await readFile(new URL('../src/AdminUserManagement.jsx', import.meta.url), 'utf8');

test('create-user form includes credentials, a generated digital ID, and optional FID', () => {
  const createForm = componentSource.slice(
    componentSource.indexOf('function UserModal'),
    componentSource.indexOf('function ActionModal'),
  );
  assert.match(createForm, /adminUserPassword/);
  assert.match(createForm, /adminUserConfirmPassword/);
  assert.match(createForm, /adminUserDigitalIdGenerated/);
  assert.match(createForm, /adminUserFidNumber/);
  assert.match(createForm, /showPassword \? 'text' : 'password'/);
  assert.match(createForm, /adminUserCreateAccount/);
  assert.match(createForm, /adminUserServiceCategory/);
  assert.match(createForm, /adminUserBusinessName/);
  assert.match(createForm, /adminUserCancel/);
});

test('create-user form offers only organizer and vendor roles', () => {
  const createForm = componentSource.slice(
    componentSource.indexOf('function UserModal'),
    componentSource.indexOf('function ActionModal'),
  );
  assert.match(createForm, /roles\.map\(\(role\)/);
  assert.match(componentSource, /\['organizer', 'vendor'\]\.includes/);
  assert.match(componentSource, /roles\.map\(\(role\) => role\.id\)/);
  assert.doesNotMatch(componentSource.slice(componentSource.indexOf('setRoles(allRoles.filter'), componentSource.indexOf('setRoles(allRoles.filter') + 180), /customer/);
  assert.doesNotMatch(createForm, /adminUserRoleadmin/);
});

test('create-account and invitation-management messages are localized in English and Amharic', () => {
  for (const key of [
    'adminUserCreateAccount',
    'adminUserBusinessName',
    'adminUserServiceCategory',
    'adminUserPassword',
    'adminUserConfirmPassword',
    'adminUserDigitalId',
    'adminUserFidNumber',
    'adminUserCreated',
    'adminUserPasswordMismatch',
    'adminUserInviteEmailFailed',
    'adminUserResendInvitation',
    'adminUserStatusInvited',
  ]) {
    assert.ok(translate(key, 'en'));
    assert.ok(translate(key, 'am'));
  }
});

test('invited accounts can be filtered separately from active and deactivated accounts', () => {
  assert.match(componentSource, /const userFilterStatusOptions = \['pending', \.\.\.statusOptions\]/);
  assert.match(componentSource, /userFilterStatusOptions\.map\(\(status\)/);
  assert.equal(translate('adminUserStatusPending', 'en'), 'Invited');
  assert.equal(translate('adminUserStatusPending', 'am'), 'ግብዣ ተልኳል');
});
