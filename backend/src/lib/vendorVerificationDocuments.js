export const MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const VENDOR_VERIFICATION_DOCUMENT_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const signatures = {
  'application/pdf': (content) => content.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/jpeg': (content) => content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff,
  'image/png': (content) => content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
};

export function validateVendorVerificationDocument(content, contentType) {
  if (!Buffer.isBuffer(content) || content.length === 0) return 'Upload a non-empty document.';
  if (content.length > MAX_VENDOR_VERIFICATION_DOCUMENT_BYTES) return 'Each document must be 5 MB or smaller.';
  if (!signatures[contentType]?.(content)) return 'The file contents do not match an allowed PDF, JPEG, or PNG type.';
  return null;
}

export function sanitizeVendorDocumentName(value) {
  const name = String(value ?? '')
    .replace(/[\\/]/g, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '')
    .trim()
    .slice(0, 180);
  return name || 'verification-document';
}
