import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const inheritedOpenAiApiKey = process.env.OPENAI_API_KEY;
if (!inheritedOpenAiApiKey?.trim()) delete process.env.OPENAI_API_KEY;

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
});

if (!process.env.OPENAI_API_KEY?.trim() && inheritedOpenAiApiKey !== undefined) {
  process.env.OPENAI_API_KEY = inheritedOpenAiApiKey;
}
