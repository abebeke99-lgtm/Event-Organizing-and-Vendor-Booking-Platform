import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REMEMBERED_SESSION_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  setSessionCookie,
} from '../src/lib/sessionCookie.js';

test('session cookies use secure production options and the selected lifetime', () => {
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
  };
  const calls = [];
  const response = {
    cookie: (...args) => calls.push(args),
  };

  try {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_SAME_SITE = 'none';

    setSessionCookie(response, 'regular-token');
    setSessionCookie(response, 'remembered-token', true);

    assert.deepEqual(calls, [
      ['platform_session', 'regular-token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: SESSION_LIFETIME_MS,
      }],
      ['platform_session', 'remembered-token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: REMEMBERED_SESSION_LIFETIME_MS,
      }],
    ]);
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
