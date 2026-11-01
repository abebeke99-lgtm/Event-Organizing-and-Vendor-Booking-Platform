import { createHash } from 'node:crypto';
import express from 'express';

export const MAX_COMPLAINT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const COMPLAINT_ATTACHMENT_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const complaintAttachmentParser = express.raw({
  type: Object.keys(COMPLAINT_ATTACHMENT_TYPES),
  limit: MAX_COMPLAINT_ATTACHMENT_BYTES,
});

const signatures = {
  'application/pdf': (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/jpeg': (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function sanitizeComplaintAttachmentName(value) {
  const name = String(value || 'attachment')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w .()-]/g, '_')
    .trim()
    .slice(0, 180);
  return name || 'attachment';
}

export function validateComplaintAttachment(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, error: 'Choose a non-empty PDF, JPEG, PNG, or WebP attachment.' };
  }
  if (buffer.length > MAX_COMPLAINT_ATTACHMENT_BYTES) {
    return { valid: false, error: 'Attachments must be 5 MB or smaller.' };
  }
  if (!Object.hasOwn(signatures, contentType) || !signatures[contentType](buffer)) {
    return { valid: false, error: 'The attachment content does not match an allowed file type.' };
  }
  return {
    valid: true,
    fileSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
