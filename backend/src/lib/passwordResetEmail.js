import nodemailer from 'nodemailer';

export function getPasswordResetEmailConfig(environment = process.env) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = environment;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST?.trim() || /[\r\n]/.test(SMTP_HOST) || !Number.isInteger(port) || port < 1 || port > 65535
    || !SMTP_USER?.trim() || !SMTP_PASSWORD || !SMTP_FROM?.trim() || /[\r\n]/.test(SMTP_FROM)) return null;

  return {
    host: SMTP_HOST.trim(),
    port,
    secure: port === 465,
    user: SMTP_USER.trim(),
    password: SMTP_PASSWORD,
    from: SMTP_FROM.trim(),
  };
}

export function buildPasswordResetOtpEmail({ email, name, otp }, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Password reset email is not configured.');

  const greetingName = String(name || '').trim();
  const safeName = greetingName.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,';

  return {
    from: config.from,
    to: email,
    subject: 'EventFlow Password Reset Verification Code',
    text: `${greeting}\n\nYour EventFlow password reset verification code is:\n\n${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request a password reset, ignore this email.\n\nEventFlow`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">EventFlow password reset</h1><p>${safeName ? `Hello ${safeName},` : 'Hello,'}</p><p>Your EventFlow password reset verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#2165a6">${otp}</p><p>This code expires in 5 minutes.</p><p>If you did not request a password reset, ignore this email.</p><p style="margin-top:28px;color:#758198">EventFlow</p></div>`,
  };
}

export async function sendPasswordResetOtpEmail(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport
) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Password reset email is not configured.');

  const transporter = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
  });
  const result = await transporter.sendMail(buildPasswordResetOtpEmail(message, environment));
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the reset email.');
}
