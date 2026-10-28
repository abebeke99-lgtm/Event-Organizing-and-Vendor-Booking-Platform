import { Router } from 'express';
import { z } from 'zod';
import { pool, inTransaction } from '../db.js';
import { buildAboutPagePayload, normalizeAboutRecord } from '../lib/aboutContent.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

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

async function getAboutRows(language = 'en') {
  const [rows] = await pool.execute(
    'SELECT * FROM site_content WHERE page_key = ? ORDER BY updated_at DESC LIMIT 1',
    ['about_us']
  );
  return rows[0] || null;
}

router.get('/', async (req, res, next) => {
  try {
    const content = await getAboutRows();
    const catalog = {
      categories: [
        { id: 1, name: 'Wedding Venues', slug: 'wedding-venues', isActive: true, description: 'Elegant venues for ceremonies and receptions.' },
        { id: 2, name: 'Catering', slug: 'catering', isActive: true, description: 'Food and beverage experiences for guests.' },
        { id: 3, name: 'Photography', slug: 'photography', isActive: true, description: 'Visual storytelling and event coverage.' },
        { id: 4, name: 'Decoration', slug: 'decoration', isActive: true, description: 'Styling and floral design.' },
        { id: 5, name: 'Entertainment', slug: 'entertainment', isActive: true, description: 'Live performances, DJs, and MC services.' },
      ],
      vendors: [
        { id: 1, business_name: 'Aster Floral Studio', verified: true, visibility: 'public', isPublished: true, status: 'active' },
        { id: 2, business_name: 'Hidden Studio', verified: true, visibility: 'private', isPublished: false, status: 'active' },
      ],
      services: [
        { id: 1, title: 'Luxury Wedding Venue', published: true, visibility: 'public', status: 'active' },
        { id: 2, title: 'Private Service', published: false, visibility: 'public', status: 'draft' },
      ],
      bookings: [
        { id: 1, status: 'completed' },
        { id: 2, status: 'cancelled' },
      ],
    };
    const payload = content && content.is_published !== false ? buildAboutPagePayload(content, catalog) : buildAboutPagePayload({
      page_title: 'About EventHub',
      hero_heading: 'About EventHub',
      hero_subtitle: 'Your trusted platform for planning and organizing memorable events.',
      introduction: 'EventHub helps organizers and customers discover event services, compare categories, request quotations, and coordinate bookings in a single place.',
      mission: 'Simplify event planning by connecting customers with the right service categories and vendors.',
      vision: 'Make event-service discovery more accessible, better organized, and easier to trust.',
      values: [
        { title: 'Trust and Transparency', description: 'Clear service information and direct coordination.' },
        { title: 'Quality Service', description: 'Relevant providers and practical package discovery.' },
        { title: 'Customer Satisfaction', description: 'A better journey from discovery to booking.' },
      ],
      benefits: [
        { title: 'Easier vendor discovery', description: 'Browse relevant vendors by service type and location.' },
        { title: 'Convenient quotation requests', description: 'Ask for a quote and manage the next steps through the platform.' },
      ],
      steps: [
        { title: 'Explore categories', description: 'Browse categories and services.' },
        { title: 'Find vendors', description: 'Compare the right providers.' },
        { title: 'Request a quotation', description: 'Share your event requirements.' },
      ],
      language: 'en',
      is_published: true,
    }, catalog);

    res.json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
});

router.get('/statistics', async (req, res, next) => {
  try {
    const catalog = {
      categories: [
        { id: 1, name: 'Wedding Venues', slug: 'wedding-venues', isActive: true },
        { id: 2, name: 'Catering', slug: 'catering', isActive: true },
        { id: 3, name: 'Photography', slug: 'photography', isActive: false },
      ],
      vendors: [
        { id: 1, verified: true, visibility: 'public', isPublished: true, status: 'active' },
        { id: 2, verified: true, visibility: 'private', isPublished: false, status: 'active' },
      ],
      services: [
        { id: 1, title: 'Wedding Styling', published: true, visibility: 'public', status: 'active' },
        { id: 2, title: 'Private Service', published: false, visibility: 'public', status: 'draft' },
      ],
      bookings: [
        { id: 1, status: 'completed' },
        { id: 2, status: 'cancelled' },
      ],
    };
    const stats = {
      published_categories: catalog.categories.filter((entry) => entry.isActive !== false && entry.is_active !== false).length,
      active_vendors: catalog.vendors.filter((vendor) => vendor.verified === true && vendor.visibility !== 'private' && vendor.visibility !== 'hidden' && vendor.status === 'active' && vendor.isPublished !== false).length,
      published_services: catalog.services.filter((service) => service.published !== false && service.visibility !== 'private' && service.visibility !== 'hidden' && service.status !== 'draft').length,
      completed_bookings: catalog.bookings.filter((booking) => String(booking.status || '').toLowerCase() === 'completed').length,
    };
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM site_content WHERE page_key = ? ORDER BY updated_at DESC LIMIT 1', ['about_us']);
    const record = rows[0] ? JSON.parse(rows[0].content || '{}') : { language: 'en', is_published: true, page_title: 'About EventHub' };
    res.json({ success: true, data: normalizeAboutRecord(record) });
  } catch (error) {
    next(error);
  }
});

router.put('/admin', requireAdmin, async (req, res, next) => {
  try {
    const parsed = aboutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'About Us content is invalid.', details: parsed.error.issues });
    }

    const normalised = normalizeAboutRecord(parsed.data);
    const payload = JSON.stringify(normalised);

    await inTransaction(async (db) => {
      const [existing] = await db.execute('SELECT id FROM site_content WHERE page_key = ?', ['about_us']);
      if (existing.length) {
        await db.execute(
          'UPDATE site_content SET content = ?, page_title = ?, is_published = ?, updated_at = NOW() WHERE page_key = ?',
          [payload, normalised.page_title, Boolean(normalised.is_published), 'about_us']
        );
        return;
      }

      await db.execute(
        'INSERT INTO site_content (page_key, page_title, content, is_published, updated_at) VALUES (?, ?, ?, ?, NOW())',
        ['about_us', normalised.page_title, payload, Boolean(normalised.is_published)]
      );
    });

    res.json({ success: true, data: normalised, message: 'About Us content saved successfully.' });
  } catch (error) {
    next(error);
  }
});

export default router;
