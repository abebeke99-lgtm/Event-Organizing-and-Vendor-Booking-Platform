import express, { Router } from 'express';
import { normalizeDatabaseAdapter } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import {
  profilePhotoUploadParser,
  validateProfilePhoto,
} from '../lib/profilePhoto.js';

export function createPostgresProfilePhotoRouter({ database, administrator = false }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();
  const authenticate = administrator ? requireAdmin : requirePlatformUser;
  const userIdFor = (req) => administrator ? req.admin.id : req.platformUser.id;

  router.get('/', authenticate, asyncHandler(async (req, res) => {
    res.set({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const result = await database.query(
      'SELECT profile_photo, profile_photo_mime FROM users WHERE id = $1',
      [userIdFor(req)],
    );
    const photo = result.rows[0];
    if (!photo?.profile_photo) return res.status(204).end();
    res.set({
      'Content-Disposition': 'inline',
      'Content-Type': photo.profile_photo_mime,
    });
    return res.send(photo.profile_photo);
  }));

  router.put('/', authenticate, profilePhotoUploadParser(express), asyncHandler(async (req, res) => {
    const contentType = req.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const validation = validateProfilePhoto(contentType, req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    const userId = userIdFor(req);
    const updatePhoto = async (executor) => {
      await executor.query(
        'UPDATE users SET profile_photo = $1, profile_photo_mime = $2 WHERE id = $3',
        [req.body, contentType, userId],
      );
      if (administrator) {
        await executor.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES ($1, 'admin.profile_photo_updated', 'user', $2, $3::jsonb, $4)`,
          [userId, String(userId), JSON.stringify({ content_type: contentType, size: req.body.length }), req.ip || null],
        );
      }
    };
    if (administrator) await database.inTransaction(updatePhoto);
    else await updatePhoto(database);
    return res.json({ message: 'Profile photo saved.' });
  }));

  router.delete('/', authenticate, asyncHandler(async (req, res) => {
    const userId = userIdFor(req);
    const removePhoto = async (executor) => {
      await executor.query(
        'UPDATE users SET profile_photo = NULL, profile_photo_mime = NULL WHERE id = $1',
        [userId],
      );
      if (administrator) {
        await executor.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
           VALUES ($1, 'admin.profile_photo_removed', 'user', $2, '{}'::jsonb, $3)`,
          [userId, String(userId), req.ip || null],
        );
      }
    };
    if (administrator) await database.inTransaction(removePhoto);
    else await removePhoto(database);
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
