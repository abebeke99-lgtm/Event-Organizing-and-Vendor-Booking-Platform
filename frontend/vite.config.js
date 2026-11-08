import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolveApiBaseUrl } from './src/api/apiUrl.js';

const i18nRuntimePath = fileURLToPath(new URL('./src/i18n', import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const configuredApiUrl = resolveApiBaseUrl(environment.VITE_API_URL, mode === 'production');
  const apiUrl = environment.VITE_API_PROXY_TARGET || configuredApiUrl;
  const apiTarget = new URL(apiUrl).origin;

  return {
    plugins: [react({ jsxImportSource: '@eventflow/i18n' })],
    resolve: {
      alias: [{ find: '@eventflow/i18n', replacement: i18nRuntimePath }],
    },
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: '@eventflow/i18n',
    },
    css: {
      postcss: false,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
            if (id.includes('/node_modules/lucide-react/')) return 'icon-vendor';
            if (id.includes('/node_modules/axios/')) return 'http-vendor';
            if (id.includes('/src/i18n/')) return 'translations';
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
