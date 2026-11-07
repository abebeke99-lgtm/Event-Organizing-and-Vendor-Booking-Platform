const COMPARE_KEY = 'eventhub:compare-vendors:v1';
const SERVICE_COMPARE_KEY = 'eventhub:compare-services:v1';
const RECENT_KEY = 'eventhub:recently-viewed:v1';
const MAX_COMPARE = 4;
const MAX_RECENT = 12;

function readList(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error(`Saved EventHub data for "${key}" is invalid.`);
  return value;
}

export function getComparedVendorIds(storage = window.localStorage) {
  return [...new Set(readList(storage, COMPARE_KEY).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
    .slice(0, MAX_COMPARE);
}

export function toggleComparedVendor(id, storage = window.localStorage) {
  const vendorId = Number(id);
  if (!Number.isSafeInteger(vendorId) || vendorId < 1) throw new Error('A valid vendor is required for comparison.');
  const current = getComparedVendorIds(storage);
  if (current.includes(vendorId)) {
    const ids = current.filter((entry) => entry !== vendorId);
    storage.setItem(COMPARE_KEY, JSON.stringify(ids));
    return { ids, added: false };
  }
  if (current.length >= MAX_COMPARE) return { ids: current, added: false, limitReached: true };
  const ids = [...current, vendorId];
  storage.setItem(COMPARE_KEY, JSON.stringify(ids));
  return { ids, added: true };
}

export function clearComparedVendors(storage = window.localStorage) {
  storage.removeItem(COMPARE_KEY);
}

export function getComparedServiceIds(storage = window.localStorage) {
  return [...new Set(readList(storage, SERVICE_COMPARE_KEY).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
    .slice(0, MAX_COMPARE);
}

export function toggleComparedService(id, storage = window.localStorage) {
  const serviceId = Number(id);
  if (!Number.isSafeInteger(serviceId) || serviceId < 1) throw new Error('A valid service is required for comparison.');
  const current = getComparedServiceIds(storage);
  if (current.includes(serviceId)) {
    const ids = current.filter((entry) => entry !== serviceId);
    storage.setItem(SERVICE_COMPARE_KEY, JSON.stringify(ids));
    return { ids, added: false };
  }
  if (current.length >= MAX_COMPARE) return { ids: current, added: false, limitReached: true };
  const ids = [...current, serviceId];
  storage.setItem(SERVICE_COMPARE_KEY, JSON.stringify(ids));
  return { ids, added: true };
}

export function clearComparedServices(storage = window.localStorage) {
  storage.removeItem(SERVICE_COMPARE_KEY);
}

export function recordRecentlyViewed(type, id, storage = window.localStorage) {
  if (!['event', 'vendor'].includes(type)) throw new Error('Only events and vendors can be added to recent history.');
  const recordId = Number(id);
  if (!Number.isSafeInteger(recordId) || recordId < 1) throw new Error('A valid listing is required for recent history.');
  const current = readList(storage, RECENT_KEY).filter((item) => item?.type !== type || Number(item.id) !== recordId);
  current.unshift({ type, id: recordId, viewedAt: Date.now() });
  storage.setItem(RECENT_KEY, JSON.stringify(current.slice(0, MAX_RECENT)));
}

export function getRecentlyViewed(storage = window.localStorage) {
  return readList(storage, RECENT_KEY).filter((item) =>
    ['event', 'vendor'].includes(item?.type)
    && Number.isSafeInteger(Number(item.id))
    && Number(item.id) > 0,
  ).slice(0, MAX_RECENT);
}

export function getCalendarMonthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
    endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
  };
}

export function getEventDateKey(value) {
  if (typeof value !== 'string' || !value) return '';
  return value.slice(0, 10);
}
