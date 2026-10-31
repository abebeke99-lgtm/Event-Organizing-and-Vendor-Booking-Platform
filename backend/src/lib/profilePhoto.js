export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateProfilePhoto(mimeType, photo) {
  if (!PROFILE_PHOTO_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: 'Choose a JPG, PNG, or WebP image.' };
  }
  if (!Buffer.isBuffer(photo) || photo.length === 0) {
    return { valid: false, error: 'Choose an image to upload.' };
  }
  if (photo.length > MAX_PROFILE_PHOTO_BYTES) {
    return { valid: false, error: 'Profile photos must be 5 MB or smaller.' };
  }

  const isJpeg = mimeType === 'image/jpeg'
    && photo.length >= 3
    && photo[0] === 0xff
    && photo[1] === 0xd8
    && photo[2] === 0xff;
  const isPng = mimeType === 'image/png'
    && photo.length >= 8
    && photo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = mimeType === 'image/webp'
    && photo.length >= 12
    && photo.toString('ascii', 0, 4) === 'RIFF'
    && photo.toString('ascii', 8, 12) === 'WEBP';

  return isJpeg || isPng || isWebp
    ? { valid: true }
    : { valid: false, error: 'The selected file does not match its image format.' };
}

export async function getProfilePhoto(database, userId, res) {
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const [[photo]] = await database.execute(
    'SELECT profile_photo, profile_photo_mime FROM users WHERE id = ?',
    [userId],
  );
  if (!photo?.profile_photo) return res.status(204).end();

  res.set({
    'Content-Disposition': 'inline',
    'Content-Type': photo.profile_photo_mime,
  });
  return res.send(photo.profile_photo);
}

export async function saveProfilePhoto(database, userId, req, res) {
  const mimeType = req.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const validation = validateProfilePhoto(mimeType, req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });

  await database.execute(
    'UPDATE users SET profile_photo = ?, profile_photo_mime = ? WHERE id = ?',
    [req.body, mimeType, userId],
  );
  return res.json({ message: 'Profile photo saved.' });
}

export async function removeProfilePhoto(database, userId, res) {
  await database.execute(
    'UPDATE users SET profile_photo = NULL, profile_photo_mime = NULL WHERE id = ?',
    [userId],
  );
  return res.status(204).end();
}

export function profilePhotoUploadParser(express) {
  return express.raw({
    type: [...PROFILE_PHOTO_MIME_TYPES],
    limit: MAX_PROFILE_PHOTO_BYTES,
  });
}
