import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isStrongPassword, normalizeEmail } from './authFlow.js';

const publicRoles = ['customer', 'organizer', 'vendor'];

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform(normalizeEmail),
  password: z.string().max(256).refine(isStrongPassword),
  role: z.enum(publicRoles).default('customer'),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(normalizeEmail),
  password: z.string().min(1).max(256),
}).strict();

export function parsePublicRegistration(value) {
  return registrationSchema.safeParse(value);
}

export function parsePublicLogin(value) {
  return loginSchema.safeParse(value);
}

export function isPublicRole(role) {
  return publicRoles.includes(String(role || '').toLowerCase());
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}