import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('AdminUserManagement renders a user row and all action icons without throwing', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    root: fileURLToPath(new URL('../', import.meta.url)),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  const previousWindow = globalThis.window;
  globalThis.window = { location: { search: '' } };

  try {
    const { default: AdminUserManagement } = await server.ssrLoadModule('/src/AdminUserManagement.jsx');
    const html = renderToString(createElement(AdminUserManagement, {
      initialUsers: [{
        id: 41,
        full_name: 'Test User',
        email: 'test@example.test',
        phone: '+1 202 555 0100',
        roles: 'vendor',
        status: 'active',
        created_at: '2026-01-15T12:00:00Z',
        bookings_count: 2,
      }],
    }));

    assert.match(html, /Test User/);
    assert.match(html, /test@example\.test/);
    assert.match(html, /View Test User/);
    assert.match(html, /Edit Test User/);
    assert.match(html, /Change role for Test User/);
    assert.match(html, /Deactivate account Test User/);
    assert.match(html, /Reset password for Test User/);
  } finally {
    globalThis.window = previousWindow;
    await server.close();
  }
});
