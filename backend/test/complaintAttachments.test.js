import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sanitizeComplaintAttachmentName,
  validateComplaintAttachment,
} from '../src/lib/complaintAttachments.js';

test('complaint attachment validation checks file signature and computes a digest', () => {
  const pdf = Buffer.from('%PDF-1.7\n');
  const valid = validateComplaintAttachment(pdf, 'application/pdf');
  assert.equal(valid.valid, true);
  assert.equal(valid.fileSize, pdf.length);
  assert.match(valid.sha256, /^[a-f0-9]{64}$/);
  assert.equal(validateComplaintAttachment(Buffer.from('not-pdf'), 'application/pdf').valid, false);
  assert.equal(validateComplaintAttachment(pdf, 'text/plain').valid, false);
});

test('complaint attachment names cannot include path components or control characters', () => {
  assert.equal(sanitizeComplaintAttachmentName('..\\private/report.pdf'), '.._private_report.pdf');
  assert.equal(sanitizeComplaintAttachmentName(''), 'attachment');
});
