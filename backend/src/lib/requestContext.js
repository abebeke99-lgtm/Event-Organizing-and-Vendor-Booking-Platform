import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requestContext = new AsyncLocalStorage();

export function requestContextMiddleware(req, res, next) {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
}

export function getRequestId() {
  return requestContext.getStore()?.requestId || null;
}
