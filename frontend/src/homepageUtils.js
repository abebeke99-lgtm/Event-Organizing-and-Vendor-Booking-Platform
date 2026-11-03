const homepageStatistics = [
  { field: 'averageVendorRating', label: 'publicHomeAverageVendorRating', rating: true },
  { field: 'confirmedOrCompletedBookingCount', label: 'publicHomeConfirmedBookings' },
  { field: 'activeVendorCount', label: 'publicHomeActiveVendors' },
  { field: 'publishedEventCount', label: 'publicHomePublishedEvents' },
  { field: 'completedBookingCount', label: 'publicHomeCompletedBookings' },
];

function toNonNegativeNumber(value, { integer = false, maximum = Infinity } = {}) {
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum || (integer && !Number.isInteger(number))) {
    return null;
  }
  return number;
}

export function getHomepageStatistics(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return [];

  return homepageStatistics.flatMap(({ field, label, rating }) => {
    const value = toNonNegativeNumber(summary[field], {
      integer: !rating,
      maximum: rating ? 5 : Infinity,
    });
    return value === null ? [] : [{ label, value, rating: Boolean(rating) }];
  });
}

export function getHomepageCategoryCounts(category) {
  return {
    vendorCount: toNonNegativeNumber(category?.vendorCount, { integer: true }),
    serviceCount: toNonNegativeNumber(category?.serviceCount, { integer: true }),
  };
}

export function getHomepageCategoryTranslationKey(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim().toLowerCase();
  if (normalized.includes('wedding')) return 'publicHomeWeddingVenues';
  if (normalized.includes('corporate')) return 'publicHomeCorporate';
  if (normalized.includes('graduat')) return 'publicHomeGraduations';
  if (normalized.includes('cater')) return 'catering';
  if (normalized.includes('decor')) return 'publicHomeDecor';
  if (normalized.includes('photograph')) return 'publicHomePhotographer';
  if (normalized.includes('entertain')) return 'publicHomeEntertainment';
  if (normalized.includes('venue')) return 'publicHomeVenues';
  if (normalized.includes('transport')) return 'publicHomeTransportation';
  return null;
}
