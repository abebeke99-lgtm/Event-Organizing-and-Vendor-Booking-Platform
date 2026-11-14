import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPasswordResetOtpEmail,
  buildPasswordChangedEmail,
  createSmtpTransport,
  getPasswordResetEmailConfig,
  getSmtpDiagnostic,
  sendPasswordResetOtpEmail,
  verifySmtpConnection,
} from '../src/lib/passwordResetEmail.js';

const smtpEnvironment = {
  NODE_ENV: 'test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM: 'EventHub <no-reply@example.test>',
};

test('password reset OTP email includes the code, configured expiry, and escaped name', () => {
  const message = buildPasswordResetOtpEmail({
    email: 'ada@example.test',
    name: '<Ada & Co>',
    otp: '123456',
  }, { ...smtpEnvironment, FRONTEND_URL: 'https://eventhub.example' });

  assert.equal(message.to, 'ada@example.test');
  assert.equal(message.subject, 'EventHub Password Reset Verification Code');
  assert.match(message.text, /123456/);
  assert.match(message.text, /expires in 10 minutes/);
  assert.match(message.html, /&lt;Ada &amp; Co&gt;/);
  assert.match(message.html, /src="https:\/\/eventhub\.example\/assets\/logo\.svg"/);
  assert.match(message.html, /alt="EH logo"/);
  assert.match(message.html, /© \d{4} EventHub/);
});

test('password reset email supports Amharic and password-change notifications', () => {
  const reset = buildPasswordResetOtpEmail({
    email: 'ሀ@example.test',
    name: 'ሀና',
    otp: '654321',
    language: 'am',
    expiryMinutes: 10,
  }, smtpEnvironment);
  const changed = buildPasswordChangedEmail({
    email: 'ada@example.test',
    name: '<Ada>',
    language: 'en',
  }, smtpEnvironment);

  assert.match(reset.subject, /EventHub/);
  assert.match(reset.text, /654321/);
  assert.match(reset.text, /10/);
  assert.match(reset.text, /ይህን ጥያቄ ካላቀረቡ/);
  assert.match(changed.subject, /password was changed/i);
  assert.match(changed.html, /&lt;Ada&gt;/);
});

test('password reset email configuration accepts SMTP without a frontend URL', () => {
  assert.ok(getPasswordResetEmailConfig(smtpEnvironment));
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_PASSWORD: '' }), null);
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_PORT: 'invalid' }), null);
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_SECURE: 'yes' }), null);
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_SECURE: 'true' }).secure, true);
  assert.equal(getPasswordResetEmailConfig({ ...smtpEnvironment, SMTP_PORT: '465' }).secure, true);
});

test('SMTP delivery succeeds only when the provider accepts the recipient', async () => {
  let transportOptions;
  let sentMessage;
  let closed = false;
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
      close() { closed = true; },
    };
  });

  assert.equal(transportOptions.requireTLS, true);
  assert.equal(transportOptions.tls.rejectUnauthorized, true);
  assert.equal(sentMessage.to, 'ada@example.test');
  assert.equal(closed, true);
  await assert.rejects(sendPasswordResetOtpEmail({
    email: 'ada@example.test',
    name: 'Ada',
    otp: '123456',
  }, smtpEnvironment, () => ({
    async sendMail() {
      return { accepted: [], rejected: ['ada@example.test'] };
    },
    close() {},
  })), /did not accept/);
});

test('SMTP connection verification closes the transport on success and failure', async () => {
  let closed = false;
  await verifySmtpConnection(smtpEnvironment, (options) => {
    assert.equal(options.secure, false);
    return { async verify() {}, close() { closed = true; } };
  });
  assert.equal(closed, true);

  closed = false;
  await assert.rejects(verifySmtpConnection(smtpEnvironment, () => ({
    async verify() { throw new Error('private SMTP details'); },
    close() { closed = true; },
  })), /private SMTP details/);
  assert.equal(closed, true);
});

test('SMTP diagnostics do not reveal provider error details', () => {
  const error = Object.assign(new Error('smtp-password leaked'), { code: 'EAUTH' });
  const diagnostic = getSmtpDiagnostic(error);
  assert.equal(diagnostic, 'SMTP authentication failed (EAUTH).');
  assert.doesNotMatch(diagnostic, /smtp-password|leaked/);
});

test('SMTP transport uses the configured TLS mode and verifies peer certificates', () => {
  let options;
  createSmtpTransport({ ...smtpEnvironment, SMTP_PORT: '465', SMTP_SECURE: 'true' }, (config) => {
    options = config;
    return {};
  });
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, false);
  assert.equal(options.tls.rejectUnauthorized, true);

  createSmtpTransport({ ...smtpEnvironment, SMTP_SECURE: 'false' }, (config) => {
    options = config;
    return {};
  });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
});
