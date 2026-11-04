export function normalizeHeroSlides(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((slide) => Number.isSafeInteger(Number(slide?.id))
      && Number(slide.id) > 0
      && typeof slide.imageUrl === 'string'
      && slide.imageUrl.startsWith('/api/hero-slides/')
      && typeof slide.altText === 'string')
    .slice()
    .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder) || Number(left.id) - Number(right.id));
}

export function getNextHeroSlideIndex(index, count, direction = 1) {
  if (!Number.isInteger(count) || count < 1) return 0;
  return (index + direction + count) % count;
}

export function reorderHeroSlides(slides, index, direction) {
  if (!Array.isArray(slides) || !Number.isInteger(index)) return slides || [];
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= slides.length) return slides;
  const next = [...slides];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function validateHeroSlideFile(file) {
  if (!file) return 'Choose an image to upload.';
  const mimeExtensions = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
  };
  const extension = file.name?.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!mimeExtensions[file.type]?.includes(extension)) return 'Choose a matching JPG, PNG, or WebP image.';
  if (file.size > 5 * 1024 * 1024) return 'Hero images must be 5 MB or smaller.';
  return '';
}

export function validateHeroSlideLink(value) {
  if (!value) return '';
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\u0000-\u001f]/.test(value)) return '';
  try {
    if (new URL(value).protocol === 'https:') return '';
  } catch {
    return 'Enter an internal path or a valid HTTPS link.';
  }
  return 'Enter an internal path or a valid HTTPS link.';
}
