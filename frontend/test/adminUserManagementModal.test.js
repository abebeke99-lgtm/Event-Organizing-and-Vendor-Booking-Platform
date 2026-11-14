import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translate } from '../src/language.js';

const componentSource = await readFile(new URL('../src/AdminUserManagement.jsx', import.meta.url), 'utf8');

test('create-user form requests an invitation instead of a permanent password', () => {
  const createForm = componentSource.slice(
    componentSource.indexOf('function UserModal'),
    componentSource.indexOf('function ActionModal'),
  );
  assert.match(createForm, /adminUserCreateAndInvite/);
  assert.match(createForm, /adminUserServiceCategory/);
  assert.match(createForm, /adminUserBusinessName/);
  assert.doesNotMatch(createForm, /type="password"|adminUserInitialPassword|adminUserConfirmPassword/);
});

test('create-user form supports customer, organizer, and vendor but never administrator roles', () => {
  const createForm = componentSource.slice(
    componentSource.indexOf('function UserModal'),
    componentSource.indexOf('function ActionModal'),
  );
  assert.match(createForm, /roles\.map\(\(role\)/);
  assert.match(componentSource, /\['customer', 'organizer', 'vendor'\]\.includes/);
  assert.doesNotMatch(createForm, /adminUserRoleadmin/);
});

test('invitation-management messages are localized in English and Amharic', () => {
  for (const key of [
    'adminUserCreateAndInvite',
    'adminUserBusinessName',
    'adminUserServiceCategory',
    'adminUserInvitationSent',
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
