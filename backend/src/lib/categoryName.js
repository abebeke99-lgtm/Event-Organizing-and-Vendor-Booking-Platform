export function isValidCategoryName(value) {
  const name = String(value ?? '').trim();
  return name.length >= 3
    && name.length <= 60
    && /\p{L}/u.test(name)
    && !/(.)\1{3,}/u.test(name);
}
