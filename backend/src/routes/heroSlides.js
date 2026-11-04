import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requirePlatformUser } from '../middleware/requirePlatformUser.js';
import {
  HERO_IMAGE_MIME_TYPES,
  MAX_HERO_IMAGE_BYTES,
  MAX_HERO_SLIDES,
  isSafeHeroImageName,
  parseHeroSlideActive,
  parseHeroSlideAltText,
  parseHeroSlideLink,
  toAdminHeroSlide,
  toPublicHeroSlide,
  validateHeroSlideImage,
} from '../lib/heroSlides.js';

const publicRouter = Router();
export const adminRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_HERO_IMAGE_BYTES, files: 1 } });
const defaultUploadDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/hero-slides');
const lockName = 'eventhub_hero_slides_create';
const validId = /^\d+$/;

function databaseFor(req) {
  return req.app?.locals?.database || pool;
}

function uploadDirectoryFor(req) {
  return req.app?.locals?.heroSlidesDirectory || defaultUploadDirectory;
}

function sendUploadError(error, res, next) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Hero images must be 5 MB or smaller.' });
  }
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Upload one image at a time.' });
  return next(error);
}

function parseUpload(req, res, next) {
  upload.single('image')(req, res, (error) => error ? sendUploadError(error, res, next) : next());
}

function fail(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function validatedFields(body, { creating = false } = {}) {
  const alt = parseHeroSlideAltText(body.altText);
  if (!alt.valid) throw fail(400, alt.error);
  const link = parseHeroSlideLink(body.linkUrl);
  if (!link.valid) throw fail(400, link.error);
  const active = creating && body.isActive === undefined
    ? { valid: true, value: true }
    : parseHeroSlideActive(body.isActive);
  if (!active.valid) throw fail(400, active.error);
  return { altText: alt.value, linkUrl: link.value, isActive: active.value };
}

function validateFile(file) {
  if (!file) throw fail(400, 'Choose an image to upload.');
  if (!HERO_IMAGE_MIME_TYPES.has(file.mimetype)) throw fail(400, 'Choose a JPG, PNG, or WebP image.');
  const result = validateHeroSlideImage(file);
  if (!result.valid) throw fail(400, result.error);
}

function safeImagePath(directory, fileName) {
  if (!isSafeHeroImageName(fileName)) throw fail(500, 'The stored hero image path is invalid.');
  const resolved = path.resolve(directory, fileName);
  if (path.dirname(resolved) !== path.resolve(directory)) throw fail(500, 'The stored hero image path is invalid.');
  return resolved;
}

async function removeImage(directory, fileName) {
  if (!fileName) return;
  await unlink(safeImagePath(directory, fileName)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function saveImage(req, file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const fileName = `${randomUUID()}${extension}`;
  const directory = uploadDirectoryFor(req);
  await mkdir(directory, { recursive: true });
  await writeFile(safeImagePath(directory, fileName), file.buffer, { flag: 'wx' });
  return fileName;
}

async function getSlide(database, id, lock = false) {
  const [rows] = await database.execute(
    `SELECT id, image_path, image_mime, alt_text, link_url, sort_order, is_active, created_at, updated_at
     FROM hero_slides WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] || null;
}

async function getSlides(database) {
  const [rows] = await database.execute(
    `SELECT id, image_path, image_mime, alt_text, link_url, sort_order, is_active, created_at, updated_at
     FROM hero_slides ORDER BY sort_order ASC, id ASC`,
  );
  return rows;
}

async function withTransaction(database, work) {
  const connection = await database.getConnection();
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createWithLimitLock(database, work) {
  const connection = await database.getConnection();
  let locked = false;
  let transactionStarted = false;
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lockRows[0]?.acquired) !== 1) throw fail(503, 'Hero slides are being updated. Try again shortly.');
    locked = true;
    await connection.beginTransaction();
    transactionStarted = true;
    const result = await work(connection);
    await connection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    connection.release();
  }
}

publicRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await databaseFor(req).execute(
    `SELECT id, alt_text, link_url, sort_order FROM hero_slides
     WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`,
  );
  res.set('Cache-Control', 'public, max-age=60');
  return res.json({ data: rows[0].map(toPublicHeroSlide) });
}));

publicRouter.get('/:id/image', asyncHandler(async (req, res) => {
  if (!validId.test(req.params.id)) return res.status(404).end();
  const [rows] = await databaseFor(req).execute(
    'SELECT image_path, image_mime FROM hero_slides WHERE id = ? AND is_active = TRUE',
    [Number(req.params.id)],
  );
  if (!rows.length) return res.status(404).end();
  const imagePath = safeImagePath(uploadDirectoryFor(req), rows[0].image_path);
  res.set({
    'Cache-Control': 'public, max-age=300',
    'Content-Disposition': 'inline',
    'Content-Type': rows[0].image_mime,
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = createReadStream(imagePath);
  stream.on('error', (error) => {
    if (error.code === 'ENOENT') return res.status(404).end();
    return res.destroy(error);
  });
  return stream.pipe(res);
}));

adminRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await getSlides(databaseFor(req));
  return res.json({ data: rows.map(toAdminHeroSlide) });
}));

adminRouter.get('/:id/image', asyncHandler(async (req, res) => {
  if (!validId.test(req.params.id)) return res.status(404).end();
  const [rows] = await databaseFor(req).execute(
    'SELECT image_path, image_mime FROM hero_slides WHERE id = ?',
    [Number(req.params.id)],
  );
  if (!rows.length) return res.status(404).end();
  const imagePath = safeImagePath(uploadDirectoryFor(req), rows[0].image_path);
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'Content-Type': rows[0].image_mime,
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = createReadStream(imagePath);
  stream.on('error', (error) => {
    if (error.code === 'ENOENT') return res.status(404).end();
    return res.destroy(error);
  });
  return stream.pipe(res);
}));

adminRouter.post('/', parseUpload, asyncHandler(async (req, res) => {
  validateFile(req.file);
  const fields = validatedFields(req.body, { creating: true });
  const database = databaseFor(req);
  let savedFile;
  try {
    const slide = await createWithLimitLock(database, async (connection) => {
      const [counts] = await connection.execute('SELECT COUNT(*) AS total FROM hero_slides');
      if (Number(counts[0]?.total) >= MAX_HERO_SLIDES) throw fail(400, 'You can upload a maximum of 5 hero slides.');
      const rows = await getSlides(connection);
      const sortOrder = rows.reduce((maximum, row) => Math.max(maximum, Number(row.sort_order)), 0) + 1;
      savedFile = await saveImage(req, req.file);
      const [result] = await connection.execute(
        `INSERT INTO hero_slides (image_path, image_mime, alt_text, link_url, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [savedFile, req.file.mimetype, fields.altText, fields.linkUrl, sortOrder, fields.isActive],
      );
      return {
        id: result.insertId,
        image_path: savedFile,
        image_mime: req.file.mimetype,
        alt_text: fields.altText,
        link_url: fields.linkUrl,
        sort_order: sortOrder,
        is_active: fields.isActive,
      };
    });
    return res.status(201).json({ data: toAdminHeroSlide(slide) });
  } catch (error) {
    if (savedFile) await removeImage(uploadDirectoryFor(req), savedFile);
    throw error;
  }
}));

