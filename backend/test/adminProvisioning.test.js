import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import {
  AdministratorProvisioningError,
  getAdministratorBootstrapConfig,
  provisionAdministrator,
} from '../src/lib/adminProvisioning.js';

function createDatabase({ existing = [], roles = [{ id: 7 }], duplicateInsert = false } = {}) {
  const statements = [];
  const transaction = { started: false, committed: false, rolledBack: false, released: false };
  const connection = {
    async beginTransaction() { transaction.started = true; },
    async execute(sql, values = []) {
      statements.push({ sql, values });
      if (sql.startsWith('SELECT id FROM users')) return [existing, []];
      if (sql.startsWith('SELECT id FROM roles')) return [roles, []];
      if (sql.startsWith('INSERT INTO users')) {
        if (duplicateInsert) throw Object.assign(new Error('duplicate key'), { code: 'ER_DUP_ENTRY' });
        return [{ insertId: 31 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
    async commit() { transaction.committed = true; },
    async rollback() { transaction.rolledBack = true; },
    release() { transaction.released = true; },
  };
  return {
    database: { async getConnection() { return connection; } },
    statements,
    transaction,
  };
}

const credentials = {
  email: '  ADMIN@example.test ',
  name: '  Initial Administrator ',
  password: 'synthetic-provisioning-password',
};

test('initial admin provisioning stores only a bcrypt hash and links the active Admin role transactionally', async () => {
  const state = createDatabase();
  await provisionAdministrator(state.database, credentials);

  assert.equal(state.transaction.started, true);
  assert.equal(state.transaction.committed, true);
  assert.equal(state.transaction.rolledBack, false);
  assert.equal(state.transaction.released, true);
  const userInsert = state.statements.find(({ sql }) => sql.startsWith('INSERT INTO users'));
  assert.match(userInsert.sql, /password_hash/);
  assert.deepEqual(userInsert.values.slice(0, 2), ['Initial Administrator', 'admin@example.test']);
  assert.notEqual(userInsert.values[2], credentials.password);
  assert.equal(await bcrypt.compare(credentials.password, userInsert.values[2]), true);
  assert.doesNotMatch(JSON.stringify(state.statements), new RegExp(credentials.password));
  assert.deepEqual(
    state.statements.find(({ sql }) => sql.startsWith('INSERT INTO user_roles')).values,
    [31, 7],
  );
});

test('existing account email is refused without hashing or modifying records', async () => {
  const existingAccount = { id: 9, password_hash: 'unchanged-existing-password-hash' };
  const state = createDatabase({ existing: [existingAccount] });
  let hashCalled = false;
  await assert.rejects(
    provisionAdministrator(state.database, credentials, async () => {
      hashCalled = true;
      return 'unused';
    }),
    { name: 'AdministratorProvisioningError', message: /already exists/ },
  );
  assert.equal(hashCalled, false);
  assert.equal(state.transaction.committed, false);
  assert.equal(state.transaction.rolledBack, true);
  assert.equal(state.statements.some(({ sql }) => sql.startsWith('INSERT')), false);
  assert.equal(state.statements.some(({ sql }) => /UPDATE\s+users/i.test(sql)), false);
  assert.equal(existingAccount.password_hash, 'unchanged-existing-password-hash');
});

test('concurrent duplicate insert is rolled back and reported without changing the existing account', async () => {
  const state = createDatabase({ duplicateInsert: true });
  await assert.rejects(
    provisionAdministrator(state.database, credentials, async () => 'synthetic-hash'),
    { name: 'AdministratorProvisioningError', message: /already exists/ },
  );
  assert.equal(state.transaction.committed, false);
  assert.equal(state.transaction.rolledBack, true);
  assert.equal(state.statements.some(({ sql }) => sql.startsWith('INSERT INTO user_roles')), false);
});

test('provisioning requires an active administrator role and valid secret configuration', async () => {
  const missingRole = createDatabase({ roles: [] });
  await assert.rejects(
    provisionAdministrator(missingRole.database, credentials, async () => 'unused'),
    { name: 'AdministratorProvisioningError', message: /Active Admin role is missing/ },
  );
  assert.equal(missingRole.transaction.rolledBack, true);

  const invalidPassword = createDatabase();
  await assert.rejects(
    provisionAdministrator(invalidPassword.database, { ...credentials, password: 'short' }),
    (error) => error instanceof AdministratorProvisioningError && /at least 16 characters/.test(error.message),
  );
  assert.equal(invalidPassword.transaction.started, false);
});

test('bootstrap configuration requires all variables and validates email and password length', () => {
  assert.throws(
    () => getAdministratorBootstrapConfig({}),
    (error) => error instanceof AdministratorProvisioningError
      && /ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_PASSWORD/.test(error.message),
  );
  assert.throws(
    () => getAdministratorBootstrapConfig({
      ADMIN_BOOTSTRAP_EMAIL: 'not-an-email',
      ADMIN_BOOTSTRAP_NAME: 'Initial Administrator',
      ADMIN_BOOTSTRAP_PASSWORD: credentials.password,
    }),
    { name: 'AdministratorProvisioningError', message: /valid email address/ },
  );
  assert.throws(
    () => getAdministratorBootstrapConfig({
      ADMIN_BOOTSTRAP_EMAIL: 'admin@example.test',
      ADMIN_BOOTSTRAP_NAME: 'Initial Administrator',
      ADMIN_BOOTSTRAP_PASSWORD: 'too-short',
    }),
    { name: 'AdministratorProvisioningError', message: /at least 16 characters/ },
  );
  assert.throws(
    () => getAdministratorBootstrapConfig({
      ADMIN_BOOTSTRAP_EMAIL: 'admin@example.test',
      ADMIN_BOOTSTRAP_NAME: 'Initial Administrator',
      ADMIN_BOOTSTRAP_PASSWORD: '😀'.repeat(8),
    }),
    { name: 'AdministratorProvisioningError', message: /at least 16 characters/ },
  );
});
