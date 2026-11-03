import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isStrongPassword, normalizeEmail } from './authFlow.js';

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform(normalizeEmail),
  password: z.string().min(12).max(16).refine(isStrongPassword),
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
  return String(role || '').toLowerCase() === 'customer';
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}