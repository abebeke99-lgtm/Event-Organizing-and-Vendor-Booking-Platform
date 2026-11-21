import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

if (process.env.OPENAI_API_KEY === undefined || String(process.env.OPENAI_API_KEY).trim() === '') {
  delete process.env.OPENAI_API_KEY;
}

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  override: false,
});
