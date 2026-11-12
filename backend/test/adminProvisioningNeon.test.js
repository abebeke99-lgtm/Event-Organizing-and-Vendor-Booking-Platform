import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AdministratorProvisioningError, provisionAdministrator } from '../src/lib/adminProvisioning.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import { createPostgresDatabase } from '../src/postgresDb.js';

const integrationEnabled = process.env.RUN_NEON_INTEGRATION === 'true';

function makeCredentials(prefix) {
  const suffix = randomUUID();
  return {
    email: `${prefix}-${suffix}@example.invalid`,
    name: `Neon Admin ${prefix} ${suffix}`,
    password: 'Abcdefghijk1!',
  };
}

test('Neon admin provisioning creates a single administrator, blocks duplicates, and succeeds under concurrent race protection', {
  skip: integrationEnabled ? false : 'Set RUN_NEON_INTEGRATION=true to use backend/.env.neon-test.',
}, async () => {
  const environment = await loadNeonTestEnvironment();
  const database = createPostgresDatabase(environment);
  const insertedUserIds = [];

  const cleanup = async () => {
    for (const userId of insertedUserIds) {
      await database.runtimeAdapter.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      await database.runtimeAdapter.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  };

  try {
    const identity = await database.verifyRuntimeConnection();
    assert.equal(identity.database_name, 'eventhub');

    const primary = makeCredentials('primary');
    const createdUserId = await provisionAdministrator(database.runtimePool, primary);
    insertedUserIds.push(createdUserId);

    const userResult = await database.runtimeAdapter.query(
      'SELECT id, full_name, email FROM users WHERE id = $1',
      [createdUserId],
    );
    assert.equal(userResult.rows[0].email, primary.email.toLowerCase());
    assert.equal(userResult.rows[0].full_name, primary.name);

    const roleResult = await database.runtimeAdapter.query(
      'SELECT user_id, role_id FROM user_roles WHERE user_id = $1',
      [createdUserId],
    );
    assert.equal(roleResult.rows.length, 1);

    await assert.rejects(
      () => provisionAdministrator(database.runtimePool, primary),
      (error) => error instanceof AdministratorProvisioningError && /already exists/i.test(error.message),
    );

    const adapterCredentials = makeCredentials('adapter');
    const adapterUserId = await provisionAdministrator(database.runtimeAdapter, adapterCredentials);
    insertedUserIds.push(adapterUserId);

    const duplicateEmail = makeCredentials('concurrent');
    const concurrentResults = await Promise.allSettled([
      provisionAdministrator(database.runtimeAdapter, { ...duplicateEmail, name: 'Concurrent A' }),
      provisionAdministrator(database.runtimeAdapter, { ...duplicateEmail, name: 'Concurrent B' }),
    ]);

    const successful = concurrentResults.filter((result) => result.status === 'fulfilled');
    const rejected = concurrentResults.filter((result) => result.status === 'rejected');
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof AdministratorProvisioningError);
    assert.match(rejected[0].reason.message, /already exists/i);
    if (successful[0].status === 'fulfilled') {
      insertedUserIds.push(successful[0].value);
    }

    const duplicateCount = await database.runtimeAdapter.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE LOWER(email) = LOWER($1)',
      [duplicateEmail.email],
    );
    assert.equal(Number(duplicateCount.rows[0].total), 1);

    const concurrentUserId = successful[0]?.status === 'fulfilled' ? successful[0].value : null;
    if (concurrentUserId !== null) {
      const roleCount = await database.runtimeAdapter.query(
        'SELECT COUNT(*)::int AS total FROM user_roles WHERE user_id = $1',
        [concurrentUserId],
      );
      assert.equal(Number(roleCount.rows[0].total), 1);
    }

    const conflictingCredentials = makeCredentials('constraint');
    let injectedUserId;
    let observedPostgresDuplicateKey = false;
    let injected = false;
    const conflictingDatabase = {
      query: (...args) => database.runtimeAdapter.query(...args),
      inTransaction: (work) => database.runtimeAdapter.inTransaction((connection) => work({
        async query(text, values) {
          try {
            const result = await connection.query(text, values);
            if (!injected && text.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
              injected = true;
              const inserted = await database.runtimePool.query(
                `INSERT INTO users (full_name, email, password_hash, status)
                 VALUES ($1, $2, 'integration-only-not-a-login-hash', 'active') RETURNING id`,
                [conflictingCredentials.name, conflictingCredentials.email],
              );
              injectedUserId = inserted.rows[0].id;
              insertedUserIds.push(injectedUserId);
            }
            return result;
          } catch (error) {
            if (error.code === '23505') observedPostgresDuplicateKey = true;
            throw error;
          }
        },
      })),
    };

    await assert.rejects(
      () => provisionAdministrator(conflictingDatabase, conflictingCredentials),
      (error) => error instanceof AdministratorProvisioningError && /already exists/i.test(error.message),
    );
    assert.equal(observedPostgresDuplicateKey, true, 'the real Neon insert must report PostgreSQL error 23505');
    const conflictingUser = await database.runtimeAdapter.query(
      'SELECT id FROM users WHERE email = $1',
      [conflictingCredentials.email],
    );
    assert.equal(conflictingUser.rows.length, 1, 'the conflicting fixture remains without a duplicate provisioned account');
    const conflictingRole = await database.runtimeAdapter.query(
      'SELECT user_id FROM user_roles WHERE user_id = $1',
      [injectedUserId],
    );
    assert.equal(conflictingRole.rows.length, 0, 'the failed transaction must not attach an administrator role');
  } finally {
    await cleanup();
    await database.close();
  }
});
