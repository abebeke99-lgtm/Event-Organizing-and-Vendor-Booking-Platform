import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vendorItem = {
  key: 'vendors',
  label: 'Find Vendors',
  path: '/vendors',
  children: [{
    key: 'vendor-categories',
    label: 'Vendor Categories',
    path: '/vendors',
    children: [{
      key: 'category-308',
      id: 308,
      label: 'Catering',
      path: '/vendors?category=catering',
      image: '/api/platform/categories/308/image',
      icon: '/api/platform/categories/308/image',
      count: 4,
    }],
  }],
};

function renderMenu(VendorsMenu, item = vendorItem) {
  return renderToString(createElement(VendorsMenu, {
    item,
    routePath: '/',
    onNavigate() {},
    close() {},
    openPath: ['0:vendors', '1:vendor-categories'],
    setOpenPath() {},
    registerMenu() {},
    closeTimer: { current: null },
  }));
}

test('VendorsMenu renders API category image URLs as images and preserves category links', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    root: fileURLToPath(new URL('../', import.meta.url)),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  try {
    const { default: apiClient } = await server.ssrLoadModule('/src/api/axios.js');
    apiClient.defaults.baseURL = 'https://api.example.test/api';
    const { default: VendorsMenu } = await server.ssrLoadModule('/src/VendorsMenu.jsx');
    const markup = renderMenu(VendorsMenu);

    assert.match(markup, /<img[^>]+src="https:\/\/api\.example\.test\/api\/platform\/categories\/308\/image"/);
    assert.match(markup, /alt=""/);
    assert.match(markup, /href="\/vendors\?category=catering"/);
    assert.match(markup, />Catering</);
  } finally {
    await server.close();
  }
});

test('VendorsMenu renders an icon when a category image URL is absent', async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    root: fileURLToPath(new URL('../', import.meta.url)),
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  try {
    const { default: VendorsMenu } = await server.ssrLoadModule('/src/VendorsMenu.jsx');
    const item = {
      ...vendorItem,
      children: [{
        ...vendorItem.children[0],
        children: [{ ...vendorItem.children[0].children[0], image: null, icon: null }],
      }],
    };
    const markup = renderMenu(VendorsMenu, item);

    assert.doesNotMatch(markup, /<img\b/);
    assert.match(markup, /<svg\b/);
  } finally {
    await server.close();
  }
});
