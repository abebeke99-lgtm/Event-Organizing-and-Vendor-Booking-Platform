import { AsyncLocalStorage } from 'node:async_hooks';
import { isPostgresConnectionError } from './postgresRetry.js';

export function createPostgresAdapter(pool, { connect = () => pool.connect() } = {}) {
  const transactionContext = new AsyncLocalStorage();
  let savepointSequence = 0;

  async function query(text, values = []) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('PostgreSQL query text must be a non-empty string.');
    }
    if (!Array.isArray(values)) {
      throw new TypeError('PostgreSQL query parameters must be provided as an array.');
    }
    const transaction = transactionContext.getStore();
    if (transaction) {
      try {
        return await transaction.client.query(text, values);
      } catch (error) {
        if (isPostgresConnectionError(error)) transaction.releaseError = error;
        throw error;
      }
    }
    const client = await connect();
    let releaseError;
    try {
      return await client.query(text, values);
    } catch (error) {
      if (isPostgresConnectionError(error)) releaseError = error;
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async function inTransaction(work) {
    if (typeof work !== 'function') {
      throw new TypeError('PostgreSQL transaction work must be a function.');
    }

    const parent = transactionContext.getStore();
    if (parent) {
      savepointSequence += 1;
      const savepoint = `eventhub_sp_${savepointSequence}`;
      await parent.client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await work(adapter);
        await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        try {
          await parent.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (rollbackError) {
          parent.releaseError = rollbackError;
          throw new AggregateError(
            [error, rollbackError],
            'Nested PostgreSQL transaction failed and savepoint rollback could not be completed.',
          );
        }
        throw error;
      }
    }

    const client = await connect();
    const state = { client, releaseError: undefined };
    try {
      await client.query('BEGIN');
      const result = await transactionContext.run(state, () => work(adapter));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (isPostgresConnectionError(error)) state.releaseError = error;
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        state.releaseError = rollbackError;
        throw new AggregateError(
          [error, rollbackError],
          'PostgreSQL transaction failed and rollback could not be completed.',
        );
      }
      throw error;
    } finally {
      client.release(state.releaseError);
    }
  }

  const adapter = Object.freeze({
    dialect: 'postgres',
    query,
    execute: query,
    inTransaction,
  });
  return adapter;
}
