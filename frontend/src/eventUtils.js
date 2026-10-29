const EVENT_TIME_ZONE = 'Africa/Addis_Ababa';

function parseDatabaseDate(value) {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEventDate(value, language = 'en') {
  const date = parseDatabaseDate(value);
  if (!date) return null;
  const locale = language === 'am' ? 'am-ET-u-ca-gregory' : 'en-ET';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: EVENT_TIME_ZONE }).format(date);
}

export function formatEventBudget(value, language = 'en') {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const locale = language === 'am' ? 'am-ET' : 'en-ET';
  return `ETB ${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount)}`;
}