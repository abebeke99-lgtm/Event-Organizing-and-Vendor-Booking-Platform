import { z } from 'zod';

const requestSchema = z.object({
  event_id: z.number().int().positive().nullable(),
  event_title: z.string().trim().min(2).max(180),
  event_type: z.string().trim().max(80).nullable().optional(),
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  requested_location: z.string().trim().max(120).nullable().optional(),
  requester_name: z.string().trim().min(2).max(160),
  requester_email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  service_category: z.string().trim().max(80).nullable().optional(),
  guest_count: z.number().int().min(1).max(50000).nullable().optional(),
  budget: z.number().min(0).max(9999999999.99).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((request, context) => {
  if (!request.requested_date) return;
  const parsedDate = new Date(`${request.requested_date}:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 16) !== request.requested_date) {
    context.addIssue({ code: 'custom', path: ['requested_date'], message: 'Provide a real calendar date and time.' });
  }
});

export function parseEventPackageRequest(value) {
  return requestSchema.safeParse(value);
}