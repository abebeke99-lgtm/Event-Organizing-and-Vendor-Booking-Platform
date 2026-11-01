import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  createRefundRequest,
  decideRefundRequest,
  processVerifiedProviderEvent,
  toCents,
} from '../src/lib/paymentManagement.js';

function createPaymentDatabase({
  status = 'paid',
  amount = '100.00',
  failAudit = false,
  refundWindowDays = null,
  outsideRefundWindow = false,
} = {}) {
  const state = {
    payment: {
      id: 8,
      booking_id: 15,
      amount,
      currency: 'ETB',
      created_at: '2025-01-01 10:00:00',
      status,
      provider: 'testpay',
      provider_reference: 'charge-8',
      verified_at: null,
      customer_id: 21,
    },
    refunds: new Map(),
    history: [],
    audits: [],
    providerEvents: new Map(),
    nextRefundId: 1,
    rollbacks: 0,
  };

  async function execute(sql, values = []) {
    const statement = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (statement.startsWith('select id, payment_id, requester_id, amount, reason, status from refund_requests')) {
      const row = [...state.refunds.values()].find((refund) => refund.idempotency_key === values[0]);
      return [[row ? { ...row } : undefined].filter(Boolean), []];
    }
    if (statement.startsWith('select p.id, p.amount, p.currency, p.status, p.created_at, e.organizer_id')) {
      return [[{ ...state.payment }], []];
    }
    if (statement.startsWith('select setting_value from system_settings')) {
      return [[refundWindowDays === null ? undefined : { setting_value: String(refundWindowDays) }].filter(Boolean), []];
    }
    if (statement.startsWith('select ? < date_sub(now(), interval ? day)')) {
      return [[{ outside_refund_window: outsideRefundWindow ? 1 : 0 }], []];
    }
    if (statement.startsWith('select amount from payments where id')) {
      return [[{ amount: state.payment.amount }], []];
    }
    if (statement.startsWith('select coalesce(sum(amount), 0) as reserved')) {
      const excludedId = values.length > 1 ? Number(values[1]) : null;
      const reserved = [...state.refunds.values()]
        .filter((refund) => Number(refund.payment_id) === Number(values[0])
          && ['pending', 'processing', 'succeeded'].includes(refund.status)
          && refund.id !== excludedId)
        .reduce((total, refund) => total + toCents(refund.amount), 0);
      return [[{ reserved: `${Math.floor(reserved / 100)}.${String(reserved % 100).padStart(2, '0')}` }], []];
    }
    if (statement.startsWith('insert into refund_requests')) {
      const [paymentId, requesterId, refundAmount, currency, reason, idempotencyKey] = values;
      if ([...state.refunds.values()].some((refund) => refund.idempotency_key === idempotencyKey)) {
        throw Object.assign(new Error('Duplicate idempotency key.'), { code: 'ER_DUP_ENTRY' });
      }
      const insertId = state.nextRefundId++;
      state.refunds.set(insertId, {
        id: insertId,
        payment_id: paymentId,
        requester_id: requesterId,
        amount: refundAmount,
        currency,
        reason,
        status: 'pending',
        idempotency_key: idempotencyKey,
        provider: state.payment.provider,
        provider_reference: state.payment.provider_reference,
        payment_status: state.payment.status,
      });
      return [{ insertId, affectedRows: 1 }, []];
    }
    if (statement.startsWith('select r.id, r.payment_id, r.amount, r.currency, r.status, r.idempotency_key')) {
      const refund = state.refunds.get(Number(values[0]));
      return [[refund ? { ...refund, provider: state.payment.provider, provider_reference: state.payment.provider_reference, payment_status: state.payment.status } : undefined].filter(Boolean), []];
    }
    if (statement.startsWith('select r.id, r.payment_id, r.amount, r.currency, r.status, p.status as payment_status')) {
      const refund = state.refunds.get(Number(values[0]));
      return [[refund ? { ...refund, payment_status: state.payment.status, payment_amount: state.payment.amount } : undefined].filter(Boolean), []];
    }
    if (statement.startsWith('select id, payment_id, status from refund_requests')) {
      const refund = state.refunds.get(Number(values[0]));
      return [[refund ? { ...refund } : undefined].filter(Boolean), []];
    }
    if (statement.startsWith('select id, payment_id, amount, currency, status from refund_requests')) {
      const refund = [...state.refunds.values()].find((item) => item.idempotency_key === values[0]);
      return [[refund ? { ...refund } : undefined].filter(Boolean), []];
    }
    if (statement.startsWith('select coalesce(sum(amount), 0) as refunded')) {
      const refunded = [...state.refunds.values()]
        .filter((refund) => Number(refund.payment_id) === Number(values[0]) && refund.status === 'succeeded')
        .reduce((total, refund) => total + toCents(refund.amount), 0);
      return [[{ refunded: `${Math.floor(refunded / 100)}.${String(refunded % 100).padStart(2, '0')}` }], []];
    }
    if (statement.startsWith('select id, amount, currency, status from payments')) {
      const matches = state.payment.provider === values[0] && state.payment.provider_reference === values[1];
      return [matches ? [{ ...state.payment }] : [], []];
    }
    if (statement.startsWith('insert into payment_provider_events')) {
      const key = `${values[0]}:${values[1]}`;
      if (state.providerEvents.has(key)) {
        throw Object.assign(new Error('Duplicate provider event.'), { code: 'ER_DUP_ENTRY' });
      }
      state.providerEvents.set(key, { provider: values[0], eventId: values[1], type: values[2] });
      return [{ insertId: state.providerEvents.size, affectedRows: 1 }, []];
    }
    if (statement.startsWith('insert into payment_history')) {
      state.history.push({ payment_id: values[0], refund_id: values[1], actor_id: values[2], action: values[3], from_status: values[4], to_status: values[5] });
      return [{ insertId: state.history.length, affectedRows: 1 }, []];
    }
    if (statement.startsWith('insert into audit_logs')) {
      if (failAudit) throw new Error('Audit storage unavailable.');
      state.audits.push(values);
      return [{ insertId: state.audits.length, affectedRows: 1 }, []];
    }
    if (statement.startsWith("update refund_requests set status = 'processing'")) {
      const refund = state.refunds.get(Number(values[1]));
      if (refund) {
        refund.status = 'processing';
        refund.decided_by = values[0];
      }
      return [{ affectedRows: refund ? 1 : 0 }, []];
    }
    if (statement.startsWith("update refund_requests set status = 'rejected'")) {
      const refund = state.refunds.get(Number(values[2]));
      if (refund) {
        refund.status = 'rejected';
        refund.decided_by = values[0];
        refund.decision_reason = values[1];
      }
      return [{ affectedRows: refund ? 1 : 0 }, []];
    }
    if (statement.startsWith('update refund_requests set status = ?, provider_refund_reference')) {
      const refund = state.refunds.get(Number(values[3]));
      if (refund) {
        refund.status = values[0];
        refund.provider_refund_reference = values[1];
      }
      return [{ affectedRows: refund ? 1 : 0 }, []];
    }
    if (statement.startsWith('update refund_requests set status = ?, provider_refund_reference = ?, processed_at')) {
      const refund = state.refunds.get(Number(values[2]));
      if (refund) {
        refund.status = values[0];
        refund.provider_refund_reference = values[1];
      }
      return [{ affectedRows: refund ? 1 : 0 }, []];
    }
    if (statement.startsWith("update payments set status = 'paid', verified_at")) {
      state.payment.status = 'paid';
      state.payment.verified_at = 'verified';
      return [{ affectedRows: 1 }, []];
    }
    if (statement.startsWith('update payments set status = ?')) {
      state.payment.status = values[0];
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL in payment test: ${statement}`);
  }

  return {
    state,
    async execute(...args) { return execute(...args); },
    async getConnection() {
      let snapshot;
      return {
        execute,
        async beginTransaction() {
          snapshot = {
            payment: structuredClone(state.payment),
            refunds: structuredClone(state.refunds),
            history: structuredClone(state.history),
            audits: structuredClone(state.audits),
            providerEvents: structuredClone(state.providerEvents),
          };
        },
        async commit() {},
        async rollback() {
          state.payment = snapshot.payment;
          state.refunds = snapshot.refunds;
          state.history = snapshot.history;
          state.audits = snapshot.audits;
          state.providerEvents = snapshot.providerEvents;
          state.rollbacks += 1;
        },
        release() {},
      };
    },
  };
}

test('payment verification requires matching provider reference, amount, and currency and is idempotent', async () => {
  const database = createPaymentDatabase({ status: 'pending' });
  const provider = { name: 'testpay', async verifyWebhook() {} };
  const event = {
    eventId: 'evt-1',
    type: 'payment.succeeded',
    transactionReference: 'charge-8',
    amount: '100.00',
    currency: 'ETB',
  };

  await assert.rejects(
    processVerifiedProviderEvent(database, provider, { ...event, transactionReference: 'wrong-reference' }),
    { status: 404 },
  );
  assert.equal(database.state.payment.status, 'pending');
  await assert.rejects(
    processVerifiedProviderEvent(database, provider, { ...event, amount: '99.99' }),
    { status: 409 },
  );
  assert.equal(database.state.payment.status, 'pending');

  assert.deepEqual(await processVerifiedProviderEvent(database, provider, event), { duplicate: false, eventId: 'evt-1' });
  assert.equal(database.state.payment.status, 'paid');
  assert.equal(database.state.payment.verified_at, 'verified');
  assert.deepEqual(await processVerifiedProviderEvent(database, provider, event), { duplicate: true, eventId: 'evt-1' });

  const failedDatabase = createPaymentDatabase({ status: 'pending' });
  await processVerifiedProviderEvent(failedDatabase, provider, {
    ...event,
    eventId: 'evt-failed',
    type: 'payment.failed',
  });
  assert.equal(failedDatabase.state.payment.status, 'failed');
  await assert.rejects(createRefundRequest(failedDatabase, {
    paymentId: 8,
    requesterId: 21,
    amount: '10.00',
    reason: 'Failed payment',
    idempotencyKey: 'refund-for-failed-payment',
  }), { status: 409 });
});

test('refund limits reserve pending requests and idempotency keys cannot change request contents', async () => {
  const database = createPaymentDatabase();
  const base = {
    paymentId: 8,
    requesterId: 21,
    amount: '40.00',
    reason: 'Event cancelled',
    idempotencyKey: 'refund-request-1',
  };

  const created = await createRefundRequest(database, base);
  assert.equal(created.status, 'pending');
  assert.equal((await createRefundRequest(database, base)).duplicate, true);
  await assert.rejects(
    createRefundRequest(database, { ...base, amount: '39.00' }),
    { status: 409 },
  );
  await assert.rejects(
    createRefundRequest(database, { ...base, amount: '60.01', idempotencyKey: 'refund-request-2' }),
    { status: 409 },
  );
  await assert.rejects(
    createRefundRequest(database, {
      ...base,
      reason: 'Card 4111 1111 1111 1111',
      idempotencyKey: 'refund-request-card-data',
    }),
    { status: 400 },
  );
  assert.equal(database.state.refunds.size, 1);
});

test('refund request window is enforced and zero disables the deadline', async () => {
  const restrictedDatabase = createPaymentDatabase({ outsideRefundWindow: true });
  await assert.rejects(createRefundRequest(restrictedDatabase, {
    paymentId: 8,
    requesterId: 21,
    amount: '10.00',
    reason: 'Event cancelled',
    idempotencyKey: 'refund-outside-window',
  }), { status: 409 });
  assert.equal(restrictedDatabase.state.refunds.size, 0);

  const unlimitedDatabase = createPaymentDatabase({ refundWindowDays: 0, outsideRefundWindow: true });
  const refund = await createRefundRequest(unlimitedDatabase, {
    paymentId: 8,
    requesterId: 21,
    amount: '10.00',
    reason: 'Event cancelled',
    idempotencyKey: 'refund-no-window-limit',
  });
  assert.equal(refund.status, 'pending');
});

test('partial and full refunds require provider confirmation and failed provider responses do not mark payments refunded', async () => {
  const database = createPaymentDatabase();
  const request = async (id, amount) => createRefundRequest(database, {
    paymentId: 8,
    requesterId: 21,
    amount,
    reason: 'Event cancelled',
    idempotencyKey: `refund-request-${id}`,
  });

  const failed = await request(1, '25.00');
  const failedResult = await decideRefundRequest(database, {
    refundId: failed.id,
    decision: 'approved',
    actorId: 1,
    paymentProvider: {
      name: 'testpay',
      async refundPayment() { return { status: 'failed' }; },
    },
  });
  assert.equal(failedResult.status, 'failed');
  assert.equal(database.state.refunds.get(failed.id).status, 'failed');
  assert.equal(database.state.payment.status, 'paid');

  const partial = await request(2, '30.00');
  const partialResult = await decideRefundRequest(database, {
    refundId: partial.id,
    decision: 'approved',
    actorId: 1,
    paymentProvider: {
      name: 'testpay',
      async refundPayment(requested) {
        assert.equal(requested.amount, '30.00');
        assert.equal(requested.transactionReference, 'charge-8');
        assert.equal(requested.idempotencyKey, 'refund-request-2');
        return { status: 'succeeded', refundReference: 'refund-30' };
      },
    },
  });
  assert.equal(partialResult.status, 'succeeded');
  assert.equal(partialResult.paymentStatus, 'partially_refunded');
  assert.equal(database.state.payment.status, 'partially_refunded');

  const remainder = await request(3, '70.00');
  const fullResult = await decideRefundRequest(database, {
    refundId: remainder.id,
    decision: 'approved',
    actorId: 1,
    paymentProvider: {
      name: 'testpay',
      async refundPayment() {
        return { status: 'succeeded', refundReference: 'refund-70' };
      },
    },
  });
  assert.equal(fullResult.paymentStatus, 'refunded');
  assert.equal(database.state.payment.status, 'refunded');
  assert.ok(database.state.history.some((entry) => entry.action === 'payment.refund_confirmed'));
  assert.ok(database.state.audits.some((entry) => JSON.parse(entry[4]).paymentId === 8));
});

test('refund request transaction rolls back internal records when audit persistence fails', async () => {
  const database = createPaymentDatabase({ failAudit: true });
  await assert.rejects(createRefundRequest(database, {
    paymentId: 8,
    requesterId: 21,
    amount: '10.00',
    reason: 'Event cancelled',
    idempotencyKey: 'refund-request-rollback',
  }), /Audit storage unavailable/);
  assert.equal(database.state.refunds.size, 0);
  assert.equal(database.state.history.length, 0);
  assert.equal(database.state.rollbacks, 1);
});

test('refund approval remains pending when no provider is configured', async () => {
  const database = createPaymentDatabase();
  const refund = await createRefundRequest(database, {
    paymentId: 8,
    requesterId: 21,
    amount: '10.00',
    reason: 'Event cancelled',
    idempotencyKey: 'refund-request-no-provider',
  });
  await assert.rejects(
    decideRefundRequest(database, {
      refundId: refund.id,
      decision: 'approved',
      actorId: 1,
      paymentProvider: null,
    }),
    { status: 503 },
  );
  assert.equal(database.state.refunds.get(refund.id).status, 'pending');
});

test('provider webhook endpoint rejects unsigned callbacks and only records verified events', async (context) => {
  const database = createPaymentDatabase({ status: 'pending' });
  const provider = {
    name: 'testpay',
    async refundPayment() { return { status: 'pending' }; },
    async verifyWebhook({ headers, rawBody }) {
      if (headers['x-provider-signature'] !== 'valid') return null;
      return JSON.parse(rawBody.toString('utf8'));
    },
  };
  const server = createServer(createApp({ database, paymentProvider: provider }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const url = `http://127.0.0.1:${server.address().port}/api/payments/webhook`;
  const body = JSON.stringify({
    eventId: 'evt-webhook',
    type: 'payment.succeeded',
    transactionReference: 'charge-8',
    amount: '100.00',
    currency: 'ETB',
  });

  const unsigned = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  assert.equal(unsigned.status, 401);
  assert.equal(database.state.payment.status, 'pending');

  const verified = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-provider-signature': 'valid' },
    body,
  });
  assert.equal(verified.status, 200);
  assert.equal(database.state.payment.status, 'paid');
});

