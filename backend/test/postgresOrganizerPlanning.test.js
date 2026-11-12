import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { createPostgresOrganizerPlanningRouter } from '../src/routes/postgresOrganizerPlanning.js';

function createDatabase() {
  const categories = [];
  const expenses = [];
  const tasks = [];
  const queries = [];
  let nextId = 1;
  const database = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('AS total_events') && sql.includes('AS unread_notifications')) {
        return {
          rows: [{
            total_events: 2,
            upcoming_events: 1,
            ongoing_events: 0,
            allocated_budget: '10000.00',
            total_bookings: 4,
            pending_bookings: 1,
            confirmed_bookings: 1,
            completed_bookings: 2,
            planned_expenses: '2500.00',
            actual_expenses: '1500.00',
            unread_messages: 3,
            unread_notifications: 2,
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('SELECT id, title, budget, start_date, end_date FROM events')) {
        return {
          rows: Number(values[0]) === 10 && Number(values[1]) === 44
            ? [{ id: 10, title: 'Test event', budget: '1000.00' }]
            : [],
          rowCount: Number(values[0]) === 10 && Number(values[1]) === 44 ? 1 : 0,
        };
      }
      if (sql.includes('FROM event_budget_categories WHERE event_id = $1 ORDER BY name')) {
        return { rows: categories.filter((row) => row.event_id === Number(values[0])), rowCount: categories.length };
      }
      if (sql.includes('FROM event_expenses x')) {
        return { rows: expenses.filter((row) => row.event_id === Number(values[0])), rowCount: expenses.length };
      }
      if (sql.startsWith('INSERT INTO event_budget_categories')) {
        if (categories.some((row) => row.event_id === Number(values[0]) && row.name === values[1])) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        const id = nextId++;
        categories.push({ id, event_id: Number(values[0]), name: values[1], budget_limit: values[2] });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE event_budget_categories')) {
        const row = categories.find((item) => item.id === Number(values[2]) && item.event_id === Number(values[3]));
        if (!row) return { rows: [], rowCount: 0 };
        row.name = values[0];
        row.budget_limit = values[1];
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT COUNT(*) AS total FROM event_expenses')) {
        const total = expenses.filter((row) => row.event_id === Number(values[0])
          && row.category_id === Number(values[1])).length;
        return { rows: [{ total: String(total) }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM event_budget_categories')) {
        const index = categories.findIndex((row) => row.id === Number(values[0]) && row.event_id === Number(values[1]));
        if (index < 0) return { rows: [], rowCount: 0 };
        categories.splice(index, 1);
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id FROM event_budget_categories')) {
        return { rows: categories.some((row) => row.id === Number(values[0]) && row.event_id === Number(values[1]))
          ? [{ id: values[0] }] : [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT b.id, b.vendor_id FROM bookings')) {
        return { rows: Number(values[0]) === 31 && Number(values[1]) === 10 && Number(values[2]) === 44
          ? [{ id: 31, vendor_id: 8 }] : [], rowCount: 1 };
      }
      if (sql.startsWith('SELECT id FROM vendor_profiles')) {
        return { rows: Number(values[0]) === 8 ? [{ id: 8 }] : [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO event_expenses')) {
        const id = nextId++;
        expenses.push({
          id, event_id: Number(values[0]), category_id: values[1], booking_id: values[2],
          vendor_id: values[3], description: values[4], planned_amount: values[5],
          actual_amount: values[6], expense_date: values[7],
        });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE event_expenses')) {
        const row = expenses.find((item) => item.id === Number(values[7]) && item.event_id === Number(values[8]));
        if (!row) return { rows: [], rowCount: 0 };
        [row.category_id, row.booking_id, row.vendor_id, row.description, row.planned_amount,
          row.actual_amount, row.expense_date] = values.slice(0, 7);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM event_expenses')) {
        const index = expenses.findIndex((row) => row.id === Number(values[0]) && row.event_id === Number(values[1]));
        if (index < 0) return { rows: [], rowCount: 0 };
        expenses.splice(index, 1);
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      if (sql.includes('FROM event_vendor_tasks t')) {
        return {
          rows: tasks.filter((row) => row.event_id === Number(values[0])).map((row) => ({
            ...row,
            service_description: 'Photography',
            vendor_name: 'Bright Photos',
          })),
          rowCount: tasks.length,
        };
      }
      if (sql.startsWith('SELECT b.id, b.status, vp.user_id AS vendor_user_id')) {
        return { rows: Number(values[0]) === 31 && Number(values[1]) === 10
          ? [{ id: 31, status: 'accepted', vendor_user_id: 88, business_name: 'Bright Photos' }]
          : [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO event_vendor_tasks')) {
        const id = nextId++;
        tasks.push({
          id,
          event_id: Number(values[0]),
          booking_id: Number(values[1]),
          title: values[2],
          details: values[3],
          due_at: values[4],
          status: 'pending',
        });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO notifications')) return { rows: [{ id: nextId++ }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO notification_history') || sql.startsWith('INSERT INTO audit_logs')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE event_vendor_tasks')) {
        const row = tasks.find((item) => item.id === Number(values[4]) && item.event_id === Number(values[5]));
        if (!row) return { rows: [], rowCount: 0 };
        [row.title, row.details, row.due_at, row.status] = values.slice(0, 4);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM event_vendor_tasks')) {
        const index = tasks.findIndex((row) => row.id === Number(values[0]) && row.event_id === Number(values[1]));
        if (index < 0) return { rows: [], rowCount: 0 };
        tasks.splice(index, 1);
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      throw new Error(`Unexpected PostgreSQL planning query: ${sql}`);
    },
    async inTransaction(work) {
      return work(database);
    },
    queries,
  };
  return database;
}

const database = createDatabase();
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.platformUser = { id: 44, role: req.get('x-test-role') || 'organizer' };
  next();
});
app.use('/api/platform/organizer', createPostgresOrganizerPlanningRouter({ database }));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}/api/platform/organizer`;

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
}

test('PostgreSQL organizer overview is role-scoped and returns persisted aggregate fields', async () => {
  const queryCount = database.queries.length;
  const response = await request('/overview');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, {
    totalEvents: 2,
    upcomingEvents: 1,
    ongoingEvents: 0,
    totalBookings: 4,
    pendingBookings: 1,
    confirmedBookings: 1,
    completedBookings: 2,
    budget: { allocated: 10000, plannedExpenses: 2500, actualExpenses: 1500, remaining: 8500 },
    unreadMessages: 3,
    unreadNotifications: 2,
  });
  assert.equal(database.queries.length, queryCount + 1);
  const overviewQuery = database.queries.at(-1);
  assert.deepEqual(overviewQuery.values, [44]);
  assert.match(overviewQuery.sql, /e\.organizer_id = \$1/);
  assert.doesNotMatch(overviewQuery.sql, /\?|DATE_ADD|DATE_FORMAT/);
  assert.equal((await request('/overview', { headers: { 'x-test-role': 'customer' } })).status, 403);
});

test('PostgreSQL organizer planning routes enforce event ownership and validate input', async () => {
  assert.equal((await request('/events/99/budget')).status, 404);
  assert.equal((await request('/events/nope/budget')).status, 400);
  assert.equal((await request('/events/10/expenses', {
    method: 'POST',
    body: { description: 'Invalid expense', plannedAmount: -1 },
  })).status, 400);
  assert.equal((await request('/events/10/tasks', {
    method: 'POST',
    body: { bookingId: 31, title: 'Valid task', dueAt: 'not-a-date' },
  })).status, 400);
});

test('PostgreSQL organizer budget categories and expenses support scoped CRUD', async () => {
  const categoryResponse = await request('/events/10/budget/categories', {
    method: 'POST',
    body: { name: 'Catering', budgetLimit: 500 },
  });
  assert.equal(categoryResponse.status, 201);
  const category = (await categoryResponse.json()).data;
  assert.equal(category.id, 1);

  assert.equal((await request('/events/10/budget/categories', {
    method: 'POST',
    body: { name: 'Catering', budgetLimit: 500 },
  })).status, 409);

  const updatedCategory = await request(`/events/10/budget/categories/${category.id}`, {
    method: 'PATCH',
    body: { name: 'Food', budgetLimit: 750 },
  });
  assert.equal(updatedCategory.status, 200);

  const expenseResponse = await request('/events/10/expenses', {
    method: 'POST',
    body: {
      categoryId: category.id,
      bookingId: 31,
      description: 'Dinner service',
      plannedAmount: 300,
      actualAmount: 250,
      expenseDate: '2030-02-01',
    },
  });
  assert.equal(expenseResponse.status, 201);
  const expense = (await expenseResponse.json()).data;
  assert.equal(expense.vendorId, 8);

  const budget = await request('/events/10/budget');
  assert.equal(budget.status, 200);
  const payload = (await budget.json()).data;
  assert.equal(payload.summary.planned, 300);
  assert.equal(payload.summary.actual, 250);
  assert.equal(payload.summary.remaining, 750);

  assert.equal((await request(`/events/10/budget/categories/${category.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await request(`/events/10/expenses/${expense.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/events/10/budget/categories/${category.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/events/10/expenses/${expense.id}`, { method: 'DELETE' })).status, 404);
});

test('PostgreSQL organizer tasks create notifications and support scoped update and delete', async () => {
  const created = await request('/events/10/tasks', {
    method: 'POST',
    body: { bookingId: 31, title: 'Confirm setup', details: 'Send arrival time.' },
  });
  assert.equal(created.status, 201);
  const task = (await created.json()).data;
  assert.equal(task.vendorName, 'Bright Photos');

  const update = await request(`/events/10/tasks/${task.id}`, {
    method: 'PATCH',
    body: { title: 'Confirm access', details: '', dueAt: null, status: 'in_progress' },
  });
  assert.equal(update.status, 200);

  const list = await request('/events/10/tasks');
  assert.equal((await list.json()).data[0].status, 'in_progress');

  assert.equal((await request(`/events/10/tasks/${task.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/events/10/tasks/${task.id}`, { method: 'DELETE' })).status, 404);

  assert.ok(database.queries.every(({ sql }) => !sql.includes('?')));
  assert.ok(database.queries.some(({ sql }) => sql.includes('INSERT INTO notifications')));
  assert.ok(database.queries.some(({ sql }) => sql.includes('INSERT INTO audit_logs')));
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});
