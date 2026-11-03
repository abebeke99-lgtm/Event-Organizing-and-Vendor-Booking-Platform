import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const i18nRuntimePath = fileURLToPath(new URL('./src/i18n', import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiUrl = environment.VITE_API_PROXY_TARGET
    || environment.VITE_API_URL
    || `http://127.0.0.1:${environment.API_PORT || '4000'}/api`;
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
