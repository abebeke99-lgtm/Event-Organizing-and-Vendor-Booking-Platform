import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createNotification } from '../lib/notificationService.js';
import { hashToken, writeAudit } from '../lib/security.js';
import { isStrongPassword } from '../lib/authFlow.js';

const router = Router();
const databaseFor = (req) => req.app?.locals?.database || pool;
const idSchema = z.coerce.number().int().positive();
const amountSchema = z.coerce.number().finite().min(0).max(100000000);

async function ownedEvent(database, organizerId, eventId) {
  const [rows] = await database.execute(
    'SELECT id, title, budget, start_date, end_date FROM events WHERE id = ? AND organizer_id = ? LIMIT 1',
    [eventId, organizerId],
  );
  return rows[0] || null;
}

function dateIsValid(value) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function inTransaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.get('/overview', asyncHandler(async (req, res) => {
  const database = databaseFor(req);
  const organizerId = req.platformUser.id;
  const [[eventStats]] = await database.execute(
    `SELECT COUNT(*) AS total_events,
            SUM(start_date >= NOW() AND status NOT IN ('cancelled', 'completed')) AS upcoming_events,
            SUM((status = 'in_progress' OR (start_date <= NOW() AND end_date >= NOW()))
                AND status NOT IN ('cancelled', 'completed')) AS ongoing_events,
            COALESCE(SUM(budget), 0) AS allocated_budget
     FROM events WHERE organizer_id = ?`,
    [organizerId],
  );
  const [[bookingStats]] = await database.execute(
    `SELECT COUNT(*) AS total_bookings,
            SUM(status IN ('requested', 'under_review', 'quoted')) AS pending_bookings,
            SUM(status IN ('accepted', 'confirmed', 'in_progress')) AS confirmed_bookings,
            SUM(status = 'completed') AS completed_bookings
     FROM bookings b JOIN events e ON e.id = b.event_id WHERE e.organizer_id = ?`,
    [organizerId],
  );
  const [[expenseStats]] = await database.execute(
    `SELECT COALESCE(SUM(x.planned_amount), 0) AS planned_expenses,
            COALESCE(SUM(x.actual_amount), 0) AS actual_expenses
     FROM event_expenses x JOIN events e ON e.id = x.event_id WHERE e.organizer_id = ?`,
    [organizerId],
  );
  const [[messageStats]] = await database.execute(
    `SELECT COUNT(*) AS unread_messages FROM messages m
     JOIN bookings b ON b.id = m.booking_id
     JOIN events e ON e.id = b.event_id
     WHERE e.organizer_id = ? AND m.recipient_id = ? AND m.read_at IS NULL`,
    [organizerId, organizerId],
  );
  const [[notificationStats]] = await database.execute(
    "SELECT COUNT(*) AS unread_notifications FROM notifications WHERE user_id = ? AND status <> 'read'",
    [organizerId],
  );
  const allocated = Number(eventStats?.allocated_budget || 0);
  const actual = Number(expenseStats?.actual_expenses || 0);
  return res.json({ data: {
    totalEvents: Number(eventStats?.total_events || 0),
    upcomingEvents: Number(eventStats?.upcoming_events || 0),
    ongoingEvents: Number(eventStats?.ongoing_events || 0),
    totalBookings: Number(bookingStats?.total_bookings || 0),
    pendingBookings: Number(bookingStats?.pending_bookings || 0),
    confirmedBookings: Number(bookingStats?.confirmed_bookings || 0),
    completedBookings: Number(bookingStats?.completed_bookings || 0),
    budget: {
      allocated,
      plannedExpenses: Number(expenseStats?.planned_expenses || 0),
      actualExpenses: actual,
      remaining: allocated - actual,
    },
    unreadMessages: Number(messageStats?.unread_messages || 0),
    unreadNotifications: Number(notificationStats?.unread_notifications || 0),
  } });
}));

