import { z } from 'zod';
import { normalizeEmail } from './authFlow.js';

export const usernameSchema = z.string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(32, 'Username must be 32 characters or fewer.')
  .regex(/^[A-Za-z0-9_]+$/, 'Use only letters, numbers, and underscores in your username.')
  .transform((username) => username.toLowerCase());

export function normalizePhoneNumber(value) {
  const phone = String(value ?? '').trim();
  const compact = phone.replace(/[\s().-]/g, '');
  if (/^0[79]\d{8}$/.test(compact)) return `+251${compact.slice(1)}`;
  if (/^251[79]\d{8}$/.test(compact)) return `+${compact}`;
  return compact;
}

export const phoneSchema = z.string()
  .trim()
  .transform(normalizePhoneNumber)
  .optional();

export const emailSchema = z.string()
  .trim()
  .email('Enter a valid email address.')
  .max(254, 'Email address must be 254 characters or fewer.')
  .transform(normalizeEmail);

export const strongPasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .refine((password) => /[A-Z]/.test(password), {
    message: 'Password must include an uppercase letter.',
  })
  .refine((password) => /[a-z]/.test(password), {
    message: 'Password must include a lowercase letter.',
  })
  .refine((password) => /\d/.test(password), {
    message: 'Password must include a number.',
  })
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
    message: 'Password must use 72 UTF-8 bytes or fewer.',
  });

export const publicRegistrationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name using at least 2 characters.').max(160),
  username: usernameSchema.optional(),
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: strongPasswordSchema,
  role: z.enum(['customer', 'organizer', 'vendor']).optional(),
  termsAccepted: z.literal(true).optional(),
}).strict();

export function parseLoginIdentifier(value) {
  const identifier = String(value ?? '').trim();
  if (identifier.includes('@')) {
    const parsedEmail = emailSchema.safeParse(identifier);
    return parsedEmail.success ? parsedEmail.data : null;
  }
  const parsedUsername = usernameSchema.safeParse(identifier);
  return parsedUsername.success ? parsedUsername.data : null;
}
