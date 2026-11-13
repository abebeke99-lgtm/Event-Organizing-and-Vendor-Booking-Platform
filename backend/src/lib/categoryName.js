export function isValidCategoryName(value) {
  const name = String(value ?? '').trim();
  return name.length >= 3
    && name.length <= 60
    && /\p{L}/u.test(name)
    && !/(.)\1{3,}/u.test(name);
}

const generatedTestCategory = /^(?:customer payment detail|dashboard|marketplace|neon booking category)\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\s+(?:category|services))?$/i;

export function isPublicCategoryName(value) {
  const name = String(value ?? '').trim();
  return isValidCategoryName(name) && !generatedTestCategory.test(name);
}
