import test from 'node:test';
import assert from 'node:assert/strict';
import { publicContactSchema } from '../src/routes/contact.js';

const validContactMessage = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '',
  subject: 'Event support',
  message: 'Please help me with my event booking.',
};

test('public contact submissions default an omitted inquiry type', () => {
  const parsed = publicContactSchema.parse(validContactMessage);

  assert.equal(parsed.inquiry_type, 'general_inquiry');
});

test('public contact submissions continue accepting explicit inquiry types', () => {
  const parsed = publicContactSchema.parse({
    ...validContactMessage,
    inquiry_type: 'event_booking_support',
  });

  assert.equal(parsed.inquiry_type, 'event_booking_support');
});
