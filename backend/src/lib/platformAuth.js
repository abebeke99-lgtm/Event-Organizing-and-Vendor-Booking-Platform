import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { parseLoginIdentifier, publicRegistrationSchema } from './accountValidation.js';

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254).transform((value) => parseLoginIdentifier(value)),
  password: z.string().min(1).max(256),
}).strict().refine((value) => Boolean(value.email), {
  path: ['email'],
  message: 'Enter a valid username or email address.',
});

export function parsePublicRegistration(value) {
  return publicRegistrationSchema.safeParse(value);
}

export function parsePublicLogin(value) {
  return loginSchema.safeParse(value);
}

export function isPublicRole(role) {
  return ['customer', 'organizer', 'vendor'].includes(String(role || '').trim().toLowerCase());
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}