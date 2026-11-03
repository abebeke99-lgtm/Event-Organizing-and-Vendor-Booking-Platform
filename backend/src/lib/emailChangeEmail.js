import nodemailer from 'nodemailer';
import { getPasswordResetEmailConfig } from './passwordResetEmail.js';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function buildAdminEmailChangeOtpMessage({ email, name, otp }, environment = process.env) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Email change verification is not configured.');
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const safeGreeting = name ? `Hello ${escapeHtml(name)},` : 'Hello,';
  return {
    from: config.from,
    to: email,
    subject: 'EventHub Email Change Verification Code',
    text: `${greeting}\n\nYour EventHub email change verification code is:\n\n${otp}\n\nThis code expires in 10 minutes. If you did not request this change, secure your account immediately.\n\nEventHub`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">Verify your new email</h1><p>${safeGreeting}</p><p>Your EventHub email change verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#2165a6">${escapeHtml(otp)}</p><p>This code expires in 10 minutes.</p><p>If you did not request this change, secure your account immediately.</p><p style="margin-top:28px;color:#758198">EventHub</p></div>`,
  };
}

export async function sendAdminEmailChangeOtpEmail(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport,
) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Email change verification is not configured.');

  const transporter = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
  });
  const result = await transporter.sendMail({
    ...buildAdminEmailChangeOtpMessage(message, environment),
    from: config.from,
  });
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the email verification message.');
}

export async function sendAdminEmailChangeNotice(
  message,
  environment = process.env,
  transportFactory = nodemailer.createTransport,
) {
  const config = getPasswordResetEmailConfig(environment);
  if (!config) throw new Error('Email change notifications are not configured.');

  const transporter = transportFactory({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
  });
  const result = await transporter.sendMail({
    from: config.from,
    to: message.email,
    subject: 'Your EventHub account email was changed',
    text: 'The email address for your EventHub account was changed. If you did not make this change, contact support and secure your account immediately.',
    html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#17233a"><h1 style="font-size:24px;color:#17466c">Account email changed</h1><p>The email address for your EventHub account was changed.</p><p>If you did not make this change, contact support and secure your account immediately.</p><p style="margin-top:28px;color:#758198">EventHub</p></div>',
  });
  const accepted = (result.accepted || []).some((address) => {
    const value = typeof address === 'string' ? address : address.address;
    return String(value || '').toLowerCase() === message.email.toLowerCase();
  });
  if (!accepted || result.rejected?.length) throw new Error('SMTP provider did not accept the email change notice.');
}
