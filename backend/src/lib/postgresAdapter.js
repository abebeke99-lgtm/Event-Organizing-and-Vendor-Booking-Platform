import { AsyncLocalStorage } from 'node:async_hooks';
import { isPostgresConnectionError } from './postgresRetry.js';

function replaceQuestionMarkPlaceholders(text, values) {
  if (!values.length || !text.includes('?')) return text;

  const placeholders = [];
  let state = 'normal';
  let blockDepth = 0;
  let dollarTag = '';
  let positionalParameterCount = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (state === 'single-quoted') {
      if (character === '\\') {
        index += 1;
      } else if (character === "'" && next === "'") {
        index += 1;
      } else if (character === "'") {
        state = 'normal';
      }
      continue;
    }

    if (state === 'double-quoted') {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') state = 'normal';
      continue;
    }

    if (state === 'line-comment') {
      if (character === '\n') state = 'normal';
      continue;
    }

    if (state === 'block-comment') {
      if (character === '/' && next === '*') {
        blockDepth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) state = 'normal';
      }
      continue;
    }

    if (state === 'dollar-quoted') {
      if (text.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        state = 'normal';
      }
      continue;
    }

    if (character === "'") {
      state = 'single-quoted';
    } else if (character === '"') {
      state = 'double-quoted';
    } else if (character === '-' && next === '-') {
      state = 'line-comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      state = 'block-comment';
      blockDepth = 1;
      index += 1;
    } else if (character === '$') {
      const match = text.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        state = 'dollar-quoted';
        index += dollarTag.length - 1;
      } else if (/\d/.test(next || '')) {
        positionalParameterCount += 1;
      }
    } else if (character === '?') {
      placeholders.push(index);
    }
  }

  if (placeholders.length !== values.length || positionalParameterCount > 0) return text;

  let output = '';
  let previousIndex = 0;
  placeholders.forEach((placeholder, index) => {
    output += `${text.slice(previousIndex, placeholder)}$${index + 1}`;
    previousIndex = placeholder + 1;
  });
  return output + text.slice(previousIndex);
}

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
    text = replaceQuestionMarkPlaceholders(text, values);
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
