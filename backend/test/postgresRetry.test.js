import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectWithRetry,
  isPostgresConnectionError,
  isTransientPostgresError,
} from '../src/lib/postgresRetry.js';
import { createPostgresRuntimePool, getPostgresRuntimePool } from '../src/postgresPool.js';

test('PostgreSQL connection acquisition retries transient connection errors with bounded backoff', async () => {
  const delays = [];
  let calls = 0;
  const client = { id: 'connected' };
  const result = await connectWithRetry(async () => {
    calls += 1;
    if (calls < 2) {
      throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    }
    return client;
  }, {
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(result, client);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
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

test('PostgreSQL connection acquisition uses one bounded retry and recognizes connection failures', async () => {
  const delays = [];
  let calls = 0;
  await assert.rejects(connectWithRetry(async () => {
    calls += 1;
    throw Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' });
  }, {
    sleep: async (milliseconds) => delays.push(milliseconds),
  }), /timeout expired/);

  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
  assert.equal(isTransientPostgresError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isTransientPostgresError({ code: '57P03' }), true);
  assert.equal(isTransientPostgresError({ code: '53300' }), false);
  assert.equal(isTransientPostgresError(new Error('Connection terminated unexpectedly')), true);
  assert.equal(isTransientPostgresError(new AggregateError([
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
  ])), true);
  assert.equal(isTransientPostgresError({ code: '42601', message: 'syntax error' }), false);
  assert.equal(isPostgresConnectionError({ code: '08006' }), true);
  assert.equal(isPostgresConnectionError({ code: '40001' }), false);
});

test('PostgreSQL runtime pool retries connection acquisition, never replays failed queries, and logs only safe error codes', async () => {
  const events = {};
  const statements = [];
  const logs = [];
  const delays = [];
  const releases = [];
  let connectionAttempts = 0;
  let queryAttempts = 0;
  const pool = createPostgresRuntimePool({
    environment: {
      DATABASE_URL: 'postgresql://test:test@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
    },
    poolFactory(config) {
      assert.equal(config.max, 2);
      assert.equal(config.connectionTimeoutMillis, 15000);
      assert.equal(config.idleTimeoutMillis, 10000);
      assert.equal(config.keepAlive, true);
      assert.equal(config.keepAliveInitialDelayMillis, 10000);
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
            release(error) { releases.push(error); },
          };
        },
        get totalCount() { return 0; },
        get idleCount() { return 0; },
        get waitingCount() { return 0; },
        async end() {},
      };
    },
    logger: { error: (...args) => logs.push(args.join(' ')) },
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  await assert.rejects(pool.query('UPDATE users SET status = $1', ['active']), /do not retry query/);
  assert.equal(connectionAttempts, 2);
  assert.equal(queryAttempts, 1);
  assert.deepEqual(delays, [250]);
  assert.equal(releases[0]?.code, 'ECONNRESET');
  assert.deepEqual(statements, ['UPDATE users SET status = $1']);
  assert.deepEqual(pool.getStats(), {
    state: 'open',
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  });

  events.error(Object.assign(new Error('secret connection data'), { code: 'ECONNRESET' }));
  assert.match(logs[0], /ECONNRESET/);
  assert.doesNotMatch(logs.join(' '), /secret connection data/);
});

test('PostgreSQL runtime pool shutdown is idempotent and rejects new acquisitions', async () => {
  let endCount = 0;
  const pool = createPostgresRuntimePool({
    environment: {
      DATABASE_URL: 'postgresql://test:test@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require',
    },
    poolFactory() {
      return {
        on() {},
        async connect() {
          assert.fail('A closed pool must not acquire clients.');
        },
        async end() {
          endCount += 1;
        },
      };
    },
  });

  const closing = pool.end();
  assert.equal(pool.end(), closing);
  await closing;
  assert.equal(endCount, 1);
  assert.equal(pool.getStats().state, 'closed');
  await assert.rejects(pool.query('SELECT 1'), /runtime pool is closed/);
});

test('PostgreSQL runtime pool getter reuses its singleton instead of creating another pool', async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test:test@ep-eventhub-pooler.us-east-2.aws.neon.tech/eventhub?sslmode=require';
  try {
    const first = getPostgresRuntimePool();
    assert.equal(getPostgresRuntimePool(), first);
    await first.end();
    assert.equal(getPostgresRuntimePool(), first);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
