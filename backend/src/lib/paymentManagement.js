import { z } from 'zod';
import { writeAudit } from './security.js';

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

export function isSafeFinancialNote(value) {
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

async function transaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function appendHistory(executor, {
  paymentId,
  refundId = null,
  actorId = null,
  action,
  fromStatus = null,
  toStatus = null,
  details = {},
}) {
  await executor.execute(
    `INSERT INTO payment_history
       (payment_id, refund_id, actor_id, action, from_status, to_status, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [paymentId, refundId, actorId, action, fromStatus, toStatus, JSON.stringify(details)],
  );
}

async function availableRefundCents(executor, paymentId, excludeRefundId = null) {
  const [[payment]] = await executor.execute(
    'SELECT amount FROM payments WHERE id = ? FOR UPDATE',
    [paymentId],
  );
  if (!payment) throw httpError(404, 'Payment not found.');
  const excludeClause = excludeRefundId === null ? '' : ' AND id <> ?';
  const totalsValues = excludeRefundId === null ? [paymentId] : [paymentId, excludeRefundId];
  const [[totals]] = await executor.execute(
    `SELECT COALESCE(SUM(amount), 0) AS reserved
     FROM refund_requests
     WHERE payment_id = ? AND status IN ('pending', 'processing', 'succeeded')${excludeClause}`,
    totalsValues,
  );
  const amountCents = toCents(payment.amount);
  const reservedCents = toCents(totals.reserved);
  if (amountCents === null || reservedCents === null || reservedCents > amountCents) {
    throw httpError(409, 'Refund eligibility could not be verified.');
  }
  return { payment, amountCents, reservedCents, remainingCents: amountCents - reservedCents };
}

export async function createRefundRequest(database, {
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
  if (!isSafeFinancialNote(reason)) {
    throw httpError(400, 'Do not include card numbers, security codes, or payment credentials in the refund reason.');
  }

  try {
    return await transaction(database, async (connection) => {
    const [[existing]] = await connection.execute(
      'SELECT id, payment_id, requester_id, amount, reason, status FROM refund_requests WHERE idempotency_key = ? FOR UPDATE',
      [idempotencyKey],
    );
    if (existing) {
      if (Number(existing.payment_id) !== Number(paymentId)
        || Number(existing.requester_id) !== Number(requesterId)
        || toCents(existing.amount) !== requestedCents
        || existing.reason !== reason) {
        throw httpError(409, 'This idempotency key was already used for a different request.');
      }
      return { id: Number(existing.id), status: existing.status, duplicate: true };
    }

    const [[payment]] = await connection.execute(
      `SELECT p.id, p.amount, p.currency, p.status, p.created_at, e.organizer_id AS customer_id
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN events e ON e.id = b.event_id
       WHERE p.id = ? FOR UPDATE`,
      [paymentId],
    );
    if (!payment) throw httpError(404, 'Payment not found.');
    if (Number(payment.customer_id) !== Number(requesterId)) throw httpError(404, 'Payment not found.');
    if (!['paid', 'partially_refunded'].includes(payment.status)) {
      throw httpError(409, 'Only verified successful payments are eligible for refunds.');
    }
    const [windowRows] = await connection.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'refund_request_window_days'",
    );
    const refundWindowDays = windowRows[0] ? Number(windowRows[0].setting_value) : 30;
    if (!Number.isInteger(refundWindowDays) || refundWindowDays < 0 || refundWindowDays > 365) {
      throw httpError(503, 'The configured refund request window is invalid.');
    }
    if (refundWindowDays > 0) {
      const [ageRows] = await connection.execute(
        'SELECT ? < DATE_SUB(NOW(), INTERVAL ? DAY) AS outside_refund_window',
        [payment.created_at, refundWindowDays],
      );
      if (ageRows[0]?.outside_refund_window) {
        throw httpError(409, 'This payment is outside the configured refund request window.');
      }
    }

    const { remainingCents } = await availableRefundCents(connection, paymentId);
    if (requestedCents > remainingCents) {
      throw httpError(409, 'Refund amount exceeds the remaining eligible amount.');
    }

    const [result] = await connection.execute(
      `INSERT INTO refund_requests
         (payment_id, requester_id, amount, currency, reason, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [paymentId, requesterId, fromCents(requestedCents), payment.currency || 'ETB', reason, idempotencyKey],
    );
    await appendHistory(connection, {
      paymentId,
      refundId: result.insertId,
      actorId: requesterId,
      action: 'refund.requested',
      toStatus: 'pending',
      details: { amount: fromCents(requestedCents), currency: payment.currency },
    });
    await writeAudit(connection, {
      actorId: requesterId,
      action: 'refund.requested',
      entityType: 'refund',
      entityId: result.insertId,
      details: { paymentId, amount: fromCents(requestedCents), currency: payment.currency },
      ip,
    });
    return { id: Number(result.insertId), status: 'pending', duplicate: false };
    });
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const [rows] = await database.execute(
      'SELECT id, payment_id, requester_id, amount, reason, status FROM refund_requests WHERE idempotency_key = ?',
      [idempotencyKey],
    );
    const existing = rows[0];
    if (existing
      && Number(existing.payment_id) === Number(paymentId)
      && Number(existing.requester_id) === Number(requesterId)
      && toCents(existing.amount) === requestedCents
      && existing.reason === reason) {
      return { id: Number(existing.id), status: existing.status, duplicate: true };
    }
    throw httpError(409, 'This idempotency key was already used for a different request.');
  }
}

