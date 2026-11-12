import { Router } from 'express';
import { z } from 'zod';
import { normalizeDatabaseAdapter } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const idSchema = z.coerce.number().int().positive();
const amountSchema = z.coerce.number().finite().min(0).max(100000000);
const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  budgetLimit: amountSchema,
}).strict();
const expenseSchema = z.object({
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  bookingId: z.coerce.number().int().positive().nullable().optional(),
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().min(2).max(255),
  plannedAmount: amountSchema.nullable().optional(),
  actualAmount: amountSchema.nullable().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.plannedAmount == null && value.actualAmount == null) {
    context.addIssue({ code: 'custom', message: 'Enter a planned amount or an actual expense.' });
  }
  if (value.expenseDate) {
    const date = new Date(`${value.expenseDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.expenseDate) {
      context.addIssue({ code: 'custom', path: ['expenseDate'], message: 'Enter a valid expense date.' });
    }
  }
});
const taskSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(160),
  details: z.string().trim().max(2000).optional().default(''),
  dueAt: z.string().trim().max(32).nullable().optional(),
}).strict();
const taskUpdateSchema = taskSchema.omit({ bookingId: true }).extend({
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
}).strict();

function invalidDateTime(value) {
  return value && Number.isNaN(Date.parse(value));
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status, expose: true });
}

async function ownedEvent(database, organizerId, eventId) {
  const result = await database.query(
    'SELECT id, title, budget, start_date, end_date FROM events WHERE id = $1 AND organizer_id = $2 LIMIT 1',
    [eventId, organizerId],
  );
  return result.rows[0] || null;
}

async function audit(database, req, { actorId, action, entityId, details }) {
  await database.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, request_id)
     VALUES ($1, $2, 'event', $3, $4::jsonb, $5, $6)`,
    [actorId, action, String(entityId), JSON.stringify(details || {}), req.ip || null, req.requestId || null],
  );
}

async function notify(database, { userId, title, message, relatedId, actorId, idempotencyKey }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  const result = await database.query(
    `INSERT INTO notifications
       (user_id, title, message, notification_type, related_entity_type, related_entity_id,
        idempotency_key, delivery_channel, delivery_status)
     VALUES ($1, $2, $3, 'event', 'event', $4, $5, 'in_app', 'delivered')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [userId, title, message, String(relatedId), idempotencyKey],
  );
  if (result.rows[0]) {
    await database.query(
      `INSERT INTO notification_history (notification_id, actor_id, action, details)
       VALUES ($1, $2, 'created', $3::jsonb)`,
      [result.rows[0].id, actorId, JSON.stringify({ source: 'event', channel: 'in_app' })],
    );
  }
}

async function validateExpenseRelations(database, organizerId, eventId, expense) {
  if (expense.categoryId) {
    const category = await database.query(
      'SELECT id FROM event_budget_categories WHERE id = $1 AND event_id = $2',
      [expense.categoryId, eventId],
    );
    if (!category.rows.length) return 'Budget category not found.';
  }
  if (expense.bookingId) {
    const booking = await database.query(
      `SELECT b.id, b.vendor_id FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.id = $1 AND b.event_id = $2 AND e.organizer_id = $3 LIMIT 1`,
      [expense.bookingId, eventId, organizerId],
    );
    if (!booking.rows[0]) return 'Booking not found for this event.';
    if (expense.vendorId && Number(expense.vendorId) !== Number(booking.rows[0].vendor_id)) {
      return 'Vendor must match the selected booking.';
    }
    expense.vendorId = Number(booking.rows[0].vendor_id);
  } else if (expense.vendorId) {
    const vendor = await database.query(
      `SELECT id FROM vendor_profiles
       WHERE id = $1 AND verification_status = 'verified'`,
      [expense.vendorId],
    );
    if (!vendor.rows.length) return 'Verified vendor not found.';
  }
  return null;
}

export function createPostgresOrganizerPlanningRouter({ database }) {
  const normalizedDatabase = normalizeDatabaseAdapter(database);
  if (!normalizedDatabase || typeof normalizedDatabase.query !== 'function') {
    throw new TypeError('A PostgreSQL database adapter is required.');
  }
  const router = Router();

  router.get('/overview', asyncHandler(async (req, res) => {
    if (req.platformUser?.role !== 'organizer') {
      return res.status(403).json({ error: 'Organizer access is required.' });
    }
    const result = await database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM events e WHERE e.organizer_id = $1) AS total_events,
         (SELECT COUNT(*)::int FROM events e
          WHERE e.organizer_id = $1 AND e.start_date >= NOW()
            AND e.status NOT IN ('cancelled', 'completed')) AS upcoming_events,
         (SELECT COUNT(*)::int FROM events e
          WHERE e.organizer_id = $1
            AND (e.status = 'in_progress' OR (e.start_date <= NOW() AND e.end_date >= NOW()))
            AND e.status NOT IN ('cancelled', 'completed')) AS ongoing_events,
         (SELECT COALESCE(SUM(e.budget), 0) FROM events e
          WHERE e.organizer_id = $1) AS allocated_budget,
         (SELECT COUNT(*)::int FROM bookings b
          JOIN events e ON e.id = b.event_id WHERE e.organizer_id = $1) AS total_bookings,
         (SELECT COUNT(*)::int FROM bookings b JOIN events e ON e.id = b.event_id
          WHERE e.organizer_id = $1 AND b.status IN ('requested', 'under_review', 'quoted')) AS pending_bookings,
         (SELECT COUNT(*)::int FROM bookings b JOIN events e ON e.id = b.event_id
          WHERE e.organizer_id = $1 AND b.status IN ('accepted', 'confirmed', 'in_progress')) AS confirmed_bookings,
         (SELECT COUNT(*)::int FROM bookings b JOIN events e ON e.id = b.event_id
          WHERE e.organizer_id = $1 AND b.status = 'completed') AS completed_bookings,
         (SELECT COALESCE(SUM(x.planned_amount), 0) FROM event_expenses x
          JOIN events e ON e.id = x.event_id WHERE e.organizer_id = $1) AS planned_expenses,
         (SELECT COALESCE(SUM(x.actual_amount), 0) FROM event_expenses x
          JOIN events e ON e.id = x.event_id WHERE e.organizer_id = $1) AS actual_expenses,
         (SELECT COUNT(*)::int FROM messages m
          JOIN bookings b ON b.id = m.booking_id
          JOIN events e ON e.id = b.event_id
          WHERE e.organizer_id = $1 AND m.recipient_id = $1 AND m.read_at IS NULL) AS unread_messages,
         (SELECT COUNT(*)::int FROM notifications n
          WHERE n.user_id = $1 AND n.status <> 'read') AS unread_notifications`,
      [req.platformUser.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('PostgreSQL organizer overview query returned no result.');
    const allocated = Number(row.allocated_budget || 0);
    const actual = Number(row.actual_expenses || 0);
    return res.json({ data: {
      totalEvents: Number(row.total_events || 0),
      upcomingEvents: Number(row.upcoming_events || 0),
      ongoingEvents: Number(row.ongoing_events || 0),
      totalBookings: Number(row.total_bookings || 0),
      pendingBookings: Number(row.pending_bookings || 0),
      confirmedBookings: Number(row.confirmed_bookings || 0),
      completedBookings: Number(row.completed_bookings || 0),
      budget: {
        allocated,
        plannedExpenses: Number(row.planned_expenses || 0),
        actualExpenses: actual,
        remaining: allocated - actual,
      },
      unreadMessages: Number(row.unread_messages || 0),
      unreadNotifications: Number(row.unread_notifications || 0),
    } });
  }));

  router.get('/events/:eventId/budget', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    if (!eventId.success) return res.status(400).json({ error: 'A valid event ID is required.' });
    const event = await ownedEvent(database, req.platformUser.id, eventId.data);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const [categoryResult, expenseResult] = await Promise.all([
      database.query(
        `SELECT id, name, budget_limit, created_at, updated_at
         FROM event_budget_categories WHERE event_id = $1 ORDER BY name`,
        [eventId.data],
      ),
      database.query(
        `SELECT x.id, x.category_id, x.booking_id, x.vendor_id, x.description,
                x.planned_amount, x.actual_amount, x.expense_date, x.created_at,
                c.name AS category_name, vp.business_name AS vendor_name
         FROM event_expenses x
         LEFT JOIN event_budget_categories c ON c.id = x.category_id
         LEFT JOIN vendor_profiles vp ON vp.id = x.vendor_id
         WHERE x.event_id = $1 ORDER BY x.expense_date DESC NULLS LAST, x.id DESC`,
        [eventId.data],
      ),
    ]);
    const categories = categoryResult.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      budgetLimit: Number(row.budget_limit),
    }));
    const expenses = expenseResult.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      categoryId: row.category_id === null ? null : Number(row.category_id),
      bookingId: row.booking_id === null ? null : Number(row.booking_id),
      vendorId: row.vendor_id === null ? null : Number(row.vendor_id),
      plannedAmount: row.planned_amount === null ? null : Number(row.planned_amount),
      actualAmount: row.actual_amount === null ? null : Number(row.actual_amount),
      expenseDate: row.expense_date,
    }));
    const planned = expenses.reduce((sum, expense) => sum + (expense.plannedAmount || 0), 0);
    const actual = expenses.reduce((sum, expense) => sum + (expense.actualAmount || 0), 0);
    const budget = Number(event.budget || 0);
    return res.json({
      data: {
        event: { id: Number(event.id), title: event.title, budget },
        categories,
        expenses,
        summary: { planned, actual, remaining: budget - actual },
      },
    });
  }));

  router.post('/events/:eventId/budget/categories', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const parsed = categorySchema.safeParse(req.body || {});
    if (!eventId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Budget category details are invalid.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    try {
      const result = await database.query(
        `INSERT INTO event_budget_categories (event_id, name, budget_limit)
         VALUES ($1, $2, $3) RETURNING id`,
        [eventId.data, parsed.data.name, parsed.data.budgetLimit],
      );
      return res.status(201).json({ data: { id: Number(result.rows[0].id), ...parsed.data } });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That budget category already exists for this event.' });
      }
      throw error;
    }
  }));

  router.patch('/events/:eventId/budget/categories/:categoryId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const categoryId = idSchema.safeParse(req.params.categoryId);
    const parsed = categorySchema.safeParse(req.body || {});
    if (!eventId.success || !categoryId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Budget category details are invalid.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    try {
      const result = await database.query(
        `UPDATE event_budget_categories SET name = $1, budget_limit = $2
         WHERE id = $3 AND event_id = $4 RETURNING id`,
        [parsed.data.name, parsed.data.budgetLimit, categoryId.data, eventId.data],
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Budget category not found.' });
      return res.json({ data: { id: categoryId.data, ...parsed.data } });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That budget category already exists for this event.' });
      }
      throw error;
    }
  }));

  router.delete('/events/:eventId/budget/categories/:categoryId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const categoryId = idSchema.safeParse(req.params.categoryId);
    if (!eventId.success || !categoryId.success) {
      return res.status(400).json({ error: 'A valid event and category ID are required.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const usage = await database.query(
      'SELECT COUNT(*) AS total FROM event_expenses WHERE event_id = $1 AND category_id = $2',
      [eventId.data, categoryId.data],
    );
    if (Number(usage.rows[0]?.total || 0)) {
      return res.status(409).json({ error: 'Move or remove expenses in this category before deleting it.' });
    }
    const result = await database.query(
      'DELETE FROM event_budget_categories WHERE id = $1 AND event_id = $2 RETURNING id',
      [categoryId.data, eventId.data],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Budget category not found.' });
    return res.status(204).end();
  }));

  router.post('/events/:eventId/expenses', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const parsed = expenseSchema.safeParse(req.body || {});
    if (!eventId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Expense details are invalid.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const expense = { ...parsed.data };
    const relationError = await validateExpenseRelations(database, req.platformUser.id, eventId.data, expense);
    if (relationError) return res.status(400).json({ error: relationError });
    const result = await database.query(
      `INSERT INTO event_expenses
         (event_id, category_id, booking_id, vendor_id, description, planned_amount,
          actual_amount, expense_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [eventId.data, expense.categoryId || null, expense.bookingId || null, expense.vendorId || null,
        expense.description, expense.plannedAmount ?? null, expense.actualAmount ?? null,
        expense.expenseDate || null, req.platformUser.id],
    );
    return res.status(201).json({
      data: { id: Number(result.rows[0].id), eventId: eventId.data, ...expense },
    });
  }));

  router.patch('/events/:eventId/expenses/:expenseId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const expenseId = idSchema.safeParse(req.params.expenseId);
    const parsed = expenseSchema.safeParse(req.body || {});
    if (!eventId.success || !expenseId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Expense details are invalid.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const expense = { ...parsed.data };
    const relationError = await validateExpenseRelations(database, req.platformUser.id, eventId.data, expense);
    if (relationError) return res.status(400).json({ error: relationError });
    const result = await database.query(
      `UPDATE event_expenses
       SET category_id = $1, booking_id = $2, vendor_id = $3, description = $4,
           planned_amount = $5, actual_amount = $6, expense_date = $7
       WHERE id = $8 AND event_id = $9 RETURNING id`,
      [expense.categoryId || null, expense.bookingId || null, expense.vendorId || null,
        expense.description, expense.plannedAmount ?? null, expense.actualAmount ?? null,
        expense.expenseDate || null, expenseId.data, eventId.data],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found.' });
    return res.json({ data: { id: expenseId.data, eventId: eventId.data, ...expense } });
  }));

  router.delete('/events/:eventId/expenses/:expenseId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const expenseId = idSchema.safeParse(req.params.expenseId);
    if (!eventId.success || !expenseId.success) {
      return res.status(400).json({ error: 'A valid event and expense ID are required.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const result = await database.query(
      'DELETE FROM event_expenses WHERE id = $1 AND event_id = $2 RETURNING id',
      [expenseId.data, eventId.data],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found.' });
    return res.status(204).end();
  }));

  router.get('/events/:eventId/tasks', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    if (!eventId.success) return res.status(400).json({ error: 'A valid event ID is required.' });
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const result = await database.query(
      `SELECT t.id, t.booking_id, t.title, t.details, t.due_at, t.status, t.created_at, t.updated_at,
              b.service_description, vp.business_name AS vendor_name
       FROM event_vendor_tasks t
       JOIN bookings b ON b.id = t.booking_id
       JOIN vendor_profiles vp ON vp.id = b.vendor_id
       WHERE t.event_id = $1 ORDER BY t.due_at NULLS LAST, t.id DESC`,
      [eventId.data],
    );
    return res.json({
      data: result.rows.map((row) => ({ ...row, id: Number(row.id), bookingId: Number(row.booking_id) })),
    });
  }));

  router.post('/events/:eventId/tasks', asyncHandler(async (req, res) => {
    if (typeof database.inTransaction !== 'function') {
      throw new TypeError('A transactional PostgreSQL database adapter is required for organizer tasks.');
    }
    const eventId = idSchema.safeParse(req.params.eventId);
    const parsed = taskSchema.safeParse(req.body || {});
    if (!eventId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task details are invalid.' });
    }
    if (invalidDateTime(parsed.data.dueAt)) return res.status(400).json({ error: 'Enter a valid task deadline.' });
    const event = await ownedEvent(database, req.platformUser.id, eventId.data);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const bookingResult = await database.query(
      `SELECT b.id, b.status, vp.user_id AS vendor_user_id, vp.business_name
       FROM bookings b JOIN vendor_profiles vp ON vp.id = b.vendor_id
       WHERE b.id = $1 AND b.event_id = $2 LIMIT 1`,
      [parsed.data.bookingId, eventId.data],
    );
    const booking = bookingResult.rows[0];
    if (!booking || ['cancelled', 'rejected'].includes(booking.status)) {
      return res.status(404).json({ error: 'Active vendor booking not found for this event.' });
    }
    const task = await database.inTransaction(async (transaction) => {
      const inserted = await transaction.query(
        `INSERT INTO event_vendor_tasks (event_id, booking_id, title, details, due_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [eventId.data, booking.id, parsed.data.title, parsed.data.details || null,
          parsed.data.dueAt || null, req.platformUser.id],
      );
      const id = Number(inserted.rows[0].id);
      await notify(transaction, {
        userId: booking.vendor_user_id,
        title: 'Event preparation task',
        message: `${event.title}: ${parsed.data.title}`,
        relatedId: eventId.data,
        actorId: req.platformUser.id,
        idempotencyKey: `organizer-task:${id}`,
      });
      await audit(transaction, req, {
        actorId: req.platformUser.id,
        action: 'organizer.vendor_task_created',
        entityId: eventId.data,
        details: { taskId: id, bookingId: Number(booking.id) },
      });
      return id;
    });
    return res.status(201).json({
      data: {
        id: task,
        eventId: eventId.data,
        ...parsed.data,
        status: 'pending',
        vendorName: booking.business_name,
      },
    });
  }));

  router.patch('/events/:eventId/tasks/:taskId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const taskId = idSchema.safeParse(req.params.taskId);
    const parsed = taskUpdateSchema.safeParse(req.body || {});
    if (!eventId.success || !taskId.success || !parsed.success) {
      return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task details are invalid.' });
    }
    if (invalidDateTime(parsed.data.dueAt)) return res.status(400).json({ error: 'Enter a valid task deadline.' });
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const result = await database.query(
      `UPDATE event_vendor_tasks
       SET title = $1, details = $2, due_at = $3, status = $4
       WHERE id = $5 AND event_id = $6 RETURNING id`,
      [parsed.data.title, parsed.data.details || null, parsed.data.dueAt || null,
        parsed.data.status, taskId.data, eventId.data],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Vendor task not found.' });
    return res.json({ data: { id: taskId.data, eventId: eventId.data, ...parsed.data } });
  }));

  router.delete('/events/:eventId/tasks/:taskId', asyncHandler(async (req, res) => {
    const eventId = idSchema.safeParse(req.params.eventId);
    const taskId = idSchema.safeParse(req.params.taskId);
    if (!eventId.success || !taskId.success) {
      return res.status(400).json({ error: 'A valid event and task ID are required.' });
    }
    if (!await ownedEvent(database, req.platformUser.id, eventId.data)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const result = await database.query(
      'DELETE FROM event_vendor_tasks WHERE id = $1 AND event_id = $2 RETURNING id',
      [taskId.data, eventId.data],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Vendor task not found.' });
    return res.status(204).end();
  }));

  return router;
}
