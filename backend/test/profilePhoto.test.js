import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PROFILE_PHOTO_BYTES, validateProfilePhoto } from '../src/lib/profilePhoto.js';

test('accepts JPG, PNG, and WebP signatures with matching MIME types', () => {
  const examples = [
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/webp', Buffer.from('RIFF0000WEBP', 'ascii')],
  ];

  for (const [mimeType, image] of examples) {
    assert.deepEqual(validateProfilePhoto(mimeType, image), { valid: true });
  }
});

test('rejects unsupported, empty, mismatched, and oversized profile photos', () => {
  assert.equal(validateProfilePhoto('image/svg+xml', Buffer.from('<svg/>')).valid, false);
  assert.equal(validateProfilePhoto('image/png', Buffer.alloc(0)).valid, false);
  assert.equal(validateProfilePhoto('image/png', Buffer.from([0xff, 0xd8, 0xff])).valid, false);
  assert.equal(validateProfilePhoto('image/jpeg', Buffer.alloc(MAX_PROFILE_PHOTO_BYTES + 1)).valid, false);
});

test('accepts profile photos at the configured size limit when their signature is valid', () => {
  const image = Buffer.alloc(MAX_PROFILE_PHOTO_BYTES);
  image.set([0xff, 0xd8, 0xff]);
  assert.deepEqual(validateProfilePhoto('image/jpeg', image), { valid: true });
});
