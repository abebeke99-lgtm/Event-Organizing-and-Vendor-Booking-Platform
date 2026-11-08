import express, { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import {
  profilePhotoUploadParser,
  validateProfilePhoto,
} from '../lib/profilePhoto.js';

export function createPostgresProfilePhotoRouter({ database }) {
  const router = Router();

  router.get('/', requirePlatformUser, asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const result = await database.query(
      'SELECT profile_photo, profile_photo_mime FROM users WHERE id = $1',
      [req.platformUser.id],
    );
    const photo = result.rows[0];
    if (!photo?.profile_photo) return res.status(204).end();
    res.set({
      'Content-Disposition': 'inline',
      'Content-Type': photo.profile_photo_mime,
    });
    return res.send(photo.profile_photo);
  }));

  router.put('/', requirePlatformUser, profilePhotoUploadParser(express), asyncHandler(async (req, res) => {
    const contentType = req.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const validation = validateProfilePhoto(contentType, req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    await database.query(
      'UPDATE users SET profile_photo = $1, profile_photo_mime = $2 WHERE id = $3',
      [req.body, contentType, req.platformUser.id],
    );
    return res.json({ message: 'Profile photo saved.' });
  }));

  router.delete('/', requirePlatformUser, asyncHandler(async (req, res) => {
    await database.query(
      'UPDATE users SET profile_photo = NULL, profile_photo_mime = NULL WHERE id = $1',
      [req.platformUser.id],
    );
    return res.status(204).end();
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Profile photos must be 5 MB or smaller.' });
    }
    if (error) return next(error);
    return undefined;
  });
  return router;
}