router.get('/events/:eventId/budget', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  if (!eventId.success) return res.status(400).json({ error: 'A valid event ID is required.' });
  const database = databaseFor(req);
  const event = await ownedEvent(database, req.platformUser.id, eventId.data);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  const [categoryRows] = await database.execute(
    'SELECT id, name, budget_limit, created_at, updated_at FROM event_budget_categories WHERE event_id = ? ORDER BY name',
    [eventId.data],
  );
  const [expenseRows] = await database.execute(
    `SELECT x.id, x.category_id, x.booking_id, x.vendor_id, x.description,
            x.planned_amount, x.actual_amount, x.expense_date, x.created_at,
            c.name AS category_name, vp.business_name AS vendor_name
     FROM event_expenses x
     LEFT JOIN event_budget_categories c ON c.id = x.category_id
     LEFT JOIN vendor_profiles vp ON vp.id = x.vendor_id
     WHERE x.event_id = ? ORDER BY x.expense_date DESC, x.id DESC`,
    [eventId.data],
  );
  const categories = categoryRows.map((row) => ({
    ...row,
    id: Number(row.id),
    budgetLimit: Number(row.budget_limit),
  }));
  const expenses = expenseRows.map((row) => ({
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
  res.json({ data: {
    event: { id: Number(event.id), title: event.title, budget: Number(event.budget || 0) },
    categories,
    expenses,
    summary: { planned, actual, remaining: Number(event.budget || 0) - actual },
  } });
}));

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  budgetLimit: amountSchema,
}).strict();

