import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDatabaseAdapter } from '../src/db.js';
import { createPostgresAdapter } from '../src/lib/postgresAdapter.js';

function createPool() {
  const statements = [];
  let releaseCount = 0;
  const client = {
    async query(text, values) {
      statements.push({ text, values });
      return { command: text.split(' ')[0], rowCount: 1, rows: [{ id: '1' }] };
    },
    release() {
      releaseCount += 1;
    },
  };
  return {
    statements,
    client,
    get releaseCount() {
      return releaseCount;
    },
    async query(text, values) {
      statements.push({ text, values });
      return { command: 'SELECT', rowCount: 1, rows: [{ id: '1' }] };
    },
    async connect() {
      return client;
    },
  };
}

test('PostgreSQL adapter passes parameterized query results through without MySQL tuple coercion', async () => {
  const pool = createPool();
  const database = createPostgresAdapter(pool);
  const result = await database.query('SELECT $1::integer AS id', [1]);

  assert.deepEqual(result.rows, [{ id: '1' }]);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(pool.statements[0], { text: 'SELECT $1::integer AS id', values: [1] });
  await assert.rejects(
    database.query('SELECT $1', 'not-an-array'),
    /parameters must be provided as an array/,
  );
});

test('database normalization wraps frozen PostgreSQL adapters without mutating them', async () => {
  const rawAdapter = Object.freeze(createPostgresAdapter(createPool()));
  const database = normalizeDatabaseAdapter(rawAdapter);
  const result = await database.query('SELECT $1::integer AS id', [1]);

  assert.notStrictEqual(database, rawAdapter);
  assert.strictEqual(normalizeDatabaseAdapter(rawAdapter), database);
  assert.equal(Object.isFrozen(rawAdapter), true);
  assert.deepEqual(result.rows, [{ id: '1' }]);
  assert.equal(result.rowCount, 1);
});

test('PostgreSQL adapter destroys clients after connection failures but reuses clients after SQL errors', async () => {
  const connectionFailure = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
  const brokenPool = createPool();
  const brokenReleases = [];
  brokenPool.client.release = (error) => brokenReleases.push(error);
  brokenPool.client.query = async () => { throw connectionFailure; };
  await assert.rejects(createPostgresAdapter(brokenPool).query('SELECT 1'), (error) => error === connectionFailure);
  assert.deepEqual(brokenReleases, [connectionFailure]);

  const sqlFailure = Object.assign(new Error('syntax error'), { code: '42601' });
  const healthyPool = createPool();
  const healthyReleases = [];
  healthyPool.client.release = (error) => healthyReleases.push(error);
  healthyPool.client.query = async () => { throw sqlFailure; };
  await assert.rejects(createPostgresAdapter(healthyPool).query('SELECT FROM'), (error) => error === sqlFailure);
  assert.deepEqual(healthyReleases, [undefined]);
});

test('PostgreSQL adapter commits and releases a successful transaction', async () => {
  const pool = createPool();
  const database = createPostgresAdapter(pool);
  const value = await database.inTransaction(async (transaction) => {
    const result = await transaction.query('INSERT INTO users (full_name) VALUES ($1) RETURNING id', ['User']);
    return result.rows[0].id;
  });

  assert.equal(value, '1');
  assert.deepEqual(pool.statements.map(({ text }) => text), [
    'BEGIN',
    'INSERT INTO users (full_name) VALUES ($1) RETURNING id',
    'COMMIT',
  ]);
  assert.equal(pool.releaseCount, 1);
});

test('PostgreSQL adapter rolls back and releases when a transaction fails', async () => {
  const pool = createPool();
  const database = createPostgresAdapter(pool);
  const failure = new Error('transaction failed');

  await assert.rejects(database.inTransaction(async () => {
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(pool.statements.map(({ text }) => text), ['BEGIN', 'ROLLBACK']);
  assert.equal(pool.releaseCount, 1);
});

test('PostgreSQL adapter destroys transaction clients after connection failures', async () => {
  const pool = createPool();
  const connectionFailure = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
  const releases = [];
  pool.client.release = (error) => releases.push(error);
  pool.client.query = async (text, values) => {
    pool.statements.push({ text, values });
    if (text === 'SELECT 1') throw connectionFailure;
    return { command: text.split(' ')[0], rowCount: 0, rows: [] };
  };
  const database = createPostgresAdapter(pool);

  await assert.rejects(database.inTransaction((transaction) => transaction.query('SELECT 1')), (error) => error === connectionFailure);
  assert.deepEqual(releases, [connectionFailure]);
});

test('PostgreSQL adapter destroys transaction clients when rollback itself fails', async () => {
  const pool = createPool();
  const rollbackFailure = Object.assign(new Error('rollback failed'), { code: 'XX000' });
  const releases = [];
  pool.client.release = (error) => releases.push(error);
  pool.client.query = async (text, values) => {
    pool.statements.push({ text, values });
    if (text === 'ROLLBACK') throw rollbackFailure;
    return { command: text.split(' ')[0], rowCount: 0, rows: [] };
  };
  const database = createPostgresAdapter(pool);

  await assert.rejects(database.inTransaction(() => {
    throw new Error('transaction body failed');
  }), AggregateError);
  assert.deepEqual(releases, [rollbackFailure]);
});

test('PostgreSQL adapter isolates nested transactions with savepoints', async () => {
  const pool = createPool();
  const database = createPostgresAdapter(pool);
  await database.inTransaction(async (transaction) => {
    await transaction.query('SELECT $1', [1]);
    await assert.rejects(transaction.inTransaction(async (nested) => {
      await nested.query('SELECT $1', [2]);
      throw new Error('rollback nested unit');
    }), /rollback nested unit/);
    await transaction.query('SELECT $1', [3]);
  });

  assert.deepEqual(pool.statements.map(({ text }) => text), [
    'BEGIN',
    'SELECT $1',
    'SAVEPOINT eventhub_sp_1',
    'SELECT $1',
    'ROLLBACK TO SAVEPOINT eventhub_sp_1',
    'RELEASE SAVEPOINT eventhub_sp_1',
    'SELECT $1',
    'COMMIT',
  ]);
  assert.equal(pool.releaseCount, 1);
});
