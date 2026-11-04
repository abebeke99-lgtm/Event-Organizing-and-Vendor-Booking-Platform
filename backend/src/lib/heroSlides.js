import path from 'node:path';
import { validateProfilePhoto, PROFILE_PHOTO_MIME_TYPES } from './profilePhoto.js';

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
]);
const SAFE_FILE_NAME = /^[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i;

export const MAX_HERO_SLIDES = 5;
export const MAX_HERO_IMAGE_BYTES = 5 * 1024 * 1024;
export const HERO_IMAGE_MIME_TYPES = PROFILE_PHOTO_MIME_TYPES;

export function validateHeroSlideImage(file) {
  if (!file?.buffer?.length) return { valid: false, error: 'Choose an image to upload.' };
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = MIME_EXTENSIONS.get(file.mimetype);
  if (!allowedExtensions || !allowedExtensions.has(extension)) {
    return { valid: false, error: 'Choose a matching JPG, PNG, or WebP image.' };
  }
  if (file.buffer.length > MAX_HERO_IMAGE_BYTES) {
    return { valid: false, error: 'Hero images must be 5 MB or smaller.' };
  }
  return validateProfilePhoto(file.mimetype, file.buffer);
}

export function parseHeroSlideAltText(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, error: 'Enter alternative text for the image.' };
  }
  const altText = value.trim();
  if (altText.length > 150) {
    return { valid: false, error: 'Alternative text must be 150 characters or fewer.' };
  }
  return { valid: true, value: altText };
}

export function parseHeroSlideLink(value) {
  if (value === undefined || value === null || value === '') return { valid: true, value: null };
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\\]/.test(value)) {
    return { valid: false, error: 'Enter an internal path or a valid HTTPS link.' };
  }
  if (value.startsWith('/') && !value.startsWith('//')) return { valid: true, value };
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname) return { valid: true, value: url.toString() };
  } catch {
    return { valid: false, error: 'Enter an internal path or a valid HTTPS link.' };
  }
  return { valid: false, error: 'Enter an internal path or a valid HTTPS link.' };
}

export function parseHeroSlideActive(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return { valid: true, value: true };
  if (value === false || value === 'false' || value === 0 || value === '0') return { valid: true, value: false };
  return { valid: false, error: 'Choose whether this slide is active.' };
}

export function isSafeHeroImageName(fileName) {
  return typeof fileName === 'string' && SAFE_FILE_NAME.test(fileName) && path.basename(fileName) === fileName;
}

export function toPublicHeroSlide(row) {
  return {
    id: Number(row.id),
    imageUrl: `/api/hero-slides/${Number(row.id)}/image`,
    altText: row.alt_text,
    linkUrl: row.link_url || null,
    sortOrder: Number(row.sort_order),
  };
}

export function toAdminHeroSlide(row) {
  return {
    ...toPublicHeroSlide(row),
    imageUrl: `/api/admin/hero-slides/${Number(row.id)}/image`,
    isActive: Boolean(Number(row.is_active)),
    updatedAt: row.updated_at,
  };
}