router.post('/events/:eventId/budget/categories', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const parsed = categorySchema.safeParse(req.body || {});
  if (!eventId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Budget category details are invalid.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  try {
    const [result] = await database.execute(
      'INSERT INTO event_budget_categories (event_id, name, budget_limit) VALUES (?, ?, ?)',
      [eventId.data, parsed.data.name, parsed.data.budgetLimit],
    );
    await writeAudit(database, {
      actorId: req.platformUser.id,
      action: 'organizer.budget_category_created',
      entityType: 'event',
      entityId: eventId.data,
      details: { categoryId: Number(result.insertId), name: parsed.data.name },
      ip: req.ip,
    });
    return res.status(201).json({ data: { id: Number(result.insertId), ...parsed.data } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That budget category already exists for this event.' });
    throw error;
  }
}));

router.patch('/events/:eventId/budget/categories/:categoryId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const categoryId = idSchema.safeParse(req.params.categoryId);
  const parsed = categorySchema.safeParse(req.body || {});
  if (!eventId.success || !categoryId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Budget category details are invalid.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [result] = await database.execute(
    'UPDATE event_budget_categories SET name = ?, budget_limit = ? WHERE id = ? AND event_id = ?',
    [parsed.data.name, parsed.data.budgetLimit, categoryId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Budget category not found.' });
  res.json({ data: { id: categoryId.data, ...parsed.data } });
}));

router.delete('/events/:eventId/budget/categories/:categoryId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const categoryId = idSchema.safeParse(req.params.categoryId);
  if (!eventId.success || !categoryId.success) return res.status(400).json({ error: 'A valid event and category ID are required.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [[usage]] = await database.execute(
    'SELECT COUNT(*) AS total FROM event_expenses WHERE event_id = ? AND category_id = ?',
    [eventId.data, categoryId.data],
  );
  if (Number(usage?.total || 0)) return res.status(409).json({ error: 'Move or remove expenses in this category before deleting it.' });
  const [result] = await database.execute(
    'DELETE FROM event_budget_categories WHERE id = ? AND event_id = ?',
    [categoryId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Budget category not found.' });
  res.status(204).end();
}));

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
  if (value.expenseDate && !dateIsValid(value.expenseDate)) {
    context.addIssue({ code: 'custom', path: ['expenseDate'], message: 'Enter a valid expense date.' });
  }
});

async function validateExpenseRelations(database, organizerId, eventId, expense) {
  if (expense.categoryId) {
    const [categories] = await database.execute(
      'SELECT id FROM event_budget_categories WHERE id = ? AND event_id = ?',
      [expense.categoryId, eventId],
    );
    if (!categories.length) return 'Budget category not found.';
  }
  if (expense.bookingId) {
    const [bookings] = await database.execute(
      `SELECT b.id, b.vendor_id FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.id = ? AND b.event_id = ? AND e.organizer_id = ? LIMIT 1`,
      [expense.bookingId, eventId, organizerId],
    );
    if (!bookings.length) return 'Booking not found for this event.';
    if (expense.vendorId && Number(expense.vendorId) !== Number(bookings[0].vendor_id)) return 'Vendor must match the selected booking.';
    expense.vendorId = Number(bookings[0].vendor_id);
  } else if (expense.vendorId) {
    const [vendors] = await database.execute('SELECT id FROM vendor_profiles WHERE id = ? AND verification_status = \'verified\'', [expense.vendorId]);
    if (!vendors.length) return 'Verified vendor not found.';
  }
  return null;
}

router.post('/events/:eventId/expenses', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const parsed = expenseSchema.safeParse(req.body || {});
  if (!eventId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Expense details are invalid.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const expense = { ...parsed.data };
  const relationError = await validateExpenseRelations(database, req.platformUser.id, eventId.data, expense);
  if (relationError) return res.status(400).json({ error: relationError });
  const [result] = await database.execute(
    `INSERT INTO event_expenses
       (event_id, category_id, booking_id, vendor_id, description, planned_amount, actual_amount, expense_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId.data, expense.categoryId || null, expense.bookingId || null, expense.vendorId || null,
      expense.description, expense.plannedAmount ?? null, expense.actualAmount ?? null, expense.expenseDate || null, req.platformUser.id],
  );
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'organizer.expense_created',
    entityType: 'event',
    entityId: eventId.data,
    details: { expenseId: Number(result.insertId), categoryId: expense.categoryId || null },
    ip: req.ip,
  });
  res.status(201).json({ data: { id: Number(result.insertId), eventId: eventId.data, ...expense } });
}));

router.patch('/events/:eventId/expenses/:expenseId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const expenseId = idSchema.safeParse(req.params.expenseId);
  const parsed = expenseSchema.safeParse(req.body || {});
  if (!eventId.success || !expenseId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Expense details are invalid.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const expense = { ...parsed.data };
  const relationError = await validateExpenseRelations(database, req.platformUser.id, eventId.data, expense);
  if (relationError) return res.status(400).json({ error: relationError });
  const [result] = await database.execute(
    `UPDATE event_expenses SET category_id = ?, booking_id = ?, vendor_id = ?, description = ?,
       planned_amount = ?, actual_amount = ?, expense_date = ? WHERE id = ? AND event_id = ?`,
    [expense.categoryId || null, expense.bookingId || null, expense.vendorId || null, expense.description,
      expense.plannedAmount ?? null, expense.actualAmount ?? null, expense.expenseDate || null, expenseId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Expense not found.' });
  res.json({ data: { id: expenseId.data, eventId: eventId.data, ...expense } });
}));

router.delete('/events/:eventId/expenses/:expenseId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const expenseId = idSchema.safeParse(req.params.expenseId);
  if (!eventId.success || !expenseId.success) return res.status(400).json({ error: 'A valid event and expense ID are required.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [result] = await database.execute(
    'DELETE FROM event_expenses WHERE id = ? AND event_id = ?',
    [expenseId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Expense not found.' });
  res.status(204).end();
}));

router.get('/events/:eventId/tasks', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  if (!eventId.success) return res.status(400).json({ error: 'A valid event ID is required.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [rows] = await database.execute(
    `SELECT t.id, t.booking_id, t.title, t.details, t.due_at, t.status, t.created_at, t.updated_at,
            b.service_description, vp.business_name AS vendor_name
     FROM event_vendor_tasks t
     JOIN bookings b ON b.id = t.booking_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE t.event_id = ? ORDER BY t.due_at IS NULL, t.due_at, t.id DESC`,
    [eventId.data],
  );
  res.json({ data: rows.map((row) => ({ ...row, id: Number(row.id), bookingId: Number(row.booking_id) })) });
}));

const taskSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(160),
  details: z.string().trim().max(2000).optional().default(''),
  dueAt: z.string().trim().max(32).nullable().optional(),
}).strict();

router.post('/events/:eventId/tasks', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const parsed = taskSchema.safeParse(req.body || {});
  if (!eventId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task details are invalid.' });
  const database = databaseFor(req);
  const event = await ownedEvent(database, req.platformUser.id, eventId.data);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  const [bookingRows] = await database.execute(
    `SELECT b.id, b.status, b.vendor_id, vp.user_id AS vendor_user_id, vp.business_name
     FROM bookings b JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE b.id = ? AND b.event_id = ? LIMIT 1`,
    [parsed.data.bookingId, eventId.data],
  );
  const booking = bookingRows[0];
  if (!booking || ['cancelled', 'rejected'].includes(booking.status)) return res.status(404).json({ error: 'Active vendor booking not found for this event.' });
  if (parsed.data.dueAt && Number.isNaN(Date.parse(parsed.data.dueAt))) return res.status(400).json({ error: 'Enter a valid task deadline.' });
  const result = await inTransaction(database, async (connection) => {
    const [insert] = await connection.execute(
      `INSERT INTO event_vendor_tasks (event_id, booking_id, title, details, due_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [eventId.data, booking.id, parsed.data.title, parsed.data.details || null, parsed.data.dueAt || null, req.platformUser.id],
    );
    await createNotification(connection, {
      userId: booking.vendor_user_id,
      title: 'Event preparation task',
      message: `${event.title}: ${parsed.data.title}`,
      type: 'event',
      relatedType: 'event',
      relatedId: eventId.data,
      actorId: req.platformUser.id,
    });
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'organizer.vendor_task_created',
      entityType: 'event',
      entityId: eventId.data,
      details: { taskId: Number(insert.insertId), bookingId: Number(booking.id) },
      ip: req.ip,
    });
    return Number(insert.insertId);
  });
  res.status(201).json({ data: { id: result, eventId: eventId.data, ...parsed.data, status: 'pending', vendorName: booking.business_name } });
}));

