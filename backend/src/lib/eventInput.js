import { z } from 'zod';

function isValidLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const date = new Date(year, month - 1, day, hour, minute, second);

  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
    && date.getSeconds() === second;
}

const dateTimeSchema = z.string()
  .trim()
  .min(1)
  .max(30)
  .refine(isValidLocalDateTime, 'Enter a valid local event date.');

const optionalAmount = (maximum) => z.preprocess(
  (value) => typeof value === 'string' && !value.trim() || value === undefined || value === null
    ? null
    : value,
  z.union([z.null(), z.coerce.number().finite().min(0).max(maximum)]),
);

export const createEventSchema = z.object({
  title: z.string().trim().min(2).max(180),
  type: z.string().trim().min(2).max(80),
  city: z.string().trim().max(120).optional().default(''),
  startDate: dateTimeSchema,
  endDate: z.preprocess(
    (value) => value === '' || value === undefined || value === null ? null : value,
    dateTimeSchema.nullish(),
  ).default(null),
  budget: optionalAmount(100000000).optional().default(null),
  guestCount: z.preprocess(
    (value) => value === '' || value === undefined || value === null ? null : value,
    z.union([z.coerce.number().int().positive().max(100000), z.null()]),
  ).optional().default(null),
  notes: z.string().trim().max(2000).optional().default(''),
}).superRefine((event, context) => {
  if (event.endDate && Date.parse(event.endDate) <= Date.parse(event.startDate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'Event end date must be after its start date.',
    });
  }
});

export function toMysqlDateTime(value) {
  if (!value) return null;
  const normalized = value.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}
