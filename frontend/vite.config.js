import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: false,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4000',
    },
  },
});