router.patch('/events/:eventId/tasks/:taskId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const taskId = idSchema.safeParse(req.params.taskId);
  const parsed = z.object({
    title: z.string().trim().min(2).max(160),
    details: z.string().trim().max(2000).optional().default(''),
    dueAt: z.string().trim().max(32).nullable().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
  }).strict().safeParse(req.body || {});
  if (!eventId.success || !taskId.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'Task details are invalid.' });
  if (parsed.data.dueAt && Number.isNaN(Date.parse(parsed.data.dueAt))) return res.status(400).json({ error: 'Enter a valid task deadline.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [result] = await database.execute(
    `UPDATE event_vendor_tasks SET title = ?, details = ?, due_at = ?, status = ?
     WHERE id = ? AND event_id = ?`,
    [parsed.data.title, parsed.data.details || null, parsed.data.dueAt || null, parsed.data.status, taskId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Vendor task not found.' });
  res.json({ data: { id: taskId.data, eventId: eventId.data, ...parsed.data } });
}));

router.delete('/events/:eventId/tasks/:taskId', asyncHandler(async (req, res) => {
  const eventId = idSchema.safeParse(req.params.eventId);
  const taskId = idSchema.safeParse(req.params.taskId);
  if (!eventId.success || !taskId.success) return res.status(400).json({ error: 'A valid event and task ID are required.' });
  const database = databaseFor(req);
  if (!await ownedEvent(database, req.platformUser.id, eventId.data)) return res.status(404).json({ error: 'Event not found.' });
  const [result] = await database.execute(
    'DELETE FROM event_vendor_tasks WHERE id = ? AND event_id = ?',
    [taskId.data, eventId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Vendor task not found.' });
  res.status(204).end();
}));

router.get('/favorites', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT vp.id, vp.business_name, vp.city, vp.description, vp.verification_status,
            sc.name AS category
     FROM favorites f
     JOIN vendor_profiles vp ON vp.id = f.vendor_id
     LEFT JOIN service_categories sc ON sc.id = vp.category_id
     WHERE f.user_id = ? AND vp.verification_status = 'verified'
     ORDER BY f.created_at DESC`,
    [req.platformUser.id],
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    name: row.business_name,
    category: row.category || 'General',
    city: row.city || '',
    description: row.description || '',
    verified: true,
  })) });
}));

router.post('/favorites', asyncHandler(async (req, res) => {
  const parsed = z.object({ vendorId: idSchema }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'A valid vendor ID is required.' });
  const database = databaseFor(req);
  const [vendors] = await database.execute(
    "SELECT id FROM vendor_profiles WHERE id = ? AND verification_status = 'verified'",
    [parsed.data.vendorId],
  );
  if (!vendors.length) return res.status(404).json({ error: 'Verified vendor not found.' });
  try {
    const [result] = await database.execute(
      'INSERT INTO favorites (user_id, vendor_id) VALUES (?, ?)',
      [req.platformUser.id, parsed.data.vendorId],
    );
    res.status(201).json({ data: { id: Number(result.insertId), vendorId: parsed.data.vendorId } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Vendor is already saved.' });
    throw error;
  }
}));

router.delete('/favorites/:vendorId', asyncHandler(async (req, res) => {
  const vendorId = idSchema.safeParse(req.params.vendorId);
  if (!vendorId.success) return res.status(400).json({ error: 'Vendor ID is invalid.' });
  const [result] = await databaseFor(req).execute(
    'DELETE FROM favorites WHERE user_id = ? AND vendor_id = ?',
    [req.platformUser.id, vendorId.data],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Saved vendor not found.' });
  res.status(204).end();
}));

router.get('/quotations', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT q.id, q.vendor_id, q.event_id, q.service_id, q.service_description, q.amount, q.currency,
            q.status, q.valid_until, q.requested_event_name, q.requested_date, q.requested_location,
            q.guest_count, q.budget, q.requested_event_type, q.requested_phone,
            q.required_services, q.additional_requirements, q.request_message,
            q.notes, q.created_at, vp.business_name AS vendor_name,
            e.title AS event_title
     FROM quotations q
     JOIN vendor_profiles vp ON vp.id = q.vendor_id
     LEFT JOIN events e ON e.id = q.event_id
     WHERE q.customer_id = ? AND (q.event_id IS NULL OR e.organizer_id = ?)
     ORDER BY q.created_at DESC, q.id DESC`,
    [req.platformUser.id, req.platformUser.id],
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    vendorName: row.vendor_name,
    eventId: row.event_id === null ? null : Number(row.event_id),
    eventTitle: row.requested_event_name || row.event_title || null,
    eventDate: row.requested_date || null,
    eventLocation: row.requested_location || null,
    eventType: row.requested_event_type || null,
    contactPhone: row.requested_phone || null,
    serviceId: row.service_id === null ? null : Number(row.service_id),
    guestCount: row.guest_count === null ? null : Number(row.guest_count),
    budget: row.budget === null ? null : Number(row.budget),
    requiredServices: row.required_services || '',
    additionalRequirements: row.additional_requirements || '',
    requestMessage: row.request_message || '',
    service: row.service_description,
    status: row.status,
    amount: Number(row.amount || 0),
    currency: row.currency,
    validUntil: row.valid_until,
    notes: row.notes || '',
    createdAt: row.created_at,
  })) });
}));

