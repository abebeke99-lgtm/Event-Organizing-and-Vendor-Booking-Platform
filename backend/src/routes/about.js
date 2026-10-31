import { Router } from 'express';
import { z } from 'zod';
import { inTransaction, pool } from '../db.js';
import { buildAboutPagePayload, normalizeAboutRecord } from '../lib/aboutContent.js';
import { loadPublicMarketplace } from '../lib/marketplace.js';

const publicRouter = Router();
const adminRouter = Router();

const aboutSchema = z.object({
  page_title: z.string().max(150).optional(),
  hero_heading: z.string().max(150).optional(),
  hero_subtitle: z.string().max(220).optional(),
  introduction: z.string().max(1200).optional(),
  mission: z.string().max(1000).optional(),
  vision: z.string().max(1000).optional(),
  values: z.array(z.object({
    title: z.string().max(120),
    description: z.string().max(500),
    icon: z.string().max(60).optional(),
  })).max(20).optional(),
  benefits: z.array(z.object({
    title: z.string().max(120),
    description: z.string().max(500),
  })).max(20).optional(),
  steps: z.array(z.object({
    title: z.string().max(120),
    description: z.string().max(500),
  })).max(12).optional(),
  language: z.enum(['en', 'am']).optional(),
  is_published: z.boolean().optional(),
}).strict();

async function loadAboutContent() {
  const [rows] = await pool.execute(
    'SELECT * FROM site_content WHERE page_key = ? ORDER BY updated_at DESC LIMIT 1',
    ['about_us']
  );
  if (!rows.length || rows[0].is_published === false) return null;
  try {
    return JSON.parse(rows[0].content || '{}');
  } catch {
    return null;
  }
}

async function loadAboutCatalog() {
  const marketplace = await loadPublicMarketplace();
  const [bookingRows] = await pool.query('SELECT status FROM bookings');
  return {
    categories: marketplace.categories,
    vendors: marketplace.vendors,
    services: marketplace.services,
    bookings: bookingRows,
  };
}

publicRouter.get('/', async (req, res) => {
  const [content, catalog] = await Promise.all([loadAboutContent(), loadAboutCatalog()]);
  return res.json({ success: true, data: buildAboutPagePayload(content || {}, catalog) });
});

publicRouter.get('/statistics', async (req, res) => {
  const catalog = await loadAboutCatalog();
  const payload = buildAboutPagePayload({}, catalog);
  return res.json({ success: true, data: payload.statistics });
});

publicRouter.get('/homepage-statistics', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      (
        SELECT ROUND(AVG(r.rating), 1)
        FROM reviews r
        JOIN bookings b ON b.id = r.booking_id
        JOIN vendor_profiles vp ON vp.id = b.vendor_id AND vp.verification_status = 'verified'
        JOIN users u ON u.id = vp.user_id AND u.status = 'active'
        WHERE r.status = 'published'
      ) AS averageVendorRating,
      (
        SELECT COUNT(*)
        FROM vendor_profiles vp
        JOIN users u ON u.id = vp.user_id
        WHERE vp.verification_status = 'verified' AND u.status = 'active'
      ) AS activeVendorCount,
      (
        SELECT COUNT(*)
        FROM events e
        WHERE e.status IN ('active', 'completed')
      ) AS publishedEventCount,
      (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.status IN ('accepted', 'completed')
      ) AS confirmedOrCompletedBookingCount,
      (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.status = 'completed'
      ) AS completedBookingCount
  `);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  return res.json({ success: true, data: rows[0] });
});

adminRouter.get('/', async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT * FROM site_content WHERE page_key = ? ORDER BY updated_at DESC LIMIT 1',
    ['about_us']
  );
  let record = {};
  if (rows.length) {
    try {
      record = JSON.parse(rows[0].content || '{}');
    } catch {
      record = {};
    }
  }
  return res.json({ success: true, data: normalizeAboutRecord(record) });
});

adminRouter.put('/', async (req, res) => {
  const parsed = aboutSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'About Us content is invalid.', details: parsed.error.issues });
  }

  const normalised = normalizeAboutRecord(parsed.data);
  const payload = JSON.stringify(normalised);
  await inTransaction(async (db) => {
    const [existing] = await db.execute('SELECT id FROM site_content WHERE page_key = ? LIMIT 1', ['about_us']);
    if (existing.length) {
      await db.execute(
        'UPDATE site_content SET content = ?, page_title = ?, is_published = ?, updated_at = NOW() WHERE id = ?',
        [payload, normalised.page_title, Boolean(normalised.is_published), existing[0].id]
      );
      return;
    }
    await db.execute(
      'INSERT INTO site_content (page_key, page_title, content, is_published, updated_at) VALUES (?, ?, ?, ?, NOW())',
      ['about_us', normalised.page_title, payload, Boolean(normalised.is_published)]
    );
  });

  return res.json({ success: true, data: normalised, message: 'About Us content saved successfully.' });
});

export { adminRouter };
export default publicRouter;