async function finalizeRefund(database, refund, { actorId, ip, status, providerReference = null, reason = null }) {
  return transaction(database, async (connection) => {
    const [[current]] = await connection.execute(
      `SELECT r.id, r.payment_id, r.amount, r.currency, r.status, p.status AS payment_status,
              p.amount AS payment_amount
       FROM refund_requests r
       JOIN payments p ON p.id = r.payment_id
       WHERE r.id = ? FOR UPDATE`,
      [refund.id],
    );
    if (!current || current.status !== 'processing') {
      throw httpError(409, 'Refund request is no longer processing.');
    }

    let paymentStatus = current.payment_status;
    if (status === 'succeeded') {
      const [[totals]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests
         WHERE payment_id = ? AND status = 'succeeded'`,
        [current.payment_id],
      );
      const refundedCents = toCents(totals.refunded);
      const refundCents = toCents(current.amount);
      const paymentCents = toCents(current.payment_amount);
      if ([refundedCents, refundCents, paymentCents].includes(null) || refundedCents + refundCents > paymentCents) {
        throw httpError(409, 'Confirmed refund exceeds the payment remaining eligible amount.');
      }
      paymentStatus = refundedCents + refundCents === paymentCents ? 'refunded' : 'partially_refunded';
    } else if (current.payment_status === 'refund_pending') {
      const [[totals]] = await connection.execute(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM refund_requests
         WHERE payment_id = ? AND status = 'succeeded'`,
        [current.payment_id],
      );
      paymentStatus = toCents(totals.refunded) > 0 ? 'partially_refunded' : 'paid';
    }

    await connection.execute(
      `UPDATE refund_requests
       SET status = ?, provider_refund_reference = ?, decision_reason = COALESCE(?, decision_reason),
           processed_at = NOW()
       WHERE id = ? AND status = 'processing'`,
      [status, providerReference, reason, refund.id],
    );
    await appendHistory(connection, {
      paymentId: current.payment_id,
      refundId: refund.id,
      actorId,
      action: `refund.${status}`,
      fromStatus: 'processing',
      toStatus: status,
      details: { providerReference, reason },
    });

    if (status === 'succeeded') {
      await connection.execute(
        'UPDATE payments SET status = ? WHERE id = ?',
        [paymentStatus, current.payment_id],
      );
      await appendHistory(connection, {
        paymentId: current.payment_id,
        refundId: refund.id,
        actorId,
        action: 'payment.refund_confirmed',
        fromStatus: current.payment_status,
        toStatus: paymentStatus,
        details: { refundId: refund.id, providerReference },
      });
    } else if (current.payment_status === 'refund_pending') {
      await connection.execute(
        'UPDATE payments SET status = ? WHERE id = ?',
        [paymentStatus, current.payment_id],
      );
      await appendHistory(connection, {
        paymentId: current.payment_id,
        refundId: refund.id,
        actorId,
        action: 'payment.refund_failed',
        fromStatus: current.payment_status,
        toStatus: paymentStatus,
        details: { refundId: refund.id, providerReference },
      });
    }

    if (actorId) {
      await writeAudit(connection, {
        actorId,
        action: `refund.${status}`,
        entityType: 'refund',
        entityId: refund.id,
        details: { paymentId: current.payment_id, amount: current.amount, providerReference, reason },
        ip,
      });
    }
    return { id: Number(refund.id), status, paymentStatus };
  });
}