router.patch('/quotations/:id/decision', asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({
    status: z.enum(['accepted', 'declined', 'revision_requested', 'cancelled']),
    reason: z.string().trim().max(500).optional().default(''),
  }).strict().safeParse(req.body || {});
  if (!id.success || !parsed.success) return res.status(400).json({ error: parsed.error?.issues[0]?.message || 'A valid quotation decision is required.' });
  if (parsed.data.status === 'revision_requested' && parsed.data.reason.length < 5) {
    return res.status(400).json({ error: 'Enter at least five characters describing the requested revision.' });
  }
  const database = databaseFor(req);
  try {
    await inTransaction(database, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT q.id, q.status, q.event_id, q.customer_id, q.vendor_id,
                vp.user_id AS vendor_user_id, e.organizer_id
         FROM quotations q
         JOIN vendor_profiles vp ON vp.id = q.vendor_id
         LEFT JOIN events e ON e.id = q.event_id
         WHERE q.id = ? AND q.customer_id = ? LIMIT 1 FOR UPDATE`,
        [id.data, req.platformUser.id],
      );
      const quote = rows[0];
      if (!quote || (quote.event_id && Number(quote.organizer_id) !== Number(req.platformUser.id))) {
        throw Object.assign(new Error('Quotation not found.'), { status: 404 });
      }
      if (parsed.data.status === 'cancelled' ? quote.status !== 'draft' : !['sent', 'revision_requested'].includes(quote.status)) {
        throw Object.assign(new Error('This quotation is no longer awaiting a decision.'), { status: 409 });
      }
      await connection.execute(
        'UPDATE quotations SET status = ?, updated_at = NOW(), notes = CONCAT_WS(\'\\n\\n\', NULLIF(notes, \'\'), NULLIF(?, \'\')) WHERE id = ?',
        [parsed.data.status, parsed.data.reason ? `Organizer: ${parsed.data.reason}` : '', id.data],
      );
      await createNotification(connection, {
        userId: quote.vendor_user_id,
        title: 'Quotation update',
        message: `The organizer ${parsed.data.status.replaceAll('_', ' ')} quotation #${id.data}.${parsed.data.reason ? ` ${parsed.data.reason}` : ''}`,
        type: 'booking',
        relatedType: 'quotation',
        relatedId: id.data,
        actorId: req.platformUser.id,
      });
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: `organizer.quotation_${parsed.data.status}`,
        entityType: 'quotation',
        entityId: id.data,
        details: { eventId: quote.event_id === null ? null : Number(quote.event_id) },
        ip: req.ip,
      });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  res.json({ data: { id: id.data, status: parsed.data.status } });
}));

