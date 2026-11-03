import express, { Router } from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import {
  getProfilePhoto,
  MAX_PROFILE_PHOTO_BYTES,
  PROFILE_PHOTO_MIME_TYPES,
  removeProfilePhoto,
  validateProfilePhoto,
} from '../lib/profilePhoto.js';

const router = Router();
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 },
});

function requireAuthenticatedAccount(req, res, next) {
  return (req.cookies?.admin_session ? requireAdmin : requirePlatformUser)(req, res, next);
}

function parseAvatar(req, res, next) {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Profile photos must be 5 MB or smaller.' });
    }
    return res.status(400).json({ error: error.message || 'Choose a JPG, PNG, or WebP image.' });
  });
}

router.get('/', requireAuthenticatedAccount, asyncHandler(async (req, res) => {
  const database = req.app?.locals?.database || pool;
  return getProfilePhoto(database, req.user.id, res);
}));

router.post('/', requireAuthenticatedAccount, parseAvatar, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Choose an image to upload.' });
  if (!PROFILE_PHOTO_MIME_TYPES.has(file.mimetype)) {
    return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP image.' });
  }
  const validation = validateProfilePhoto(file.mimetype, file.buffer);
  if (!validation.valid) return res.status(400).json({ error: validation.error });

  const database = req.app?.locals?.database || pool;
  await database.execute(
    'UPDATE users SET profile_photo = ?, profile_photo_mime = ? WHERE id = ?',
    [file.buffer, file.mimetype, req.user.id],
  );
  return res.json({ message: 'Profile photo saved.' });
}));

router.delete('/', requireAuthenticatedAccount, asyncHandler(async (req, res) => {
  const database = req.app?.locals?.database || pool;
  return removeProfilePhoto(database, req.user.id, res);
}));

export default router;