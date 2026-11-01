import { z } from 'zod';
import { createEventSchema, partialEventSchema, toMysqlDateTime } from './eventInput.js';

export const ADMIN_EVENT_STATUSES = Object.freeze([
  'draft',
  'pending_approval',
  'active',
  'published',
  'booked',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
  'upcoming',
  'open',
]);
const bookingEligibleStatuses = new Set(['active', 'published', 'upcoming', 'open']);

export function isEventOpenForBookings(status) {
  return bookingEligibleStatuses.has(String(status ?? '').trim().toLowerCase());
}

export const adminEventListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(ADMIN_EVENT_STATUSES).optional(),
}).strict();

const fieldMap = Object.freeze({
  title: 'title',
  event_type: 'type',
  description: 'description',
  city: 'city',
  venue: 'venue',
  cover_image_url: 'coverImageUrl',
  gallery_images: 'galleryImages',
  start_date: 'startDate',
  end_date: 'endDate',
  budget: 'budget',
  capacity: 'capacity',
  guest_count: 'guestCount',
  notes: 'notes',
});

const eventFields = Object.keys(fieldMap);
const createAdminEventSchema = z.object({
  organizer_id: z.coerce.number().int().positive(),
  ...Object.fromEntries(eventFields.map((field) => [field, z.unknown().optional()])),
}).strict();
const editAdminEventSchema = z.object(
  Object.fromEntries(eventFields.map((field) => [field, z.unknown().optional()])),
).strict();

export function parseAdminEventInput(input, { partial = false } = {}) {
  const parsedInput = (partial ? editAdminEventSchema : createAdminEventSchema).safeParse(input ?? {});
  if (!parsedInput.success) return parsedInput;

  const { organizer_id: organizerId, ...eventInput } = parsedInput.data;
  const camelInput = Object.fromEntries(
    Object.entries(eventInput)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [fieldMap[field], value]),
  );
  const parsedEvent = (partial ? partialEventSchema : createEventSchema).safeParse(camelInput);
  if (!parsedEvent.success) return parsedEvent;

  const data = Object.fromEntries(
    Object.entries(parsedEvent.data).map(([field, value]) => [
      Object.keys(fieldMap).find((key) => fieldMap[key] === field),
      field === 'startDate' || field === 'endDate' ? toMysqlDateTime(value) : field === 'galleryImages' ? JSON.stringify(value) : value,
    ]),
  );
  if (organizerId !== undefined) data.organizer_id = organizerId;
  return { success: true, data };
}

export function hasScheduleOverlap(executor, { organizerId, startDate, endDate, excludingEventId = null }) {
  const exclusion = excludingEventId === null ? '' : ' AND id <> ?';
  return executor.execute(
    `SELECT id, title FROM events
     WHERE organizer_id = ?
       AND status NOT IN ('cancelled', 'completed')
       AND start_date < COALESCE(?, DATE_ADD(?, INTERVAL 1 SECOND))
       AND COALESCE(end_date, DATE_ADD(start_date, INTERVAL 1 SECOND)) > ?${exclusion}
     LIMIT 1`,
    [
      organizerId,
      endDate ? toMysqlDateTime(endDate) : null,
      toMysqlDateTime(startDate),
      toMysqlDateTime(startDate),
      ...(excludingEventId === null ? [] : [excludingEventId]),
    ],
  ).then(([rows]) => rows[0] || null);
}

export function resolveEventStatus(status) {
  return status === 'published' ? 'active' : status;
}

export function toEventLocalDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  return String(value).replace(' ', 'T').slice(0, 16);
}
