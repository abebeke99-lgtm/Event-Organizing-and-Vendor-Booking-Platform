import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectWithRetry, isTransientPostgresError } from '../src/lib/postgresRetry.js';
import { createPostgresRuntimePool } from '../src/postgresPool.js';

test('PostgreSQL connection acquisition retries transient connection errors with bounded backoff', async () => {
  const delays = [];
  let calls = 0;
  const client = { id: 'connected' };
  const result = await connectWithRetry(async () => {
    calls += 1;
    if (calls < 4) {
      throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    }
    return client;
  }, {
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(result, client);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test('PostgreSQL connection acquisition does not retry SQL, constraint, or authentication errors', async () => {
  for (const error of [
    Object.assign(new Error('syntax error at or near FROM'), { code: '42601' }),
    Object.assign(new Error('unique constraint violation'), { code: '23505' }),
    Object.assign(new Error('password authentication failed'), { code: '28P01' }),
  ]) {
    let calls = 0;
    await assert.rejects(connectWithRetry(async () => {
      calls += 1;
      throw error;
    }, { sleep: async () => assert.fail('Non-transient errors must not sleep.') }), error);
    assert.equal(calls, 1);
  }
});

test('PostgreSQL connection acquisition stops after four attempts and recognizes connection failures', async () => {
  const delays = [];
  let calls = 0;
  await assert.rejects(connectWithRetry(async () => {
    calls += 1;
    throw Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' });
  }, {
    sleep: async (milliseconds) => delays.push(milliseconds),
  }), /timeout expired/);

  assert.equal(calls, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
  assert.equal(isTransientPostgresError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isTransientPostgresError({ code: '57P03' }), true);
  assert.equal(isTransientPostgresError(new Error('Connection terminated unexpectedly')), true);
  assert.equal(isTransientPostgresError(new AggregateError([
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
  ])), true);
  assert.equal(isTransientPostgresError({ code: '42601', message: 'syntax error' }), false);
});

test('PostgreSQL runtime pool retries connection acquisition, never replays failed queries, and logs only safe error codes', async () => {
  const events = {};
  const statements = [];
  const logs = [];
  const delays = [];
  let connectionAttempts = 0;
  let queryAttempts = 0;
  const pool = createPostgresRuntimePool({
    environment: {
      DATABASE_URL: 'postgresql://test:test@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
    },
    poolFactory(config) {
      assert.equal(config.max, 8);
      assert.equal(config.connectionTimeoutMillis, 15000);
      assert.equal(config.idleTimeoutMillis, 10000);
      assert.equal(
        config.connectionString,
        'postgresql://test:test@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
      );
      return {
        on(event, handler) { events[event] = handler; },
        async connect() {
          connectionAttempts += 1;
          if (connectionAttempts === 1) {
            throw Object.assign(new Error('temporary network failure'), { code: 'ECONNRESET' });
          }
          return {
            async query(statement) {
              queryAttempts += 1;
              statements.push(statement);
              if (queryAttempts === 1) {
                throw Object.assign(new Error('do not retry query'), { code: 'ECONNRESET' });
              }
              return { rows: [{ value: 1 }] };
            },
            release() {},
          };
        },
        async end() {},
      };
    },
    logger: { error: (...args) => logs.push(args.join(' ')) },
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  await assert.rejects(pool.query('UPDATE users SET status = $1', ['active']), /do not retry query/);
  assert.equal(connectionAttempts, 2);
  assert.equal(queryAttempts, 1);
  assert.deepEqual(delays, [500]);
  assert.deepEqual(statements, ['UPDATE users SET status = $1']);

  events.error(Object.assign(new Error('secret connection data'), { code: 'ECONNRESET' }));
  assert.match(logs[0], /ECONNRESET/);
  assert.doesNotMatch(logs.join(' '), /secret connection data/);
});
