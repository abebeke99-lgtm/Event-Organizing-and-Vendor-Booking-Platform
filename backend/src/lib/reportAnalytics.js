import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const BOOKING_STATUSES = ['requested', 'quoted', 'accepted', 'rejected', 'under_review', 'completed', 'cancelled'];
const REPORT_STATUSES = {
  users: ['active', 'pending', 'suspended'],
  vendors: ['pending', 'under_review', 'information_requested', 'verified', 'rejected', 'suspended'],
  events: ['draft', 'pending_approval', 'active', 'published', 'booked', 'in_progress', 'completed', 'rejected', 'cancelled', 'upcoming', 'open'],
  bookings: BOOKING_STATUSES,
  payments: ['pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'refund_pending'],
  refunds: ['pending', 'processing', 'succeeded', 'failed', 'rejected'],
  categories: BOOKING_STATUSES,
  reviews: ['published', 'hidden', 'flagged'],
  complaints: ['open', 'under_review', 'investigating', 'resolved', 'closed', 'dismissed'],
  'vendor-performance': BOOKING_STATUSES,
  'booking-outcomes': ['completed', 'cancelled'],
};

export const reportQuerySchema = z.object({
  report: z.enum([
    'users',
    'vendors',
    'events',
    'bookings',
    'payments',
    'refunds',
    'revenue',
    'categories',
    'reviews',
    'complaints',
    'vendor-performance',
    'booking-outcomes',
  ]),
  period: z.enum(['today', 'last7', 'last30', 'monthly', 'yearly', 'custom']).default('last30'),
  startDate: dateOnly.optional(),
  endDate: dateOnly.optional(),
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  categoryId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  vendorId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  customerId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().trim().max(40).optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict().superRefine((query, context) => {
  if (query.period === 'custom' && (!query.startDate || !query.endDate)) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'A custom period requires both start and end dates.' });
  }
  for (const field of ['startDate', 'endDate']) {
    const value = query[field];
    if (!value) continue;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      context.addIssue({ code: 'custom', path: [field], message: `Enter a valid ${field === 'startDate' ? 'start' : 'end'} date.` });
    }
  }
  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date.' });
  }
  if (query.startDate && query.endDate) {
    const days = (Date.parse(`${query.endDate}T00:00:00Z`) - Date.parse(`${query.startDate}T00:00:00Z`)) / 86400000;
    if (days > 365) context.addIssue({ code: 'custom', path: ['endDate'], message: 'Custom report ranges cannot exceed 366 calendar days.' });
  }
  if (query.status && REPORT_STATUSES[query.report] && !REPORT_STATUSES[query.report].includes(query.status)) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Status is not supported for the selected report.' });
  }
  if (query.sortBy && REPORT_SORTS[query.report] && !Object.hasOwn(REPORT_SORTS[query.report], query.sortBy)) {
    context.addIssue({ code: 'custom', path: ['sortBy'], message: 'Sort field is not supported for the selected report.' });
  }
});

function datePartsAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function formatDate({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addCalendarDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localMidnightAsUtc(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const local = datePartsAt(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const next = desiredUtc - (representedUtc - candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate).toISOString().slice(0, 19).replace('T', ' ');
}

function getLocalDate(now, timeZone) {
  return formatDate(datePartsAt(now, timeZone));
}

export function resolveReportRange(query, {
  timeZone = 'Africa/Addis_Ababa',
  now = new Date(),
} = {}) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(now);
  } catch {
    throw Object.assign(new Error('The configured report timezone is invalid.'), { status: 500 });
  }

  const today = getLocalDate(now, timeZone);
  let startDate;
  let endDate = today;
  switch (query.period) {
    case 'today':
      startDate = today;
      break;
    case 'last7':
      startDate = addCalendarDays(today, -6);
      break;
    case 'last30':
      startDate = addCalendarDays(today, -29);
      break;
    case 'monthly': {
      const { year, month } = datePartsAt(now, timeZone);
      startDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
      break;
    }
    case 'yearly': {
      const { year } = datePartsAt(now, timeZone);
      startDate = `${String(year).padStart(4, '0')}-01-01`;
      break;
    }
    case 'custom':
      startDate = query.startDate;
      endDate = query.endDate;
      break;
    default:
      throw Object.assign(new Error('Unsupported report period.'), { status: 400 });
  }
  return {
    startDate,
    endDate,
    startAt: localMidnightAsUtc(startDate, timeZone),
    endAt: localMidnightAsUtc(addCalendarDays(endDate, 1), timeZone),
    timeZone,
    period: query.period,
  };
}

export function buildReportDateClause(column, range) {
  return {
    sql: `${column} >= CONVERT_TZ(?, '+00:00', @@session.time_zone)
      AND ${column} < CONVERT_TZ(?, '+00:00', @@session.time_zone)`,
    values: [range.startAt, range.endAt],
  };
}

export function calculateRevenueTotals(paymentRows, refundRows) {
  const totals = new Map();
  for (const row of paymentRows) {
    const currency = String(row.currency || '').toUpperCase();
    const current = totals.get(currency) || { currency, grossPayments: 0, refunds: 0, netRevenue: 0 };
    current.grossPayments += Number(row.gross_amount || 0);
    totals.set(currency, current);
  }
  for (const row of refundRows) {
    const currency = String(row.currency || '').toUpperCase();
    const current = totals.get(currency) || { currency, grossPayments: 0, refunds: 0, netRevenue: 0 };
    current.refunds += Number(row.refund_amount || 0);
    totals.set(currency, current);
  }
  for (const current of totals.values()) {
    current.netRevenue = current.grossPayments - current.refunds;
  }
  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

export const REPORT_SORTS = Object.freeze({
  users: { created_at: 'u.created_at', name: 'u.full_name', status: 'u.status', id: 'u.id' },
  vendors: { created_at: 'vp.created_at', name: 'vp.business_name', status: 'vp.verification_status', verified_at: 'vp.verified_at' },
  events: { created_at: 'e.created_at', published_at: 'e.published_at', title: 'e.title', status: 'e.status', start_date: 'e.start_date' },
  bookings: { created_at: 'b.created_at', status: 'b.status', vendor: 'vp.business_name', customer: 'customer.full_name', amount: 'b.quoted_amount' },
  payments: { created_at: 'p.created_at', status: 'p.status', amount: 'p.amount', currency: 'p.currency' },
  refunds: { created_at: 'r.created_at', status: 'r.status', amount: 'r.amount', currency: 'r.currency' },
  revenue: { period: 'period', currency: 'currency', gross: 'gross_payments', refunds: 'refund_amount', net: 'net_revenue' },
  categories: { category: 'category_name', bookings: 'total_bookings', completed: 'completed_bookings' },
  reviews: { created_at: 'r.created_at', rating: 'r.rating', vendor: 'vp.business_name', customer: 'customer.full_name' },
  complaints: { created_at: 'c.created_at', status: 'c.status', customer: 'customer.full_name' },
  'vendor-performance': { vendor: 'vp.business_name', bookings: 'total_bookings', completed: 'completed_bookings', rating: 'average_rating' },
  'booking-outcomes': { outcome_at: 'outcome_at', status: 'b.status', vendor: 'vp.business_name', customer: 'customer.full_name' },
});
