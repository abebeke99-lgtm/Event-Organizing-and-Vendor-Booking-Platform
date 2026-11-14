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

function getEmailBrandFooter(environment) {
  const configuredOrigin = environment.FRONTEND_URL || environment.WEB_ORIGIN;
  const logoUrl = configuredOrigin ? new URL('/assets/logo.svg', configuredOrigin) : null;
  if (logoUrl && (!['http:', 'https:'].includes(logoUrl.protocol)
    || (environment.NODE_ENV === 'production' && logoUrl.protocol !== 'https:')
    || logoUrl.username || logoUrl.password)) {
    throw new Error('Email logo URL must use a valid public HTTP or HTTPS origin.');
  }
  const logo = logoUrl
    ? `<img src="${logoUrl.href.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character])}" alt="EH logo" style="display:block;width:32px;height:auto;margin:0 auto 8px" />`
    : '';
  const year = new Date().getFullYear();
  return {
    html: `<div style="margin-top:28px;text-align:center;color:#758198">${logo}<p style="margin:0;font-size:11px">© ${year} EventHub</p></div>`,
    text: `© ${year} EventHub`,
  };
}

export function buildPasswordResetOtpEmail({
  email,
  name,
  otp,
  language = 'en',
  expiryMinutes = 10,
}, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Password reset email is not configured.');

  const isAmharic = language === 'am';
  const greetingName = String(name || '').trim();
  const safeName = greetingName.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const greeting = isAmharic
    ? `${greetingName ? `${greetingName}፣ ` : ''}ሰላም፣`
    : greetingName ? `Hello ${greetingName},` : 'Hello,';
  const subject = isAmharic
    ? 'የEventHub የይለፍ ቃል ማረጋገጫ ኮድ'
    : 'EventHub Password Reset Verification Code';
  const heading = isAmharic ? 'የEventHub የይለፍ ቃል ለውጥ' : 'EventHub password reset';
  const instruction = isAmharic
    ? 'የይለፍ ቃልዎን ለመቀየር ይህን የማረጋገጫ ኮድ ያስገቡ፦'
    : 'Enter this verification code to reset your password:';
  const expiry = isAmharic
    ? `ይህ ኮድ በ${expiryMinutes} ደቂቃ ውስጥ ጊዜው ያልፋል።`
    : `This code expires in ${expiryMinutes} minutes.`;
  const ignore = isAmharic
    ? 'ይህን ጥያቄ ካላቀረቡ፣ ይህን ኢሜይል ችላ ይበሉ።'
    : 'If you did not request this, ignore this email.';
  const brandFooter = getEmailBrandFooter(environment);

  return {
    from: config.from,
    to: email,
    subject,
    text: `${greeting}\n\n${instruction}\n\n${otp}\n\n${expiry}\n\n${ignore}\n\n${brandFooter.text}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">${heading}</h1><p>${isAmharic ? safeName ? `${safeName}፣ ሰላም፣` : 'ሰላም፣' : safeName ? `Hello ${safeName},` : 'Hello,'}</p><p>${instruction}</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#2165a6">${otp}</p><p>${expiry}</p><p>${ignore}</p>${brandFooter.html}</div>`,
  };
}

export function buildPasswordChangedEmail({ email, name, language = 'en' }, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Password reset email is not configured.');
  const isAmharic = language === 'am';
  const greetingName = String(name || '').trim();
  const safeName = greetingName.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const greeting = isAmharic
    ? `${safeName ? `${safeName}፣ ` : ''}ሰላም፣`
    : safeName ? `Hello ${safeName},` : 'Hello,';
  const heading = isAmharic ? 'የይለፍ ቃልዎ ተቀይሯል' : 'Your password was changed';
  const body = isAmharic
    ? 'የEventHub መለያዎ የይለፍ ቃል ተቀይሯል። ይህን እርምጃ ካላደረጉ፣ እባክዎ ወዲያውኑ የEventHub ድጋፍን ያግኙ።'
    : 'The password for your EventHub account has been changed. If you did not make this change, contact EventHub support immediately.';
  const brandFooter = getEmailBrandFooter(environment);
  return {
    from: config.from,
    to: email,
    subject: isAmharic ? 'የEventHub የይለፍ ቃል ለውጥ' : 'Your EventHub password was changed',
    text: `${greeting}\n\n${body}\n\n${brandFooter.text}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">${heading}</h1><p>${greeting}</p><p>${body}</p>${brandFooter.html}</div>`,
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
  const brandFooter = getEmailBrandFooter(environment);
  return {
    from: config.from,
    to: email,
    subject: 'Set your EventHub password',
    text: `${greeting}\n\nAn administrator created an EventHub account for you. Set your password using this secure link:\n\n${frontendUrl.href}\n\nThis single-use link expires in 24 hours. If you did not expect this invitation, you can ignore this email.\n\n${brandFooter.text}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">Set your EventHub password</h1><p>${safeName ? `Hello ${safeName},` : 'Hello,'}</p><p>An administrator created an EventHub account for you. Use the button below to choose your password.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">Set your password</a></p><p>This single-use link expires in 24 hours. If you did not expect this invitation, you can ignore this email.</p>${brandFooter.html}</div>`,
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

export async function sendPasswordChangedEmail(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport
) {
  const transporter = createSmtpTransport(environment, transportFactory);
  let result;
  try {
    result = await transporter.sendMail(buildPasswordChangedEmail(message, environment));
  } finally {
    transporter.close?.();
  }
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the password-change email.');
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
