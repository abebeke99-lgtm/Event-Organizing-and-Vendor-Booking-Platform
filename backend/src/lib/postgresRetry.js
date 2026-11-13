const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  '57P03',
]);
const BROKEN_CONNECTION_CODES = new Set([
  ...TRANSIENT_CONNECTION_CODES,
  '57P01',
  '57P02',
]);
const TRANSIENT_CONNECTION_MESSAGES = [
  /connection terminated due to connection timeout/i,
  /connection terminated unexpectedly/i,
  /timeout expired/i,
  /server closed the connection unexpectedly/i,
];

export function getPostgresErrorCause(error) {
  const visited = new Set();
  const pending = [error];
  let first = null;
  for (let depth = 0; pending.length && depth < 8; depth += 1) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (!first && current.name !== 'AggregateError') first = current;
    if (typeof current.code === 'string') return current;
    if (Array.isArray(current.errors)) pending.push(...current.errors);
    if (current.cause) pending.push(current.cause);
  }
  return first || error;
}

export function isTransientPostgresError(error) {
  const cause = getPostgresErrorCause(error);
  if (!cause || typeof cause !== 'object') return false;
  if (typeof cause.code === 'string' && (TRANSIENT_CONNECTION_CODES.has(cause.code) || cause.code.startsWith('08'))) {
    return true;
  }
  if (typeof cause.message !== 'string') return false;
  return TRANSIENT_CONNECTION_MESSAGES.some((pattern) => pattern.test(cause.message));
}

export function isPostgresConnectionError(error) {
  const cause = getPostgresErrorCause(error);
  if (!cause || typeof cause !== 'object') return false;
  if (typeof cause.code === 'string'
    && (BROKEN_CONNECTION_CODES.has(cause.code) || cause.code.startsWith('08'))) {
    return true;
  }
  if (typeof cause.message !== 'string') return false;
  return TRANSIENT_CONNECTION_MESSAGES.some((pattern) => pattern.test(cause.message));
}

export async function connectWithRetry(connect, {
  attempts = 2,
  initialDelayMillis = 250,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof connect !== 'function') {
    throw new TypeError('PostgreSQL connection acquisition must be a function.');
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Retry attempts must be a positive integer.');
  }
  if (!Number.isInteger(initialDelayMillis) || initialDelayMillis < 0) {
    throw new Error('Retry delay must be a non-negative integer.');
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= attempts || !isTransientPostgresError(error)) throw error;
      await sleep(initialDelayMillis * (2 ** (attempt - 1)));
    }
  }
}
