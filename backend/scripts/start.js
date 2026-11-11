import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

if (process.env.NODE_ENV === 'production') {
  await import('../src/server.js');
} else {
  await import('./dev-neon.js');
}
