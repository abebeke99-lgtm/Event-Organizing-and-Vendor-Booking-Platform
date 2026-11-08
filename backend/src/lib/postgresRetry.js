const TRANSIENT_CONNECTION_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  '08001',
  '08006',
  '57P03',
  '53300',
]);
const TRANSIENT_CONNECTION_MESSAGES = [
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
  if (TRANSIENT_CONNECTION_CODES.has(cause.code)) return true;
  if (typeof cause.message !== 'string') return false;
  return TRANSIENT_CONNECTION_MESSAGES.some((pattern) => pattern.test(cause.message));
}

export async function connectWithRetry(connect, {
  attempts = 4,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof connect !== 'function') {
    throw new TypeError('PostgreSQL connection acquisition must be a function.');
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Retry attempts must be a positive integer.');
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= attempts || !isTransientPostgresError(error)) throw error;
      await sleep(500 * (2 ** (attempt - 1)));
    }
  }
}
