import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requirePermission } from '../middleware/rbac.js';
import { dashboardDateRangeSchema, loadAdminDashboardOverview } from '../lib/dashboardFilters.js';
import {
  ASSIGNABLE_PLATFORM_ROLES,
  ROLE_PERMISSION_MATRIX,
  describePermission,
  getRolePermissionPolicy,
  isCriticalPermission,
} from '../lib/rbac.js';

const userIdSchema = z.coerce.number().int().positive();
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'suspended', 'pending']).optional(),
  role: z.string().trim().min(1).max(80).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum(['id', 'full_name', 'email', 'status', 'created_at', 'roles']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict();

function isValidDate(value) {
  if (!value) return true;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function sendValidationError(res, error) {
  return res.status(400).json({
    error: 'Invalid request data.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

function statusError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function writeAudit(executor, { actorId, action, entityType = 'user', entityId, details, ip }) {
  await executor.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [actorId, action, entityType, String(entityId), JSON.stringify(details), ip || null],
  );
}

export function createPostgresAdminRouter({ database }) {
  const router = Router();

  router.get('/dashboard/overview', requirePermission('dashboard.view'), async (req, res, next) => {
    const parsed = dashboardDateRangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Provide a valid date range no longer than 366 days.' });
    }
    try {
      const data = await loadAdminDashboardOverview(database, parsed.data);
      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/reports/summary', requirePermission('reports.view'), async (req, res, next) => {
    try {
      const result = await database.query(
        `SELECT
          (SELECT COUNT(*) FROM users)::int AS total_users,
          (SELECT COUNT(*) FILTER (WHERE status = 'active') FROM users)::int AS active_users,
          (SELECT COUNT(*) FROM vendor_profiles)::int AS total_vendors,
          (SELECT COUNT(*) FILTER (WHERE verification_status = 'pending') FROM vendor_profiles)::int AS pending_vendors,
          (SELECT COUNT(*) FILTER (WHERE verification_status = 'verified') FROM vendor_profiles)::int AS verified_vendors,
          (SELECT COUNT(*) FROM events)::int AS total_events,
          (SELECT COUNT(*) FILTER (WHERE status = 'completed') FROM events)::int AS completed_events,
          (SELECT COUNT(*) FROM bookings)::int AS total_bookings,
          (SELECT COUNT(*) FILTER (WHERE status = 'under_review') FROM bookings)::int AS bookings_under_review,
          (SELECT COUNT(*) FROM payments)::int AS total_payments,
          (SELECT COUNT(*) FILTER (WHERE status = 'paid') FROM payments)::int AS confirmed_payments,
          (SELECT COUNT(*) FILTER (WHERE status = 'refund_pending') FROM payments)::int AS refunds_pending,
          (SELECT COUNT(*) FROM complaints WHERE status IN ('open', 'under_review'))::int AS open_complaints`,
      );
      const row = result.rows[0];
      return res.json({
        data: {
          users: { total_users: row.total_users, active_users: row.active_users },
          vendors: {
            total_vendors: row.total_vendors,
            pending_vendors: row.pending_vendors,
            verified_vendors: row.verified_vendors,
          },
          events: { total_events: row.total_events, completed_events: row.completed_events },
          bookings: {
            total_bookings: row.total_bookings,
            bookings_under_review: row.bookings_under_review,
          },
          payments: {
            total_payments: row.total_payments,
            confirmed_payments: row.confirmed_payments,
            refunds_pending: row.refunds_pending,
          },
          complaints: { open_complaints: row.open_complaints },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/roles', requirePermission('roles.manage'), async (req, res, next) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().trim().max(120).optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }).strict().safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { page, pageSize, q, status } = parsed.data;
    const conditions = [];
    const values = [];
    if (q) {
      values.push(`%${q}%`);
      conditions.push(`(r.name ILIKE $${values.length} OR COALESCE(r.description, '') ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status === 'active');
      conditions.push(`r.is_active = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
      const count = await database.query(`SELECT COUNT(*) AS total FROM roles r ${where}`, values);
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const roles = await database.query(
        `SELECT r.id, r.name, r.description, r.is_admin, r.is_active, r.created_at,
           COUNT(DISTINCT ur.user_id)::int AS user_count,
           COUNT(DISTINCT rp.permission_id)::int AS permission_count
         FROM roles r
         LEFT JOIN user_roles ur ON ur.role_id = r.id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         ${where}
         GROUP BY r.id
         ORDER BY r.is_admin DESC, r.name ASC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      );
      const data = roles.rows.map((role) => ({
        ...role,
        is_assignable: !role.is_admin && ASSIGNABLE_PLATFORM_ROLES.includes(String(role.name).toLowerCase()),
        permission_policy_count: getRolePermissionPolicy(role.name).length,
      }));
      return res.json({ data, pagination: { page, pageSize, total: Number(count.rows[0].total) } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/roles/:id/users', requirePermission('roles.manage'), async (req, res, next) => {
    const roleId = userIdSchema.safeParse(req.params.id);
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().trim().max(120).optional(),
    }).strict().safeParse(req.query);
    if (!roleId.success || !parsed.success) {
      return res.status(400).json({ error: 'Role or pagination filters are invalid.' });
    }
    const { page, pageSize, q } = parsed.data;
    const conditions = ['ur.role_id = $1'];
    const values = [roleId.data];
    if (q) {
      values.push(`%${q}%`);
      const search = `$${values.length}`;
      values.push(q);
      conditions.push(`(u.full_name ILIKE ${search} OR u.email ILIKE ${search} OR u.id::text = $${values.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    try {
      const roleResult = await database.query('SELECT id, name FROM roles WHERE id = $1', [roleId.data]);
      const role = roleResult.rows[0];
      if (!role) return res.status(404).json({ error: 'Role not found.' });
      const count = await database.query(
        `SELECT COUNT(DISTINCT u.id) AS total FROM users u
         JOIN user_roles ur ON ur.user_id = u.id ${where}`,
        values,
      );
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const users = await database.query(
        `SELECT u.id, u.full_name, u.email, u.status, u.created_at
         FROM users u JOIN user_roles ur ON ur.user_id = u.id ${where}
         ORDER BY u.full_name ASC, u.id ASC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      );
      return res.json({
        data: users.rows,
        role,
        pagination: { page, pageSize, total: Number(count.rows[0].total) },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/roles', requirePermission('roles.manage'), (_req, res) => (
    res.status(405).json({ error: 'Only the approved system roles can be managed.' })
  ));

  router.patch('/roles/:id/status', requirePermission('roles.manage'), async (req, res, next) => {
    const roleId = userIdSchema.safeParse(req.params.id);
    const parsed = z.object({ is_active: z.boolean() }).strict().safeParse(req.body);
    if (!roleId.success || !parsed.success) {
      return res.status(400).json({ error: 'Role status is invalid.' });
    }
    try {
      await database.inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [7342719]);
        const roleResult = await client.query(
          'SELECT id, name, is_admin, is_active FROM roles WHERE id = $1 FOR UPDATE',
          [roleId.data],
        );
        const role = roleResult.rows[0];
        if (!role) throw statusError('Role not found.', 404);
        if (role.is_active === parsed.data.is_active) return;
        if (!parsed.data.is_active && role.is_admin) {
          const admins = await client.query(
            `SELECT COUNT(DISTINCT u.id) AS total
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles active_admin_role ON active_admin_role.id = ur.role_id
             WHERE u.status = 'active' AND active_admin_role.is_admin = TRUE
               AND active_admin_role.is_active = TRUE AND active_admin_role.id <> $1`,
            [roleId.data],
          );
          if (Number(admins.rows[0].total) === 0) {
            throw statusError('Cannot disable the last active Administrator role.', 409);
          }
        } else if (!parsed.data.is_active) {
          const assigned = await client.query(
            'SELECT COUNT(DISTINCT user_id) AS total FROM user_roles WHERE role_id = $1',
            [roleId.data],
          );
          if (Number(assigned.rows[0].total) > 0) {
            throw statusError('Reassign users before disabling this role.', 409);
          }
        }
        await client.query('UPDATE roles SET is_active = $1 WHERE id = $2', [parsed.data.is_active, roleId.data]);
        if (!parsed.data.is_active && role.is_admin) {
          await client.query(
            `DELETE FROM admin_sessions s USING user_roles ur
             WHERE ur.user_id = s.user_id AND ur.role_id = $1`,
            [roleId.data],
          );
        }
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'role.status_changed',
          entityType: 'role',
          entityId: roleId.data,
          details: { name: role.name, from: role.is_active, to: parsed.data.is_active },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: roleId.data, is_active: parsed.data.is_active } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/roles/:id', requirePermission('roles.manage'), (_req, res) => (
    res.status(405).json({ error: 'Role names and system role properties are protected.' })
  ));
  router.delete('/roles/:id', requirePermission('roles.manage'), (_req, res) => (
    res.status(405).json({ error: 'System roles cannot be deleted.' })
  ));

  router.get('/rbac/matrix', requirePermission('roles.manage'), (_req, res) => (
    res.json({
      data: {
        roles: Object.fromEntries(
          Object.entries(ROLE_PERMISSION_MATRIX).map(([role, permissions]) => [role, permissions]),
        ),
      },
    })
  ));

  router.get('/roles/:id/permissions', requirePermission('roles.permissions.manage'), async (req, res, next) => {
    const roleId = userIdSchema.safeParse(req.params.id);
    if (!roleId.success) return res.status(400).json({ error: 'Role ID is invalid.' });
    try {
      const roleResult = await database.query(
        'SELECT id, name, is_admin, is_active FROM roles WHERE id = $1',
        [roleId.data],
      );
      const role = roleResult.rows[0];
      if (!role) return res.status(404).json({ error: 'Role not found.' });
      const permissionResult = await database.query(
        `SELECT p.permission_key FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1 ORDER BY p.permission_key`,
        [roleId.data],
      );
      const currentKeys = permissionResult.rows.map((row) => row.permission_key);
      return res.json({
        data: {
          role,
          permission_keys: currentKeys,
          allowed_permission_keys: getRolePermissionPolicy(role.name),
          permissions: currentKeys.map((permission_key) => ({
            permission_key,
            ...describePermission(permission_key),
            critical: isCriticalPermission(permission_key),
          })),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/roles/:id/permissions', requirePermission('roles.permissions.manage'), async (req, res, next) => {
    const roleId = userIdSchema.safeParse(req.params.id);
    const parsed = z.object({
      permission_keys: z.array(z.string().trim().min(1).max(120)).max(100),
    }).strict().safeParse(req.body);
    if (!roleId.success || !parsed.success
      || new Set(parsed.data.permission_keys).size !== parsed.data.permission_keys.length) {
      return res.status(400).json({ error: 'Role or permission selection is invalid.' });
    }
    const updatedKeys = [...parsed.data.permission_keys].sort();
    try {
      await database.inTransaction(async (client) => {
        const roleResult = await client.query(
          'SELECT id, name, is_admin FROM roles WHERE id = $1 FOR UPDATE',
          [roleId.data],
        );
        const role = roleResult.rows[0];
        if (!role) throw statusError('Role not found.', 404);
        if (role.is_admin) {
          throw statusError('Administrator permissions are protected and cannot be edited.', 409);
        }
        const policyKeys = new Set(getRolePermissionPolicy(role.name));
        const forbidden = updatedKeys.filter((key) => !policyKeys.has(key) || isCriticalPermission(key));
        if (forbidden.length) {
          throw statusError('One or more permissions exceed this role’s approved security policy.', 403);
        }
        const permissionsResult = updatedKeys.length
          ? await client.query(
            `SELECT id, permission_key FROM permissions
             WHERE permission_key = ANY($1::text[])`,
            [updatedKeys],
          )
          : { rows: [] };
        if (permissionsResult.rows.length !== updatedKeys.length) {
          throw statusError('One or more approved permissions are not configured in the database.', 400);
        }
        const currentResult = await client.query(
          `SELECT p.permission_key FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = $1`,
          [roleId.data],
        );
        const currentKeys = currentResult.rows.map((row) => row.permission_key);
        await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId.data]);
        for (const permission of permissionsResult.rows) {
          await client.query(
            'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
            [roleId.data, permission.id],
          );
        }
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'role.permissions_changed',
          entityType: 'role',
          entityId: roleId.data,
          details: {
            role: role.name,
            added: updatedKeys.filter((key) => !currentKeys.includes(key)),
            removed: currentKeys.filter((key) => !updatedKeys.includes(key)),
          },
          ip: req.ip,
        });
      });
      return res.json({ data: { role_id: roleId.data, permission_keys: updatedKeys } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/users', requirePermission('users.view'), async (req, res, next) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const { page, pageSize, q, status, role, dateFrom, dateTo, sortBy, sortDirection } = parsed.data;
    if (!isValidDate(dateFrom) || !isValidDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
      return res.status(400).json({ error: 'Registration date range is invalid.' });
    }

    const conditions = [];
    const values = [];
    const addCondition = (sql, value) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (q) {
      values.push(`%${q}%`);
      const marker = `$${values.length}`;
      values.push(q);
      const idMarker = `$${values.length}`;
      conditions.push(`(u.full_name ILIKE ${marker} OR u.email ILIKE ${marker}
        OR COALESCE(u.phone, '') ILIKE ${marker} OR u.id::text = ${idMarker})`);
    }
    if (status) addCondition('u.status = ?', status);
    if (role) {
      values.push(role);
      conditions.push(`EXISTS (
        SELECT 1 FROM user_roles filter_ur
        JOIN roles filter_r ON filter_r.id = filter_ur.role_id
        WHERE filter_ur.user_id = u.id AND LOWER(filter_r.name) = LOWER($${values.length})
      )`);
    }
    if (dateFrom) addCondition('u.created_at >= ?::date', dateFrom);
    if (dateTo) addCondition(`u.created_at < (?::date + INTERVAL '1 day')`, dateTo);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderColumns = {
      id: 'u.id',
      full_name: 'u.full_name',
      email: 'u.email',
      status: 'u.status',
      created_at: 'u.created_at',
      roles: 'roles',
    };
    try {
      const count = await database.query(`SELECT COUNT(*) AS total FROM users u ${where}`, values);
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const rows = await database.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
          STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles,
          MIN(r.id) FILTER (WHERE r.is_admin = FALSE) AS role_id,
          (SELECT COUNT(DISTINCT b.id)
           FROM bookings b
           LEFT JOIN events e ON e.id = b.event_id
           LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
           WHERE e.organizer_id = u.id OR vp.user_id = u.id) AS bookings_count
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         ${where}
         GROUP BY u.id
         ORDER BY ${orderColumns[sortBy]} ${sortDirection.toUpperCase()}, u.id DESC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      );
      return res.json({
        data: rows.rows,
        pagination: { page, pageSize, total: Number(count.rows[0].total) },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/users/:id', requirePermission('users.view'), async (req, res, next) => {
    const id = userIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'User ID is invalid.' });
    try {
      const result = await database.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
          STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) AS roles,
          MIN(r.id) FILTER (WHERE r.is_admin = FALSE) AS role_id
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1
         GROUP BY u.id`,
        [id.data],
      );
      if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
      return res.json({ data: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/users', requirePermission('users.create'), async (req, res, next) => {
    const parsed = z.object({
      full_name: z.string().trim().min(1).max(160),
      email: emailSchema,
      phone: z.string().trim().max(40).nullable().optional(),
      password: z.string().min(16).max(128).refine((password) => (
        /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
      )),
      role_id: z.coerce.number().int().positive(),
      status: z.enum(['active', 'suspended']).default('active'),
    }).strict().safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);

    try {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const created = await database.inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))', [parsed.data.email]);
        const roleResult = await client.query(
          'SELECT id, name FROM roles WHERE id = $1 AND is_active = TRUE AND is_admin = FALSE FOR UPDATE',
          [parsed.data.role_id],
        );
        const role = roleResult.rows[0];
        if (!role || !['organizer', 'vendor'].includes(String(role.name).toLowerCase())) {
          throw statusError('Administrator-created accounts must use the Organizer or Vendor role.', 400);
        }
        const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [parsed.data.email]);
        if (existing.rows.length) throw statusError('An account with this email already exists.', 409);
        if (parsed.data.phone) {
          const existingPhone = await client.query('SELECT id FROM users WHERE phone = $1 LIMIT 1', [parsed.data.phone]);
          if (existingPhone.rows.length) throw statusError('An account with this phone number already exists.', 409);
        }
        const userResult = await client.query(
          `INSERT INTO users (full_name, email, phone, password_hash, status)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [parsed.data.full_name, parsed.data.email, parsed.data.phone || null, passwordHash, parsed.data.status],
        );
        const userId = userResult.rows[0].id;
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.id]);
        if (String(role.name).toLowerCase() === 'vendor') {
          await client.query(
            `INSERT INTO vendor_profiles (user_id, business_name, verification_status)
             VALUES ($1, $2, 'pending')`,
            [userId, parsed.data.full_name],
          );
        }
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'user.created',
          entityId: userId,
          details: { role: role.name, status: parsed.data.status },
          ip: req.ip,
        });
        return userId;
      });
      return res.status(201).json({ data: { id: created } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'A record with the same unique value already exists.' });
      return next(error);
    }
  });

  router.patch('/users/:id', requirePermission('users.edit'), async (req, res, next) => {
    const id = userIdSchema.safeParse(req.params.id);
    const parsed = z.object({
      full_name: z.string().trim().min(1).max(160).optional(),
      email: emailSchema.optional(),
      phone: z.string().trim().max(40).nullable().optional(),
    }).strict().safeParse(req.body);
    if (!id.success || !parsed.success || !Object.keys(parsed.data || {}).length) {
      return res.status(400).json({ error: 'Provide a valid name, email, or phone number.' });
    }
    if (id.data === Number(req.admin.id) && parsed.data.email) {
      return res.status(409).json({ error: 'Use the verified email change workflow in your profile.' });
    }

    try {
      await database.inTransaction(async (client) => {
        const target = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id.data]);
        if (!target.rows.length) throw statusError('User not found.', 404);
        const fields = Object.keys(parsed.data);
        const values = fields.map((field) => parsed.data[field]);
        if (parsed.data.email) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))', [parsed.data.email]);
          const duplicate = await client.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1',
            [parsed.data.email, id.data],
          );
          if (duplicate.rows.length) throw statusError('An account with this email already exists.', 409);
        }
        if (parsed.data.phone) {
          const duplicatePhone = await client.query(
            'SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1',
            [parsed.data.phone, id.data],
          );
          if (duplicatePhone.rows.length) throw statusError('An account with this phone number already exists.', 409);
        }
        const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
        await client.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = $${values.length + 1}`, [...values, id.data]);
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'user.updated',
          entityId: id.data,
          details: { fields },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      if (error.code === '23505') return res.status(409).json({ error: 'A record with the same unique value already exists.' });
      return next(error);
    }
  });

  router.patch('/users/:id/role', requirePermission('users.assign_role'), async (req, res, next) => {
    const userId = userIdSchema.safeParse(req.params.id);
    const roleId = userIdSchema.safeParse(req.body?.role_id);
    if (!userId.success || !roleId.success || userId.data === Number(req.admin.id)) {
      return res.status(400).json({ error: 'User and role are invalid; you cannot change your own role.' });
    }
    try {
      await database.inTransaction(async (client) => {
        const targetResult = await client.query(
          `SELECT u.id,
            EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.is_admin = TRUE) AS is_admin,
            (SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id AND r.is_admin = FALSE ORDER BY r.id LIMIT 1) AS current_role_id,
            (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id AND r.is_admin = FALSE ORDER BY r.id LIMIT 1) AS current_role_name
           FROM users u WHERE u.id = $1 FOR UPDATE`,
          [userId.data],
        );
        const target = targetResult.rows[0];
        const roleResult = await client.query(
          'SELECT id, name FROM roles WHERE id = $1 AND is_active = TRUE AND is_admin = FALSE',
          [roleId.data],
        );
        const role = roleResult.rows[0];
        if (!target || !role) throw statusError('User or active non-admin role not found.', 404);
        if (!ASSIGNABLE_PLATFORM_ROLES.includes(String(role.name).toLowerCase())) {
          throw statusError('This role is not approved for user assignment.', 403);
        }
        if (target.is_admin) throw statusError('Administrator roles cannot be changed through user management.', 409);
        await client.query(
          `DELETE FROM user_roles ur USING roles r
           WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.is_admin = FALSE`,
          [userId.data],
        );
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId.data, roleId.data]);
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId.data]);
        await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [userId.data]);
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'user.role_changed',
          entityId: userId.data,
          details: {
            from: target.current_role_id ? { id: Number(target.current_role_id), name: target.current_role_name } : null,
            to: { id: Number(role.id), name: role.name },
          },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: userId.data, role_id: roleId.data } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  router.patch('/users/:id/status', requirePermission('users.deactivate'), async (req, res, next) => {
    const id = userIdSchema.safeParse(req.params.id);
    const parsed = z.object({
      status: z.enum(['active', 'suspended', 'pending']),
      reason: z.string().trim().min(3).max(500),
    }).strict().safeParse(req.body);
    if (!id.success || !parsed.success || (id.data === Number(req.admin.id) && parsed.data.status !== 'active')) {
      return res.status(400).json({ error: 'A valid status and reason are required; you cannot suspend your own account.' });
    }
    try {
      await database.inTransaction(async (client) => {
        const targetResult = await client.query('SELECT id, status FROM users WHERE id = $1 FOR UPDATE', [id.data]);
        const target = targetResult.rows[0];
        if (!target) throw statusError('User not found.', 404);
        if (parsed.data.status !== 'active') {
          const adminResult = await client.query(
            `SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                            WHERE ur.user_id = $1 AND r.is_admin = TRUE) AS is_admin`,
            [id.data],
          );
          if (adminResult.rows[0].is_admin) {
            const remainingAdmins = await client.query(
              `SELECT COUNT(*) AS total FROM user_roles ur
               JOIN roles r ON r.id = ur.role_id AND r.is_admin = TRUE AND r.is_active = TRUE
               JOIN users u ON u.id = ur.user_id AND u.status = 'active'
               WHERE u.id <> $1`,
              [id.data],
            );
            if (Number(remainingAdmins.rows[0].total) === 0) {
              throw statusError('Cannot deactivate the last active administrator.', 409);
            }
          }
        }
        await client.query('UPDATE users SET status = $1 WHERE id = $2', [parsed.data.status, id.data]);
        if (parsed.data.status !== 'active') {
          await client.query('DELETE FROM user_sessions WHERE user_id = $1', [id.data]);
          await client.query('DELETE FROM admin_sessions WHERE user_id = $1', [id.data]);
        }
        await writeAudit(client, {
          actorId: req.admin.id,
          action: 'user.status_changed',
          entityId: id.data,
          details: { from: target.status, to: parsed.data.status, reason: parsed.data.reason },
          ip: req.ip,
        });
      });
      return res.json({ data: { id: id.data, status: parsed.data.status } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
