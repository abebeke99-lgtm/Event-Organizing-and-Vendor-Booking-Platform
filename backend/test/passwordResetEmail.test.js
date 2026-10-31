import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPasswordResetOtpEmail,
  getPasswordResetEmailConfig,
  sendPasswordResetOtpEmail,
} from '../src/lib/passwordResetEmail.js';

const smtpEnvironment = {
  NODE_ENV: 'test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM: 'EventFlow <no-reply@example.test>',
};

test('password reset OTP email includes the code, five-minute expiry, and escaped name', () => {
  const message = buildPasswordResetOtpEmail({
    email: 'ada@example.test',
    name: '<Ada & Co>',
    otp: '123456',
  }, smtpEnvironment);

  assert.equal(message.to, 'ada@example.test');
  assert.equal(message.subject, 'EventFlow Password Reset Verification Code');
  assert.match(message.text, /123456/);
  assert.match(message.text, /expires in 5 minutes/);
  assert.match(message.html, /&lt;Ada &amp; Co&gt;/);
});

test('password reset email configuration accepts SMTP without a frontend URL', () => {
  assert.ok(getPasswordResetEmailConfig(smtpEnvironment));
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_PASSWORD: '' }), null);
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_PORT: 'invalid' }), null);
});

test('SMTP delivery succeeds only when the provider accepts the recipient', async () => {
  let transportOptions;
  let sentMessage;
  await sendPasswordResetOtpEmail({
    email: 'ada@example.test',
    name: 'Ada',
    otp: '123456',
  }, smtpEnvironment, (options) => {
    transportOptions = options;
    return {
      async sendMail(message) {
        sentMessage = message;
        return { accepted: ['ada@example.test'], rejected: [] };
      },
    };
  });

  assert.equal(transportOptions.requireTLS, true);
  assert.equal(sentMessage.to, 'ada@example.test');
  await assert.rejects(sendPasswordResetOtpEmail({
    email: 'ada@example.test',
    name: 'Ada',
    otp: '123456',
  }, smtpEnvironment, () => ({
    async sendMail() {
      return { accepted: [], rejected: ['ada@example.test'] };
    },
  })), /did not accept/);
});
