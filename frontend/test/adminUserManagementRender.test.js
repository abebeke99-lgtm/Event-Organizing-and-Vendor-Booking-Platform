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
  globalThis.window = {
    location: {
      search: '?status=invalid&sortBy=unknown&sortDirection=sideways&dateFrom=2026-02-31&focus=bad',
    },
  };

  try {
    const { default: AdminUserManagement } = await server.ssrLoadModule('/src/AdminUserManagement.jsx');
    const html = renderToString(createElement(AdminUserManagement, {
      initialUsers: [{
        id: 41,
        full_name: 'Test User',
        email: 'test@example.test',
        phone: '+1 202 555 0100',
        digital_id: 'EH-00000000000000000000000000000000',
        fid_number: 'FID-12345',
        roles: 'vendor',
        status: 'active',
        created_at: '2026-01-15T12:00:00Z',
        bookings_count: 2,
      }],
    }));

    assert.match(html, /Test User/);
    assert.match(html, /test@example\.test/);
    assert.match(html, /EH-00000000000000000000000000000000/);
    assert.match(html, /FID-12345/);
    assert.match(html, /Digital ID/);
    assert.match(html, /FID Number \(D\/F\)/);
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
