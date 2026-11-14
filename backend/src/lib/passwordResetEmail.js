import nodemailer from 'nodemailer';

export function getPasswordResetEmailConfig(environment = process.env) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SECURE } = environment;
  const port = Number(SMTP_PORT);
  const secure = SMTP_SECURE === undefined || SMTP_SECURE === ''
    ? port === 465
    : SMTP_SECURE === 'true';
  if (!SMTP_HOST?.trim() || /[\r\n]/.test(SMTP_HOST) || !Number.isInteger(port) || port < 1 || port > 65535
    || !['', 'true', 'false', undefined].includes(SMTP_SECURE)
    || !SMTP_USER?.trim() || !SMTP_PASSWORD || !SMTP_FROM?.trim() || /[\r\n]/.test(SMTP_FROM)) return null;

  return {
    host: SMTP_HOST.trim(),
    port,
    secure,
    user: SMTP_USER.trim(),
    password: SMTP_PASSWORD,
    from: SMTP_FROM.trim(),
  };
}

export function createSmtpTransport(environment = process.env, transportFactory = nodemailer.createTransport) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('SMTP configuration is incomplete or invalid.');
  return transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true },
  });
}

export async function verifySmtpConnection(environment = process.env, transportFactory = nodemailer.createTransport) {
  const transporter = createSmtpTransport(environment, transportFactory);
  try {
    await transporter.verify();
  } finally {
    transporter.close?.();
  }
}

export function getSmtpDiagnostic(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'EAUTH') return 'SMTP authentication failed (EAUTH).';
  if (['ETLS', 'ESOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
    return 'SMTP TLS or network negotiation failed.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(code)) {
    return 'SMTP server connection failed.';
  }
  return 'SMTP delivery failed; check the provider configuration and server logs.';
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
    subject: 'EventHub Password Reset Verification Code',
    text: `${greeting}\n\nYour EventHub password reset verification code is:\n\n${otp}\n\nThis code expires in 5 minutes.\n\nIf you did not request a password reset, ignore this email.\n\nEventHub`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">EventHub password reset</h1><p>${safeName ? `Hello ${safeName},` : 'Hello,'}</p><p>Your EventHub password reset verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#2165a6">${otp}</p><p>This code expires in 5 minutes.</p><p>If you did not request a password reset, ignore this email.</p><p style="margin-top:28px;color:#758198">EventHub</p></div>`,
  };
}

export function buildPasswordSetupEmail({ email, name, setupUrl }, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Password setup email is not configured.');
  const frontendUrl = new URL(setupUrl);
  if (!['http:', 'https:'].includes(frontendUrl.protocol)
    || (environment.NODE_ENV === 'production' && frontendUrl.protocol !== 'https:')) {
    throw new Error('Password setup URL is invalid.');
  }
  const greetingName = String(name || '').trim();
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,';
  const safeName = greetingName ? escapeHtml(greetingName) : '';
  const safeUrl = escapeHtml(frontendUrl.href);
  return {
    from: config.from,
    to: email,
    subject: 'Set your EventHub password',
    text: `${greeting}\n\nAn administrator created an EventHub account for you. Set your password using this secure link:\n\n${frontendUrl.href}\n\nThis single-use link expires in 24 hours. If you did not expect this invitation, you can ignore this email.\n\nEventHub`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">Set your EventHub password</h1><p>${safeName ? `Hello ${safeName},` : 'Hello,'}</p><p>An administrator created an EventHub account for you. Use the button below to choose your password.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">Set your password</a></p><p>This single-use link expires in 24 hours. If you did not expect this invitation, you can ignore this email.</p><p style="margin-top:28px;color:#758198">EventHub</p></div>`,
  };
}

export async function sendPasswordResetOtpEmail(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport
) {
  const transporter = createSmtpTransport(environment, transportFactory);
  let result;
  try {
    result = await transporter.sendMail(buildPasswordResetOtpEmail(message, environment));
  } finally {
    transporter.close?.();
  }
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the reset email.');
}

export async function sendPasswordSetupEmail(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport
) {
  const transporter = createSmtpTransport(environment, transportFactory);
  let result;
  try {
    result = await transporter.sendMail(buildPasswordSetupEmail(message, environment));
  } finally {
    transporter.close?.();
  }
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the password setup email.');
}