router.get('/messages', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT m.id, m.booking_id, m.sender_id, m.recipient_id, m.subject, m.body, m.read_at, m.created_at,
            sender.full_name AS sender_name, recipient.full_name AS recipient_name,
            e.id AS event_id, e.title AS event_title, vp.business_name AS vendor_name
     FROM messages m
     JOIN bookings b ON b.id = m.booking_id
     JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     JOIN users sender ON sender.id = m.sender_id
     JOIN users recipient ON recipient.id = m.recipient_id
     WHERE e.organizer_id = ? AND (m.sender_id = ? OR m.recipient_id = ?)
     ORDER BY m.created_at DESC, m.id DESC LIMIT 100`,
    [req.platformUser.id, req.platformUser.id, req.platformUser.id],
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    bookingId: Number(row.booking_id),
    eventId: Number(row.event_id),
    eventTitle: row.event_title,
    vendorName: row.vendor_name,
    senderId: Number(row.sender_id),
    sender: row.sender_name,
    recipient: row.recipient_name,
    subject: row.subject || '',
    body: row.body,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  })) });
}));

router.post('/messages', asyncHandler(async (req, res) => {
  const parsed = z.object({
    bookingId: idSchema,
    body: z.string().trim().min(1).max(4000),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Message details are invalid.' });
  const database = databaseFor(req);
  const [rows] = await database.execute(
    `SELECT b.id, e.id AS event_id, e.title AS event_title, vp.user_id AS vendor_user_id,
            vp.business_name AS vendor_name
     FROM bookings b JOIN events e ON e.id = b.event_id
     JOIN vendor_profiles vp ON vp.id = b.vendor_id
     WHERE b.id = ? AND e.organizer_id = ? AND b.status NOT IN ('cancelled', 'rejected') LIMIT 1`,
    [parsed.data.bookingId, req.platformUser.id],
  );
  const booking = rows[0];
  if (!booking) return res.status(404).json({ error: 'Active vendor booking not found.' });
  const messageId = await inTransaction(database, async (connection) => {
    const [result] = await connection.execute(
      'INSERT INTO messages (sender_id, recipient_id, booking_id, subject, body) VALUES (?, ?, ?, ?, ?)',
      [req.platformUser.id, booking.vendor_user_id, booking.id, `Event update: ${booking.event_title}`.slice(0, 180), parsed.data.body],
    );
    await createNotification(connection, {
      userId: booking.vendor_user_id,
      title: 'New organizer message',
      message: `New message about ${booking.event_title}.`,
      type: 'booking',
      relatedType: 'booking',
      relatedId: booking.id,
      actorId: req.platformUser.id,
    });
    await writeAudit(connection, {
      actorId: req.platformUser.id,
      action: 'organizer.message_sent',
      entityType: 'booking',
      entityId: booking.id,
      details: { messageId: Number(result.insertId) },
      ip: req.ip,
    });
    return Number(result.insertId);
  });
  res.status(201).json({ data: { id: messageId, bookingId: Number(booking.id), eventId: Number(booking.event_id), status: 'sent' } });
}));

router.post('/messages/:id/read', asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid message ID is required.' });
  const [result] = await databaseFor(req).execute(
    `UPDATE messages m
     JOIN bookings b ON b.id = m.booking_id
     JOIN events e ON e.id = b.event_id
     SET m.read_at = COALESCE(m.read_at, NOW())
     WHERE m.id = ? AND m.recipient_id = ? AND e.organizer_id = ?`,
    [id.data, req.platformUser.id, req.platformUser.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Message not found.' });
  res.json({ data: { id: id.data, read: true } });
}));

router.get('/notifications', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    `SELECT id, title, message, notification_type, related_entity_type, related_entity_id, status, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    [req.platformUser.id],
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    message: row.message,
    type: row.notification_type,
    relatedType: row.related_entity_type,
    relatedId: row.related_entity_id,
    read: row.status === 'read',
    createdAt: row.created_at,
  })) });
}));

