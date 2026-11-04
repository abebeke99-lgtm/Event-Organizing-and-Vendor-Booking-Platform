import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCustomerMoney } from '../src/customerMoney.js';

test('customer money formatting defaults invalid currencies and amounts safely', () => {
  assert.match(formatCustomerMoney(1250, null), /ETB/);
  assert.match(formatCustomerMoney(1250, undefined), /ETB/);
  assert.match(formatCustomerMoney(1250, ''), /ETB/);
  assert.match(formatCustomerMoney(1250, 'not-a-currency'), /ETB/);
  assert.match(formatCustomerMoney(null, 'ETB'), /ETB/);
  assert.match(formatCustomerMoney(Number.NaN, 'ETB'), /0/);
});

test('customer money formatting normalizes valid three-letter currency codes', () => {
  assert.match(formatCustomerMoney(1250, 'usd'), /\$\s?1,250/);
});
