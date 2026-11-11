import { z } from 'zod';
import { getRequestId } from './requestContext.js';
import { sanitizeAuditDetails } from './auditSanitizer.js';

const webhookEventSchema = z.object({
  eventId: z.string().trim().min(1).max(190),
  type: z.enum(['payment.succeeded', 'payment.failed', 'payment.cancelled', 'refund.succeeded', 'refund.failed']),
  transactionReference: z.string().trim().min(1).max(190),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  refundIdempotencyKey: z.string().trim().min(1).max(120).optional(),
  refundReference: z.string().trim().min(1).max(190).optional(),
}).strict();

export function toCents(amount) {
  const value = String(amount ?? '').trim();
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

export function isSafePostgresFinancialNote(value) {
  const text = String(value ?? '');
  return !/\b(?:cvv|cvc|security code|card number|credit card|api key|secret key|private key|password|access token)\b/i.test(text)
    && !/(?:\d[ -]?){12,19}/.test(text);
}

function fromCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

async function appendHistory(transaction, {
  paymentId,
  refundId = null,
  actorId = null,
  action,
  fromStatus = null,
  toStatus = null,
  details = {},
}) {
  await transaction.query(
    `INSERT INTO payment_history
       (payment_id, refund_id, actor_id, action, from_status, to_status, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [paymentId, refundId, actorId, action, fromStatus, toStatus, JSON.stringify(details)],
  );
}

async function writePostgresAudit(transaction, {
  actorId,
  action,
  entityType,
  entityId,
  details,
  ip,
}) {
  await transaction.query(
    `INSERT INTO audit_logs
       (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [actorId, action, entityType, String(entityId), JSON.stringify(sanitizeAuditDetails(details)), ip || null, getRequestId()],
  );
}

async function availableRefundCents(transaction, paymentId, excludeRefundId = null) {
  const paymentResult = await transaction.query(
    'SELECT amount FROM payments WHERE id = $1 FOR UPDATE',
    [paymentId],
  );
  const payment = paymentResult.rows[0];
  if (!payment) throw httpError(404, 'Payment not found.');
  const excludeClause = excludeRefundId === null ? '' : ' AND id <> $2';
  const values = excludeRefundId === null ? [paymentId] : [paymentId, excludeRefundId];
  const totals = await transaction.query(
    `SELECT COALESCE(SUM(amount), 0) AS reserved
     FROM refund_requests
     WHERE payment_id = $1 AND status IN ('pending', 'processing', 'succeeded')${excludeClause}`,
    values,
  );
  const amountCents = toCents(payment.amount);
  const reservedCents = toCents(totals.rows[0]?.reserved);
  if (amountCents === null || reservedCents === null || reservedCents > amountCents) {
    throw httpError(409, 'Refund eligibility could not be verified.');
  }
  return { amountCents, reservedCents, remainingCents: amountCents - reservedCents };
}

function sameRefundRequest(existing, { paymentId, requesterId, requestedCents, reason }) {
  return Number(existing.payment_id) === Number(paymentId)
    && Number(existing.requester_id) === Number(requesterId)
    && toCents(existing.amount) === requestedCents
    && existing.reason === reason;
}

export async function createPostgresRefundRequest(database, {
  paymentId,
  requesterId,
  amount,
  reason,
  idempotencyKey,
  ip,
}) {
  const requestedCents = toCents(amount);
  if (requestedCents === null || requestedCents <= 0) {
    throw httpError(400, 'Refund amount must be a positive amount with at most two decimal places.');
  }
  if (!isSafePostgresFinancialNote(reason)) {
    throw httpError(400, 'Do not include card numbers, security codes, or payment credentials in the refund reason.');
  }

  try {
    return await database.inTransaction(async (transaction) => {
      const existingResult = await transaction.query(
        `SELECT id, payment_id, requester_id, amount, reason, status
         FROM refund_requests WHERE idempotency_key = $1 FOR UPDATE`,
        [idempotencyKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (!sameRefundRequest(existing, { paymentId, requesterId, requestedCents, reason })) {
          throw httpError(409, 'This idempotency key was already used for a different request.');
        }
        return { id: Number(existing.id), status: existing.status, duplicate: true };
      }

      const paymentResult = await transaction.query(
        `SELECT p.id, p.amount, p.currency, p.status, p.created_at, e.organizer_id AS customer_id
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         JOIN events e ON e.id = b.event_id
         WHERE p.id = $1 FOR UPDATE OF p`,
        [paymentId],
      );
      const payment = paymentResult.rows[0];
      if (!payment || Number(payment.customer_id) !== Number(requesterId)) {
        throw httpError(404, 'Payment not found.');
      }
      if (!['paid', 'partially_refunded'].includes(payment.status)) {
        throw httpError(409, 'Only verified successful payments are eligible for refunds.');
      }
      const windowResult = await transaction.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'refund_request_window_days'",
      );
      const refundWindowDays = windowResult.rows[0] ? Number(windowResult.rows[0].setting_value) : 30;
      if (!Number.isInteger(refundWindowDays) || refundWindowDays < 0 || refundWindowDays > 365) {
        throw httpError(503, 'The configured refund request window is invalid.');
      }
      if (refundWindowDays > 0) {
        const ageResult = await transaction.query(
          'SELECT $1::timestamptz < CURRENT_TIMESTAMP - ($2::integer * INTERVAL \'1 day\') AS outside_refund_window',
          [payment.created_at, refundWindowDays],
        );
        if (ageResult.rows[0]?.outside_refund_window) {
          throw httpError(409, 'This payment is outside the configured refund request window.');
        }
      }

      const { remainingCents } = await availableRefundCents(transaction, paymentId);
      if (requestedCents > remainingCents) {
        throw httpError(409, 'Refund amount exceeds the remaining eligible amount.');
      }
      const insert = await transaction.query(
        `INSERT INTO refund_requests
           (payment_id, requester_id, amount, currency, reason, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [paymentId, requesterId, fromCents(requestedCents), payment.currency || 'ETB', reason, idempotencyKey],
      );
      const refundId = insert.rows[0].id;
      await appendHistory(transaction, {
        paymentId,
        refundId,
        actorId: requesterId,
        action: 'refund.requested',
        toStatus: 'pending',
        details: { amount: fromCents(requestedCents), currency: payment.currency },
      });
      await writePostgresAudit(transaction, {
        actorId: requesterId,
        action: 'refund.requested',
        entityType: 'refund',
        entityId: refundId,
        details: { paymentId, amount: fromCents(requestedCents), currency: payment.currency },
        ip,
      });
      return { id: Number(refundId), status: 'pending', duplicate: false };
    });
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const existingResult = await database.query(
      `SELECT id, payment_id, requester_id, amount, reason, status
       FROM refund_requests WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (existing && sameRefundRequest(existing, { paymentId, requesterId, requestedCents, reason })) {
      return { id: Number(existing.id), status: existing.status, duplicate: true };
    }
    throw httpError(409, 'This idempotency key was already used for a different request.');
  }
}

async function finalizePostgresRefund(database, refundId, {
  actorId,
  ip,
  status,
  providerReference = null,
  reason = null,
}) {
  return database.inTransaction(async (transaction) => {
    const currentResult = await transaction.query(
      `SELECT r.id, r.payment_id, r.amount, r.currency, r.status, p.status AS payment_status,
              p.amount AS payment_amount
       FROM refund_requests r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1 FOR UPDATE OF r, p`,
      [refundId],
    );
    const current = currentResult.rows[0];
    if (!current || current.status !== 'processing') {
      throw httpError(409, 'Refund request is no longer processing.');
    }

    let paymentStatus = current.payment_status;
    if (status === 'succeeded') {
      const totals = await transaction.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests WHERE payment_id = $1 AND status = 'succeeded'`,
        [current.payment_id],
      );
      const refundedCents = toCents(totals.rows[0]?.refunded);
      const refundCents = toCents(current.amount);
      const paymentCents = toCents(current.payment_amount);
      if ([refundedCents, refundCents, paymentCents].includes(null)
        || refundedCents + refundCents > paymentCents) {
        throw httpError(409, 'Confirmed refund exceeds the payment remaining eligible amount.');
      }
      paymentStatus = refundedCents + refundCents === paymentCents ? 'refunded' : 'partially_refunded';
    } else if (current.payment_status === 'refund_pending') {
      const totals = await transaction.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests WHERE payment_id = $1 AND status = 'succeeded'`,
        [current.payment_id],
      );
      const refundedCents = toCents(totals.rows[0]?.refunded);
      if (refundedCents === null) throw httpError(409, 'Confirmed refund total could not be verified.');
      paymentStatus = refundedCents > 0 ? 'partially_refunded' : 'paid';
    }

    const updated = await transaction.query(
      `UPDATE refund_requests
       SET status = $1, provider_refund_reference = $2, decision_reason = COALESCE($3, decision_reason),
           processed_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND status = 'processing' RETURNING id`,
      [status, providerReference, reason, refundId],
    );
    if (!updated.rowCount) throw httpError(409, 'Refund request is no longer processing.');
    await appendHistory(transaction, {
      paymentId: current.payment_id,
      refundId,
      actorId,
      action: `refund.${status}`,
      fromStatus: 'processing',
      toStatus: status,
      details: { providerReference, reason },
    });

    if (status === 'succeeded' || current.payment_status === 'refund_pending') {
      await transaction.query('UPDATE payments SET status = $1 WHERE id = $2', [paymentStatus, current.payment_id]);
      await appendHistory(transaction, {
        paymentId: current.payment_id,
        refundId,
        actorId,
        action: status === 'succeeded' ? 'payment.refund_confirmed' : 'payment.refund_failed',
        fromStatus: current.payment_status,
        toStatus: paymentStatus,
        details: { refundId, providerReference, reason },
      });
    }

    if (actorId) {
      await writePostgresAudit(transaction, {
        actorId,
        action: `refund.${status}`,
        entityType: 'refund',
        entityId: refundId,
        details: { paymentId: current.payment_id, amount: current.amount, providerReference, reason },
        ip,
      });
    }
    return { id: Number(refundId), status, paymentStatus };
  });
}

export async function decidePostgresRefundRequest(database, {
  refundId,
  decision,
  reason = null,
  actorId,
  ip,
  paymentProvider,
}) {
  if (decision === 'rejected') {
    if (String(reason || '').trim().length < 5 || !isSafePostgresFinancialNote(reason)) {
      throw httpError(400, 'A rejection reason of at least five characters is required. Do not include card data or payment credentials.');
    }
    return database.inTransaction(async (transaction) => {
      const result = await transaction.query(
        'SELECT id, payment_id, status FROM refund_requests WHERE id = $1 FOR UPDATE',
        [refundId],
      );
      const refund = result.rows[0];
      if (!refund) throw httpError(404, 'Refund request not found.');
      if (refund.status !== 'pending') throw httpError(409, 'Only pending refund requests can be rejected.');
      await transaction.query(
        `UPDATE refund_requests SET status = 'rejected', decided_by = $1,
           decision_reason = $2, decided_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND status = 'pending'`,
        [actorId, reason, refundId],
      );
      await appendHistory(transaction, {
        paymentId: refund.payment_id,
        refundId,
        actorId,
        action: 'refund.rejected',
        fromStatus: 'pending',
        toStatus: 'rejected',
        details: { reason },
      });
      await writePostgresAudit(transaction, {
        actorId,
        action: 'refund.rejected',
        entityType: 'refund',
        entityId: refundId,
        details: { paymentId: refund.payment_id, from: refund.status, to: 'rejected', reason },
        ip,
      });
      return { id: Number(refundId), status: 'rejected' };
    });
  }

  if (typeof paymentProvider?.name !== 'string' || !paymentProvider.name.trim()
    || typeof paymentProvider.refundPayment !== 'function') {
    throw httpError(503, 'Refund processing is unavailable until a verified payment provider is configured. The request remains pending.');
  }

  const refund = await database.inTransaction(async (transaction) => {
    const result = await transaction.query(
      `SELECT r.id, r.payment_id, r.amount, r.currency, r.status, r.idempotency_key,
              p.provider, p.provider_reference, p.status AS payment_status
       FROM refund_requests r JOIN payments p ON p.id = r.payment_id
       WHERE r.id = $1 FOR UPDATE OF r, p`,
      [refundId],
    );
    const current = result.rows[0];
    if (!current) throw httpError(404, 'Refund request not found.');
    if (!['pending', 'processing'].includes(current.status)) {
      throw httpError(409, 'Only pending or processing refund requests can be approved.');
    }
    if (!['paid', 'partially_refunded', 'refund_pending'].includes(current.payment_status)) {
      throw httpError(409, 'The payment is not eligible for a refund.');
    }
    if (!current.provider || !current.provider_reference
      || current.provider.toLowerCase() !== paymentProvider.name.trim().toLowerCase()) {
      throw httpError(409, 'The payment provider or verified transaction reference does not match.');
    }
    if (current.status === 'pending') {
      const { remainingCents } = await availableRefundCents(transaction, current.payment_id, refundId);
      const amountCents = toCents(current.amount);
      if (amountCents === null || amountCents > remainingCents) {
        throw httpError(409, 'Refund amount exceeds the remaining eligible amount.');
      }
      await transaction.query(
        `UPDATE refund_requests SET status = 'processing', decided_by = $1,
           decided_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'pending'`,
        [actorId, refundId],
      );
      await appendHistory(transaction, {
        paymentId: current.payment_id,
        refundId,
        actorId,
        action: 'refund.approved',
        fromStatus: 'pending',
        toStatus: 'processing',
        details: { amount: current.amount, currency: current.currency },
      });
      await writePostgresAudit(transaction, {
        actorId,
        action: 'refund.approved',
        entityType: 'refund',
        entityId: refundId,
        details: {
          paymentId: current.payment_id,
          amount: current.amount,
          currency: current.currency,
          from: current.status,
          to: 'processing',
        },
        ip,
      });
    }
    return current;
  });

  let providerResult;
  try {
    providerResult = await paymentProvider.refundPayment({
      amount: String(refund.amount),
      currency: refund.currency,
      transactionReference: refund.provider_reference,
      idempotencyKey: refund.idempotency_key,
    });
  } catch {
    throw httpError(502, 'The provider could not confirm the refund. The request remains processing and must be reconciled before retrying.');
  }
  const parsedResult = z.object({
    status: z.enum(['succeeded', 'failed', 'pending']),
    refundReference: z.string().trim().min(1).max(190).optional(),
  }).strict().safeParse(providerResult);
  if (!parsedResult.success) throw httpError(502, 'The payment provider returned an invalid refund result. The request remains processing.');
  if (parsedResult.data.status === 'pending') return { id: Number(refundId), status: 'processing' };
  if (parsedResult.data.status === 'succeeded' && !parsedResult.data.refundReference) {
    throw httpError(502, 'The provider did not return a confirmed refund reference. The request remains processing.');
  }
  return finalizePostgresRefund(database, refundId, {
    actorId,
    ip,
    status: parsedResult.data.status,
    providerReference: parsedResult.data.refundReference || null,
  });
}

async function findPayment(transaction, providerName, transactionReference, paymentId) {
  const result = paymentId === undefined
    ? await transaction.query(
      `SELECT id, amount, currency, status FROM payments
       WHERE provider = $1 AND provider_reference = $2 FOR UPDATE`,
      [providerName, transactionReference],
    )
    : await transaction.query(
      `SELECT id, amount, currency, status FROM payments
       WHERE id = $1 AND provider = $2 AND provider_reference = $3 FOR UPDATE`,
      [paymentId, providerName, transactionReference],
    );
  return result.rows[0] || null;
}

export async function processVerifiedPostgresProviderEvent(database, provider, untrustedEvent) {
  if (typeof provider?.name !== 'string' || !provider.name.trim()
    || typeof provider.verifyWebhook !== 'function') {
    throw httpError(503, 'Payment provider integration is not configured.');
  }
  const event = webhookEventSchema.safeParse(untrustedEvent);
  if (!event.success) throw httpError(400, 'The verified provider event has an invalid format.');
  const normalized = event.data;
  const providerName = provider.name.trim();

  return database.inTransaction(async (transaction) => {
    const recordedEvent = await transaction.query(
      `INSERT INTO payment_provider_events (provider, event_id, event_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING event_id`,
      [providerName, normalized.eventId, normalized.type],
    );
    if (!recordedEvent.rowCount) return { duplicate: true, eventId: normalized.eventId };

    if (normalized.type.startsWith('payment.')) {
      const payment = await findPayment(transaction, providerName, normalized.transactionReference);
      if (!payment) throw httpError(404, 'No matching payment transaction was found.');
      const eventAmountCents = toCents(normalized.amount);
      const paymentAmountCents = toCents(payment.amount);
      if (eventAmountCents === null || paymentAmountCents === null
        || eventAmountCents !== paymentAmountCents
        || normalized.currency !== String(payment.currency).toUpperCase()) {
        throw httpError(409, 'Provider transaction details do not match the recorded payment.');
      }

      const nextStatus = {
        'payment.succeeded': 'paid',
        'payment.failed': 'failed',
        'payment.cancelled': 'cancelled',
      }[normalized.type];
      if (payment.status !== nextStatus && !['pending', 'authorized'].includes(payment.status)) {
        throw httpError(409, 'The payment is not in a state that can accept this provider update.');
      }
      if (payment.status !== nextStatus) {
        if (nextStatus === 'paid') {
          await transaction.query(
            'UPDATE payments SET status = $1, verified_at = CURRENT_TIMESTAMP WHERE id = $2',
            [nextStatus, payment.id],
          );
        } else {
          await transaction.query('UPDATE payments SET status = $1 WHERE id = $2', [nextStatus, payment.id]);
        }
        await appendHistory(transaction, {
          paymentId: payment.id,
          action: `payment.provider_${nextStatus}`,
          fromStatus: payment.status,
          toStatus: nextStatus,
          details: { provider: providerName, eventId: normalized.eventId },
        });
      }
      return { duplicate: false, eventId: normalized.eventId };
    }

    if (!normalized.refundIdempotencyKey) {
      throw httpError(400, 'The verified refund event is missing its idempotency reference.');
    }
    const refundResult = await transaction.query(
      `SELECT id, payment_id, amount, currency, status
       FROM refund_requests WHERE idempotency_key = $1 FOR UPDATE`,
      [normalized.refundIdempotencyKey],
    );
    const refund = refundResult.rows[0];
    if (!refund || refund.status !== 'processing') {
      throw httpError(409, 'No matching processing refund request was found.');
    }
    const payment = await findPayment(
      transaction,
      providerName,
      normalized.transactionReference,
      refund.payment_id,
    );
    if (!payment) throw httpError(404, 'No matching payment transaction was found.');

    const eventAmountCents = toCents(normalized.amount);
    const refundAmountCents = toCents(refund.amount);
    if (eventAmountCents === null || refundAmountCents === null
      || eventAmountCents !== refundAmountCents
      || normalized.currency !== String(payment.currency).toUpperCase()
      || normalized.currency !== String(refund.currency).toUpperCase()) {
      throw httpError(409, 'Provider refund details do not match the recorded request.');
    }
    const nextStatus = normalized.type === 'refund.succeeded' ? 'succeeded' : 'failed';
    if (nextStatus === 'succeeded' && !normalized.refundReference) {
      throw httpError(409, 'The confirmed provider refund is missing its reference.');
    }

    const updatedRefund = await transaction.query(
      `UPDATE refund_requests
       SET status = $1, provider_refund_reference = $2, processed_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'processing'
       RETURNING id`,
      [nextStatus, normalized.refundReference || null, refund.id],
    );
    if (!updatedRefund.rowCount) throw httpError(409, 'Refund request is no longer processing.');
    await appendHistory(transaction, {
      paymentId: payment.id,
      refundId: refund.id,
      action: `refund.provider_${nextStatus}`,
      fromStatus: 'processing',
      toStatus: nextStatus,
      details: {
        provider: providerName,
        eventId: normalized.eventId,
        providerReference: normalized.refundReference || null,
      },
    });

    if (nextStatus === 'succeeded') {
      const totals = await transaction.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests WHERE payment_id = $1 AND status = 'succeeded'`,
        [payment.id],
      );
      const refundedCents = toCents(totals.rows[0]?.refunded);
      const paymentAmountCents = toCents(payment.amount);
      if (refundedCents === null || paymentAmountCents === null || refundedCents > paymentAmountCents) {
        throw httpError(409, 'Confirmed refunds exceed the payment amount.');
      }
      const paymentStatus = refundedCents === paymentAmountCents ? 'refunded' : 'partially_refunded';
      await transaction.query('UPDATE payments SET status = $1 WHERE id = $2', [paymentStatus, payment.id]);
      await appendHistory(transaction, {
        paymentId: payment.id,
        refundId: refund.id,
        action: 'payment.refund_confirmed',
        fromStatus: payment.status,
        toStatus: paymentStatus,
        details: { provider: providerName, eventId: normalized.eventId },
      });
      return { duplicate: false, eventId: normalized.eventId };
    }

    if (payment.status === 'refund_pending') {
      const totals = await transaction.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests WHERE payment_id = $1 AND status = 'succeeded'`,
        [payment.id],
      );
      const refundedCents = toCents(totals.rows[0]?.refunded);
      if (refundedCents === null) throw httpError(409, 'Confirmed refund total could not be verified.');
      const restoredStatus = refundedCents > 0 ? 'partially_refunded' : 'paid';
      await transaction.query('UPDATE payments SET status = $1 WHERE id = $2', [restoredStatus, payment.id]);
      await appendHistory(transaction, {
        paymentId: payment.id,
        refundId: refund.id,
        action: 'payment.refund_failed',
        fromStatus: payment.status,
        toStatus: restoredStatus,
        details: { provider: providerName, eventId: normalized.eventId },
      });
    }
    return { duplicate: false, eventId: normalized.eventId };
  });
}