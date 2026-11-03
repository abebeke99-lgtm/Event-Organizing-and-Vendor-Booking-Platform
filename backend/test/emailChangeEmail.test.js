import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminEmailChangeOtpMessage, sendAdminEmailChangeOtpEmail } from '../src/lib/emailChangeEmail.js';

const environment = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer@example.test',
  SMTP_PASSWORD: 'mailer-password',
  SMTP_FROM: 'EventHub <mailer@example.test>',
};

test('email-change verification message escapes names and expires the code after ten minutes', () => {
  const message = buildAdminEmailChangeOtpMessage({
    email: 'new@example.test',
    name: '<Admin>',
    otp: '123456',
  }, environment);

  assert.equal(message.to, 'new@example.test');
  assert.match(message.text, /expires in 10 minutes/);
  assert.match(message.html, /&lt;Admin&gt;/);
  assert.doesNotMatch(message.html, /<Admin>/);
  assert.match(message.html, /123456/);
});

test('email-change sender requires provider acceptance for the requested address', async () => {
  let transportOptions;
  let sentMessage;
  await sendAdminEmailChangeOtpEmail({
    email: 'new@example.test',
    name: 'Admin',
    otp: '123456',
  }, environment, (options) => {
    transportOptions = options;
    return {
      async sendMail(message) {
        sentMessage = message;
        return { accepted: ['new@example.test'], rejected: [] };
      },
    };
  });

  assert.equal(transportOptions.requireTLS, true);
  assert.equal(sentMessage.to, 'new@example.test');
  assert.equal(sentMessage.from, environment.SMTP_FROM);
});

test('email-change sender fails when provider does not accept the requested address', async () => {
  await assert.rejects(
    sendAdminEmailChangeOtpEmail({
      email: 'new@example.test',
      name: 'Admin',
      otp: '123456',
    }, environment, () => ({
      async sendMail() {
        return { accepted: [], rejected: ['new@example.test'] };
      },
    })),
    /SMTP provider did not accept/,
  );
});
