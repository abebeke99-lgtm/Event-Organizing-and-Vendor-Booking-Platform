import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');

export async function writeAudit(executor, { actorId, action, entityType, entityId = null, details = {}, ip }) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [actorId, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(details), ip || null]
  );
}

export async function createSession(userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await pool.execute('INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}

export async function createUserSession(executor, userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await executor.execute('INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}
