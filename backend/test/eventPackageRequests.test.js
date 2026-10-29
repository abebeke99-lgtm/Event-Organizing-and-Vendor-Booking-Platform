import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEventPackageRequest } from '../src/lib/eventPackageRequests.js';

test('validates and normalizes a package request', () => {
  const parsed = parseEventPackageRequest({
    event_id: 12,
    event_title: 'Autumn wedding',
    requester_name: '  Hana Bekele ',
    requester_email: ' HANA@example.com ',
    service_category: 'Catering',
    guest_count: 120,
    budget: 240000,
    notes: 'Vegetarian options requested.',
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.requester_name, 'Hana Bekele');
  assert.equal(parsed.data.requester_email, 'hana@example.com');
});

test('rejects invalid package request fields and unknown properties', () => {
  assert.equal(parseEventPackageRequest({ event_id: 0, event_title: 'Event', requester_name: 'A', requester_email: 'bad' }).success, false);
  assert.equal(parseEventPackageRequest({ event_id: null, event_title: 'New celebration', requester_name: 'Hana Bekele', requester_email: 'hana@example.com' }).success, true);
  assert.equal(parseEventPackageRequest({ event_id: null, event_title: 'New celebration', requested_date: '2026-02-31T11:00', requester_name: 'Hana Bekele', requester_email: 'hana@example.com' }).success, false);
  assert.equal(parseEventPackageRequest({ event_id: 12, event_title: 'Autumn wedding', requester_name: 'Hana Bekele', requester_email: 'hana@example.com', extra: 'Untrusted' }).success, false);
});