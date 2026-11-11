import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { getRequestId } from './requestContext.js';
import { sanitizeAuditDetails } from './auditSanitizer.js';

export { sanitizeAuditDetails } from './auditSanitizer.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newSessionToken = () => randomBytes(32).toString('base64url');

export function auditSeverityForAction(action) {
  if (/system\.|settings\.|permission|payment|refund|role\.|user\.(?:status_changed|role_changed)/i.test(action)) return 'critical';
  if (/vendor\.|event\.(?:approve|reject|cancel|unpublish)|booking\.(?:status_changed|moderated|rescheduled)|cancel|reject|moderation|reschedul|suspend/i.test(action)) return 'warning';
  return 'info';
}

export async function writeAudit(executor, {
  actorId,
  action,
  entityType,
  entityId = null,
  details = {},
  ip,
  outcome = 'success',
  severity = auditSeverityForAction(action),
}) {
  if (!['success', 'failure'].includes(outcome)) throw new TypeError('Audit outcome is invalid.');
  if (!['info', 'warning', 'critical'].includes(severity)) throw new TypeError('Audit severity is invalid.');
  const safeDetails = JSON.stringify(sanitizeAuditDetails(details));
  if (Buffer.byteLength(safeDetails, 'utf8') > 16384) {
    throw new Error('Audit details exceed the supported size.');
  }
  await executor.execute(
    `INSERT INTO audit_logs
      (actor_id, action, entity_type, entity_id, details, ip_address, request_id, outcome, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorId,
      action,
      entityType,
      entityId === null ? null : String(entityId),
      safeDetails,
      ip || null,
      getRequestId(),
      outcome,
      severity,
    ],
  );
}

export async function createSession(userId, executor = pool) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await executor.execute('INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}

export async function createUserSession(executor, userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await executor.execute('INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expiresAt]);
  return { token, expiresAt };
}
