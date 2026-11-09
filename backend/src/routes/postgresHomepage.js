import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { isSafeHeroImageName, toPublicHeroSlide } from '../lib/heroSlides.js';

const defaultUploadDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/hero-slides');
const validId = /^\d+$/;

export function createPostgresHomepageRouter({ database }) {
  const router = Router();

  router.get('/hero-slides', async (req, res, next) => {
    try {
      const result = await database.query(
        `SELECT id, alt_text, link_url, sort_order FROM hero_slides
         WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`,
      );
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ data: result.rows.map(toPublicHeroSlide) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/hero-slides/:id/image', async (req, res, next) => {
    if (!validId.test(req.params.id)) return res.status(404).end();
    try {
      const result = await database.query(
        'SELECT image_path, image_mime FROM hero_slides WHERE id = $1 AND is_active = TRUE',
        [Number(req.params.id)],
      );
      const slide = result.rows[0];
      if (!slide) return res.status(404).end();
      if (!isSafeHeroImageName(slide.image_path)) {
        return next(new Error('The stored hero image path is invalid.'));
      }
      const directory = req.app?.locals?.heroSlidesDirectory || defaultUploadDirectory;
      const imagePath = path.resolve(directory, slide.image_path);
      if (path.dirname(imagePath) !== path.resolve(directory)) {
        return next(new Error('The stored hero image path is invalid.'));
      }
      res.set({
        'Cache-Control': 'public, max-age=300',
        'Content-Disposition': 'inline',
        'Content-Type': slide.image_mime,
        'X-Content-Type-Options': 'nosniff',
      });
      const stream = createReadStream(imagePath);
      stream.on('error', (error) => {
        if (error.code === 'ENOENT') return res.status(404).end();
        return next(error);
      });
      return stream.pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/about/homepage-statistics', async (req, res, next) => {
    try {
      const result = await database.query(`
        SELECT
          (
            SELECT ROUND(AVG(r.rating), 1)
            FROM reviews r
            JOIN bookings b ON b.id = r.booking_id
            JOIN vendor_profiles vp ON vp.id = b.vendor_id AND vp.verification_status = 'verified'
            JOIN users u ON u.id = vp.user_id AND u.status = 'active'
            WHERE r.status = 'published'
          ) AS "averageVendorRating",
          (
            SELECT COUNT(*)
            FROM vendor_profiles vp
            JOIN users u ON u.id = vp.user_id
            WHERE vp.verification_status = 'verified' AND u.status = 'active'
          ) AS "activeVendorCount",
          (
            SELECT COUNT(*)
            FROM events e
            WHERE e.status IN ('active', 'completed')
          ) AS "publishedEventCount",
          (
            SELECT COUNT(*)
            FROM bookings b
            WHERE b.status IN ('accepted', 'completed')
          ) AS "confirmedOrCompletedBookingCount",
          (
            SELECT COUNT(*)
            FROM bookings b
            WHERE b.status = 'completed'
          ) AS "completedBookingCount"
      `);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      return res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