router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'A valid notification ID is required.' });
  const database = databaseFor(req);
  const result = await inTransaction(database, async (connection) => {
    const [updated] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE id = ? AND user_id = ? AND status <> 'read'`,
      [id.data, req.platformUser.id],
    );
    if (updated.affectedRows) {
      await connection.execute(
        "INSERT INTO notification_history (notification_id, actor_id, action) VALUES (?, ?, 'read')",
        [id.data, req.platformUser.id],
      );
      return true;
    }
    const [owned] = await connection.execute(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
      [id.data, req.platformUser.id],
    );
    return owned.length > 0;
  });
  if (!result) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ data: { id: id.data, read: true } });
}));

router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  const database = databaseFor(req);
  const changed = await inTransaction(database, async (connection) => {
    await connection.execute(
      `INSERT INTO notification_history (notification_id, actor_id, action)
       SELECT id, ?, 'read' FROM notifications WHERE user_id = ? AND status <> 'read'`,
      [req.platformUser.id, req.platformUser.id],
    );
    const [result] = await connection.execute(
      `UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
       WHERE user_id = ? AND status <> 'read'`,
      [req.platformUser.id],
    );
    return Number(result.affectedRows || 0);
  });
  res.json({ data: { changed } });
}));

router.get('/reports', asyncHandler(async (req, res) => {
  const parsed = z.object({
    eventId: idSchema.optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict().safeParse(req.query);
  if (!parsed.success || parsed.data.dateFrom && !dateIsValid(parsed.data.dateFrom)
    || parsed.data.dateTo && !dateIsValid(parsed.data.dateTo)
    || parsed.data.dateFrom && parsed.data.dateTo && parsed.data.dateFrom > parsed.data.dateTo) {
    return res.status(400).json({ error: 'Report filters are invalid.' });
  }
  const values = [req.platformUser.id];
  const conditions = ['e.organizer_id = ?'];
  if (parsed.data.eventId) {
    conditions.push('e.id = ?');
    values.push(parsed.data.eventId);
  }
  if (parsed.data.dateFrom) {
    conditions.push('e.start_date >= ?');
    values.push(`${parsed.data.dateFrom} 00:00:00`);
  }
  if (parsed.data.dateTo) {
    conditions.push('e.start_date < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(parsed.data.dateTo);
  }
  const [rows] = await databaseFor(req).execute(
    `SELECT e.id, e.title, e.event_type, e.start_date, e.status, e.budget,
            (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id) AS booking_count,
            (SELECT COALESCE(SUM(b.quoted_amount), 0) FROM bookings b WHERE b.event_id = e.id AND b.status IN ('accepted', 'confirmed', 'completed')) AS committed_amount,
            (SELECT COALESCE(SUM(x.planned_amount), 0) FROM event_expenses x WHERE x.event_id = e.id) AS planned_expenses,
            (SELECT COALESCE(SUM(x.actual_amount), 0) FROM event_expenses x WHERE x.event_id = e.id) AS actual_expenses
     FROM events e WHERE ${conditions.join(' AND ')} ORDER BY e.start_date DESC`,
    values,
  );
  res.json({ data: rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    type: row.event_type,
    startDate: row.start_date,
    status: row.status,
    budget: Number(row.budget || 0),
    bookingCount: Number(row.booking_count || 0),
    committedAmount: Number(row.committed_amount || 0),
    plannedExpenses: Number(row.planned_expenses || 0),
    actualExpenses: Number(row.actual_expenses || 0),
  })) });
}));

router.get('/profile', asyncHandler(async (req, res) => {
  const [rows] = await databaseFor(req).execute(
    'SELECT id, full_name, email, phone, status, created_at FROM users WHERE id = ? LIMIT 1',
    [req.platformUser.id],
  );
  if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });
  res.json({ data: rows[0] });
}));

router.patch('/profile', asyncHandler(async (req, res) => {
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40).optional().default(''),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Profile details are invalid.' });
  const database = databaseFor(req);
  await database.execute('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [parsed.data.fullName, parsed.data.phone || null, req.platformUser.id]);
  await writeAudit(database, {
    actorId: req.platformUser.id,
    action: 'organizer.profile_updated',
    entityType: 'user',
    entityId: req.platformUser.id,
    details: { fields: ['full_name', 'phone'] },
    ip: req.ip,
  });
  res.json({ data: { id: Number(req.platformUser.id), fullName: parsed.data.fullName, phone: parsed.data.phone } });
}));

router.post('/profile/password', asyncHandler(async (req, res) => {
  const parsed = z.object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(16).refine(isStrongPassword),
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Provide your current password and a 12–16 character new password with uppercase, lowercase, and number.' });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ error: 'Choose a new password different from your current password.' });
  const database = databaseFor(req);
  const tokenHash = hashToken(req.cookies.platform_session);
  try {
    await inTransaction(database, async (connection) => {
      const [rows] = await connection.execute('SELECT password_hash FROM users WHERE id = ? FOR UPDATE', [req.platformUser.id]);
      if (!rows.length || !await bcrypt.compare(parsed.data.currentPassword, rows[0].password_hash)) {
        throw Object.assign(new Error('The current password is incorrect.'), { status: 400 });
      }
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.platformUser.id]);
      await connection.execute('DELETE FROM user_sessions WHERE user_id = ? AND token_hash <> ?', [req.platformUser.id, tokenHash]);
      await writeAudit(connection, {
        actorId: req.platformUser.id,
        action: 'organizer.password_changed',
        entityType: 'user',
        entityId: req.platformUser.id,
        details: { otherSessionsInvalidated: true },
        ip: req.ip,
        severity: 'critical',
      });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  res.json({ message: 'Password changed. Other account sessions have been signed out.' });
}));

export default router;