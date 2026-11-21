const downloadablePaymentStatuses = new Set(['paid', 'partially_refunded', 'refunded']);

export function buildCustomerPaymentReceipt(payment) {
  if (!payment || !downloadablePaymentStatuses.has(String(payment.status || '').toLowerCase())) {
    throw new Error('A receipt is available only for a verified successful payment.');
  }

  return [
    'EventHub payment receipt',
    `Payment reference: ${payment.reference || 'Unavailable'}`,
    `Status: ${payment.status}`,
    `Amount: ${payment.amount} ${payment.currency || ''}`.trim(),
    `Payment provider: ${payment.provider || 'Unavailable'}`,
    `Event: ${payment.event || 'Unavailable'}`,
    `Service: ${payment.service || 'Unavailable'}`,
    `Payment date: ${payment.date || 'Unavailable'}`,
    `Booking ID: ${payment.bookingId || 'Unavailable'}`,
  ].join('\r\n');
}
