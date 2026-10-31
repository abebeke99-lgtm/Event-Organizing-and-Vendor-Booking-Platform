import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContactInfo, INQUIRY_TYPES, normalizeContactForm, validateContactForm } from '../src/contactUtils.js';

test('normalizeContactForm trims values and lowercases email', () => {
  const form = normalizeContactForm({
    full_name: '  Ada Lovelace  ',
    email: ' ADA@EXAMPLE.COM ',
    phone: ' +251 911 000 000 ',
    subject: '  Support request  ',
    message: '  Hello world  ',
  });

  assert.equal(form.full_name, 'Ada Lovelace');
  assert.equal(form.email, 'ada@example.com');
  assert.equal(form.phone, '+251 911 000 000');
  assert.equal(form.subject, 'Support request');
  assert.equal(form.inquiry_type, 'general_inquiry');
  assert.equal(form.message, 'Hello world');
});

test('validateContactForm rejects invalid email and short messages', () => {
  const result = validateContactForm({
    full_name: 'A',
    email: 'invalid',
    subject: 'Hi',
    message: 'Too short',
  });

  assert.equal(result.errors.full_name, 'Full name is required.');
  assert.equal(result.errors.email, 'Please enter a valid email address.');
  assert.equal('inquiry_type' in result.errors, false);
  assert.match(result.errors.subject, /between 4 and 200/);
  assert.match(result.errors.message, /between 20 and 2500/);
});

test('validateContactForm returns Amharic validation messages when selected', () => {
  const { errors } = validateContactForm({ full_name: '', email: 'bad', subject: 'a', message: 'short' }, 'am');
  assert.equal(errors.full_name, 'ሙሉ ስም ያስፈልጋል።');
  assert.equal(errors.email, 'ትክክለኛ የኢሜይል አድራሻ ያስገቡ።');
});

test('buildContactInfo excludes empty settings', () => {
  const info = buildContactInfo({ email: '', phone: '', address: '', hours: '', socials: [] });
  assert.equal(info.email, '');
  assert.deepEqual(info.socials, []);
});

test('inquiry types include the supported contact categories', () => {
  assert.equal(INQUIRY_TYPES.length, 10);
  assert.ok(INQUIRY_TYPES.some((entry) => entry.value === 'partnership_inquiry'));
  assert.ok(INQUIRY_TYPES.some((entry) => entry.value === 'technical_support'));
  assert.ok(INQUIRY_TYPES.some((entry) => entry.value === 'payment_billing'));
});

test('contact validation accepts a valid form without an inquiry type', () => {
  const { normalized, errors } = validateContactForm({
    full_name: 'Ada Lovelace',
    email: 'ada@example.com',
    subject: 'Event support',
    message: 'Please help me with my event booking.',
  });

  assert.deepEqual(errors, {});
  assert.equal(normalized.inquiry_type, 'general_inquiry');
});

test('buildContactInfo ignores unsafe social links', () => {
  const info = buildContactInfo({
    socials: [
      { label: 'EventFlow', url: 'https://example.com' },
      { label: 'Unsafe', url: 'javascript:alert(1)' },
    ],
  });

  assert.deepEqual(info.socials, [{ label: 'EventFlow', url: 'https://example.com' }]);
});
