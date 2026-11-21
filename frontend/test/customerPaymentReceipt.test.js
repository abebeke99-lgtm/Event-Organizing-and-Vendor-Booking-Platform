import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerPaymentReceipt } from '../src/customerPaymentReceipt.js';

test('payment receipt includes backend payment and transaction details', () => {
  const receipt = buildCustomerPaymentReceipt({
    reference: 'provider-ref-123',
    status: 'paid',
    amount: 1250,
    currency: 'ETB',
    provider: 'configured-provider',
    event: 'Garden wedding',
    service: 'Catering',
    date: '2031-02-01T10:00:00Z',
    bookingId: 42,
  });

  assert.match(receipt, /Payment reference: provider-ref-123/);
  assert.match(receipt, /Amount: 1250 ETB/);
  assert.match(receipt, /Booking ID: 42/);
});

test('payment receipt rejects statuses that do not represent successful transactions', () => {
  for (const status of ['pending', 'authorized', 'failed', 'refund_pending']) {
    assert.throws(
      () => buildCustomerPaymentReceipt({ status }),
      /verified successful payment/,
    );
  }
});
