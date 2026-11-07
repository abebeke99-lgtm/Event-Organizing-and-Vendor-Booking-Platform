import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import {
  getPasswordResetEmailConfig,
  getSmtpDiagnostic,
  verifySmtpConnection,
} from '../src/lib/passwordResetEmail.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

if (!getPasswordResetEmailConfig()) {
  console.error('Set valid SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM values.');
  process.exitCode = 1;
} else {
  try {
    await verifySmtpConnection();
    console.log('SMTP connection verified.');
  } catch (error) {
    console.error(getSmtpDiagnostic(error));
    process.exitCode = 1;
  }
}