test('admin financial actions require an administrator session', async (context) => {
  const database = createPaymentDatabase();
  database.execute = async (sql) => {
    if (sql.includes('FROM admin_sessions')) return [[], []];
    throw new Error(`Unexpected unauthenticated query: ${sql}`);
  };
  const server = createServer(createApp({ database }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/refunds/1/decision`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  assert.equal(response.status, 401);
});

test('admin refund rejection requires a reason and generic CRUD cannot create or edit payments', async (context) => {
  const database = createPaymentDatabase();
  const writes = [];
  database.execute = async (sql) => {
    if (sql.includes('FROM admin_sessions')) {
      return [[{
        id: 1,
        full_name: 'Platform Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }], []];
    }
    writes.push(sql);
    throw new Error(`Unexpected financial mutation: ${sql}`);
  };
  const server = createServer(createApp({ database }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  const url = `http://127.0.0.1:${server.address().port}/api/admin`;
  const headers = { 'content-type': 'application/json', cookie: 'admin_session=test-session' };

  const rejected = await fetch(`${url}/refunds/1/decision`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ decision: 'rejected', reason: '  ' }),
  });
  assert.equal(rejected.status, 400);

  const createPayment = await fetch(`${url}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ booking_id: 15, amount: '100.00', status: 'paid' }),
  });
  assert.equal(createPayment.status, 404);

  const editPayment = await fetch(`${url}/payments/8`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'paid' }),
  });
  assert.equal(editPayment.status, 404);
  assert.deepEqual(writes, []);
});