adminRouter.put('/:id', parseUpload, asyncHandler(async (req, res) => {
  if (!validId.test(req.params.id)) throw fail(400, 'Invalid hero slide id.');
  if (req.file) validateFile(req.file);
  const fields = validatedFields(req.body);
  const database = databaseFor(req);
  const id = Number(req.params.id);
  let newFile;
  let previousFile;
  let slide;
  try {
    slide = await withTransaction(database, async (connection) => {
      const existing = await getSlide(connection, id, true);
      if (!existing) throw fail(404, 'Hero slide not found.');
      previousFile = existing.image_path;
      if (req.file) newFile = await saveImage(req, req.file);
      await connection.execute(
        `UPDATE hero_slides SET image_path = ?, image_mime = ?, alt_text = ?, link_url = ?, is_active = ?
         WHERE id = ?`,
        [newFile || existing.image_path, req.file?.mimetype || existing.image_mime, fields.altText, fields.linkUrl, fields.isActive, id],
      );
      return {
        ...existing,
        image_path: newFile || existing.image_path,
        image_mime: req.file?.mimetype || existing.image_mime,
        alt_text: fields.altText,
        link_url: fields.linkUrl,
        is_active: fields.isActive,
      };
    });
  } catch (error) {
    if (newFile) await removeImage(uploadDirectoryFor(req), newFile);
    throw error;
  }
  if (newFile) await removeImage(uploadDirectoryFor(req), previousFile);
  return res.json({ data: toAdminHeroSlide(slide) });
}));

adminRouter.delete('/:id', asyncHandler(async (req, res) => {
  if (!validId.test(req.params.id)) throw fail(400, 'Invalid hero slide id.');
  const database = databaseFor(req);
  const id = Number(req.params.id);
  const row = await withTransaction(database, async (connection) => {
    const existing = await getSlide(connection, id, true);
    if (!existing) throw fail(404, 'Hero slide not found.');
    await connection.execute('DELETE FROM hero_slides WHERE id = ?', [id]);
    const remaining = await getSlides(connection);
    for (let index = 0; index < remaining.length; index += 1) {
      await connection.execute('UPDATE hero_slides SET sort_order = ? WHERE id = ?', [index + 1, remaining[index].id]);
    }
    return existing;
  });
  await removeImage(uploadDirectoryFor(req), row.image_path);
  return res.status(204).end();
}));

adminRouter.patch('/reorder', asyncHandler(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_HERO_SLIDES
    || ids.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    || new Set(ids.map(Number)).size !== ids.length) {
    throw fail(400, 'Provide the ordered list of existing hero slide ids.');
  }
  const database = databaseFor(req);
  const rows = await withTransaction(database, async (connection) => {
    const current = await getSlides(connection);
    const currentIds = current.map((row) => Number(row.id));
    const orderedIds = ids.map(Number);
    if (currentIds.length !== orderedIds.length || currentIds.some((id) => !orderedIds.includes(id))) {
      throw fail(400, 'The reorder list must include every hero slide exactly once.');
    }
    for (let index = 0; index < orderedIds.length; index += 1) {
      await connection.execute('UPDATE hero_slides SET sort_order = ? WHERE id = ?', [index + 1, orderedIds[index]]);
    }
    return getSlides(connection);
  });
  return res.json({ data: rows.map(toAdminHeroSlide) });
}));

function requireHeroSlideAdmin(req, res, next) {
  if (req.cookies?.admin_session) return requireAdmin(req, res, next);
  if (req.cookies?.platform_session) {
    return requirePlatformUser(req, res, (error) => {
      if (error) return next(error);
      if (res.headersSent) return;
      return res.status(403).json({ error: 'Administrator access is required.' });
    });
  }
  return requireAdmin(req, res, next);
}

export { publicRouter as default, requireHeroSlideAdmin };