export async function decideRefundRequest(database, {
  refundId,
  decision,
  reason = null,
  actorId,
  ip,
  paymentProvider,
}) {
  if (decision === 'rejected') {
    if (String(reason || '').trim().length < 5 || !isSafeFinancialNote(reason)) {
      throw httpError(400, 'A rejection reason of at least five characters is required. Do not include card data or payment credentials.');
    }
    return transaction(database, async (connection) => {
      const [[refund]] = await connection.execute(
        'SELECT id, payment_id, status FROM refund_requests WHERE id = ? FOR UPDATE',
        [refundId],
      );
      if (!refund) throw httpError(404, 'Refund request not found.');
      if (refund.status !== 'pending') throw httpError(409, 'Only pending refund requests can be rejected.');
      await connection.execute(
        `UPDATE refund_requests
         SET status = 'rejected', decided_by = ?, decision_reason = ?, decided_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [actorId, reason, refundId],
      );
      await appendHistory(connection, {
        paymentId: refund.payment_id,
        refundId,
        actorId,
        action: 'refund.rejected',
        fromStatus: 'pending',
        toStatus: 'rejected',
        details: { reason },
      });
      await writeAudit(connection, {
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

  const refund = await transaction(database, async (connection) => {
    const [[current]] = await connection.execute(
      `SELECT r.id, r.payment_id, r.amount, r.currency, r.status, r.idempotency_key,
              p.provider, p.provider_reference, p.status AS payment_status
       FROM refund_requests r
       JOIN payments p ON p.id = r.payment_id
       WHERE r.id = ? FOR UPDATE`,
      [refundId],
    );
    if (!current) throw httpError(404, 'Refund request not found.');
    if (current.status !== 'pending' && current.status !== 'processing') {
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
      const { remainingCents } = await availableRefundCents(connection, current.payment_id, refundId);
      const amountCents = toCents(current.amount);
      if (amountCents === null || amountCents > remainingCents) {
        throw httpError(409, 'Refund amount exceeds the remaining eligible amount.');
      }
      await connection.execute(
        `UPDATE refund_requests SET status = 'processing', decided_by = ?, decided_at = NOW()
         WHERE id = ? AND status = 'pending'`,
        [actorId, refundId],
      );
      await appendHistory(connection, {
        paymentId: current.payment_id,
        refundId,
        actorId,
        action: 'refund.approved',
        fromStatus: 'pending',
        toStatus: 'processing',
        details: { amount: current.amount, currency: current.currency },
      });
      await writeAudit(connection, {
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

  const result = z.object({
    status: z.enum(['succeeded', 'failed', 'pending']),
    refundReference: z.string().trim().min(1).max(190).optional(),
  }).strict().safeParse(providerResult);
  if (!result.success) throw httpError(502, 'The payment provider returned an invalid refund result. The request remains processing.');
  if (result.data.status === 'pending') {
    return { id: Number(refundId), status: 'processing' };
  }
  if (result.data.status === 'succeeded' && !result.data.refundReference) {
    throw httpError(502, 'The provider did not return a confirmed refund reference. The request remains processing.');
  }
  return finalizeRefund(database, refund, {
    actorId,
    ip,
    status: result.data.status,
    providerReference: result.data.refundReference || null,
  });
}

export async function processVerifiedProviderEvent(database, provider, untrustedEvent) {
  if (typeof provider?.name !== 'string' || !provider.name.trim()
    || typeof provider.verifyWebhook !== 'function') {
    throw httpError(503, 'Payment provider integration is not configured.');
  }
  const event = webhookEventSchema.safeParse(untrustedEvent);
  if (!event.success) throw httpError(400, 'The verified provider event has an invalid format.');
  const normalized = event.data;

  return transaction(database, async (connection) => {
    const [[payment]] = await connection.execute(
      `SELECT id, amount, currency, status FROM payments
       WHERE provider = ? AND provider_reference = ? FOR UPDATE`,
      [provider.name.trim(), normalized.transactionReference],
    );
    if (!payment) throw httpError(404, 'No matching payment transaction was found.');
    const eventAmountCents = toCents(normalized.amount);
    const paymentAmountCents = toCents(payment.amount);
    if (eventAmountCents === null || paymentAmountCents === null
      || normalized.currency !== String(payment.currency).toUpperCase()) {
      throw httpError(409, 'Provider transaction details do not match the recorded payment.');
    }

    await connection.execute(
      'INSERT INTO payment_provider_events (provider, event_id, event_type) VALUES (?, ?, ?)',
      [provider.name.trim(), normalized.eventId, normalized.type],
    );

    if (normalized.type.startsWith('payment.')) {
      if (eventAmountCents !== paymentAmountCents) {
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
      if (payment.status !== nextStatus && nextStatus === 'paid') {
        await connection.execute(
          "UPDATE payments SET status = 'paid', verified_at = NOW() WHERE id = ?",
          [payment.id],
        );
      } else if (payment.status !== nextStatus) {
        await connection.execute('UPDATE payments SET status = ? WHERE id = ?', [nextStatus, payment.id]);
      }
      if (payment.status !== nextStatus) {
        await appendHistory(connection, {
          paymentId: payment.id,
          action: `payment.provider_${nextStatus}`,
          fromStatus: payment.status,
          toStatus: nextStatus,
          details: { provider: provider.name, eventId: normalized.eventId },
        });
      }
    } else {
      if (!normalized.refundIdempotencyKey) {
        throw httpError(400, 'The verified refund event is missing its idempotency reference.');
      }
      const [[refund]] = await connection.execute(
        `SELECT id, payment_id, amount, currency, status
         FROM refund_requests WHERE idempotency_key = ? FOR UPDATE`,
        [normalized.refundIdempotencyKey],
      );
      if (!refund || Number(refund.payment_id) !== Number(payment.id) || refund.status !== 'processing') {
        throw httpError(409, 'No matching processing refund request was found.');
      }
      if (toCents(refund.amount) !== eventAmountCents || refund.currency !== normalized.currency) {
        throw httpError(409, 'Provider refund details do not match the recorded request.');
      }
      const nextStatus = normalized.type === 'refund.succeeded' ? 'succeeded' : 'failed';
      if (nextStatus === 'succeeded' && !normalized.refundReference) {
        throw httpError(409, 'The confirmed provider refund is missing its reference.');
      }
      await connection.execute(
        `UPDATE refund_requests SET status = ?, provider_refund_reference = ?, processed_at = NOW()
         WHERE id = ? AND status = 'processing'`,
        [nextStatus, normalized.refundReference || null, refund.id],
      );
      await appendHistory(connection, {
        paymentId: payment.id,
        refundId: refund.id,
        action: `refund.provider_${nextStatus}`,
        fromStatus: 'processing',
        toStatus: nextStatus,
        details: { provider: provider.name, eventId: normalized.eventId, providerReference: normalized.refundReference || null },
      });
      if (nextStatus === 'succeeded') {
        const [[totals]] = await connection.execute(
          `SELECT COALESCE(SUM(amount), 0) AS refunded
           FROM refund_requests WHERE payment_id = ? AND status = 'succeeded'`,
          [payment.id],
        );
        const refundedCents = toCents(totals.refunded);
        if (refundedCents === null || refundedCents > paymentAmountCents) {
          throw httpError(409, 'Confirmed refunds exceed the payment amount.');
        }
        const paymentStatus = refundedCents === paymentAmountCents ? 'refunded' : 'partially_refunded';
        await connection.execute('UPDATE payments SET status = ? WHERE id = ?', [paymentStatus, payment.id]);
        await appendHistory(connection, {
          paymentId: payment.id,
          refundId: refund.id,
          action: 'payment.refund_confirmed',
          fromStatus: payment.status,
          toStatus: paymentStatus,
          details: { provider: provider.name, eventId: normalized.eventId },
        });
      } else if (payment.status === 'refund_pending') {
        const [[totals]] = await connection.execute(
          `SELECT COALESCE(SUM(amount), 0) AS refunded
           FROM refund_requests WHERE payment_id = ? AND status = 'succeeded'`,
          [payment.id],
        );
        const refundedCents = toCents(totals.refunded);
        if (refundedCents === null) throw httpError(409, 'Confirmed refund total could not be verified.');
        const restoredStatus = refundedCents > 0 ? 'partially_refunded' : 'paid';
        await connection.execute('UPDATE payments SET status = ? WHERE id = ?', [restoredStatus, payment.id]);
        await appendHistory(connection, {
          paymentId: payment.id,
          refundId: refund.id,
          action: 'payment.refund_failed',
          fromStatus: payment.status,
          toStatus: restoredStatus,
          details: { provider: provider.name, eventId: normalized.eventId },
        });
      }
    }
    return { duplicate: false, eventId: normalized.eventId };
  }).catch((error) => {
    if (error?.code === 'ER_DUP_ENTRY') return { duplicate: true, eventId: normalized.eventId };
    throw error;
  });
}
