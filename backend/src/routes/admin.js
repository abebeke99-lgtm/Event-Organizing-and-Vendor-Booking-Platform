import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, inTransaction } from '../db.js';
import { getModuleLockState, getSystemLockState, ROLE_PERMISSION_MATRIX } from '../lib/rbac.js';
import { writeAudit } from '../lib/security.js';
import { dashboardDateRangeSchema, loadAdminDashboardOverview } from '../lib/dashboardFilters.js';

const router = Router();
const idSchema = z.coerce.number().int().positive();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
});

const resources = {
  users: {
    table: 'users',
    id: 'id',
    columns: ['id', 'full_name', 'email', 'phone', 'status', 'created_at'],
    search: ['full_name', 'email'],
    statuses: ['active', 'suspended', 'pending'],
    mutable: ['full_name', 'email', 'phone'],
    required: ['full_name', 'email'],
    deactivate: { column: 'status', value: 'suspended' },
    query: `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at, GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ', ') AS roles
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id`,
    group: ' GROUP BY u.id',
  },
  roles: {
    table: 'roles',
    id: 'id',
    columns: ['id', 'name', 'description', 'is_admin', 'is_active', 'created_at'],
    search: ['name', 'description'],
    statuses: ['1', '0'],
    statusField: 'is_active',
    mutable: ['name', 'description', 'is_active'],
    required: ['name'],
    deactivate: { column: 'is_active', value: 0 },
  },
  categories: {
    table: 'service_categories',
    id: 'id',
    columns: ['id', 'name', 'description', 'is_active', 'created_at'],
    search: ['name', 'description'],
    statuses: ['1', '0'],
    statusField: 'is_active',
    mutable: ['name', 'description', 'is_active'],
    required: ['name'],
    deactivate: { column: 'is_active', value: 0 },
  },
  vendors: {
    table: 'vendor_profiles',
    id: 'id',
    columns: ['id', 'user_id', 'business_name', 'category_id', 'city', 'description', 'verification_status', 'verification_reason', 'verified_at', 'created_at'],
    search: ['business_name', 'city'],
    statuses: ['pending', 'verified', 'rejected'],
    mutable: ['business_name', 'category_id', 'city', 'description', 'verification_status'],
    required: ['business_name'],
    deactivate: { column: 'verification_status', value: 'rejected' },
  },
  events: {
    table: 'events',
    id: 'id',
    columns: ['id', 'organizer_id', 'title', 'event_type', 'city', 'start_date', 'end_date', 'budget', 'status', 'notes', 'created_at'],
    search: ['title', 'event_type', 'city'],
    statuses: ['draft', 'active', 'booked', 'in_progress', 'completed', 'cancelled'],
    mutable: ['organizer_id', 'title', 'event_type', 'city', 'start_date', 'end_date', 'budget', 'status', 'notes'],
    required: ['organizer_id', 'title', 'event_type', 'start_date'],
    deactivate: { column: 'status', value: 'cancelled' },
  },
  bookings: {
    table: 'bookings',
    id: 'id',
    columns: ['id', 'event_id', 'vendor_id', 'service_description', 'quoted_amount', 'currency', 'status', 'moderation_reason', 'created_at'],
    search: ['service_description', 'currency'],
    statuses: ['requested', 'quoted', 'accepted', 'rejected', 'cancelled', 'completed', 'under_review'],
    mutable: ['status', 'moderation_reason'],
    required: ['status'],
  },
  payments: {
    table: 'payments',
    id: 'id',
    columns: ['id', 'booking_id', 'amount', 'currency', 'provider', 'provider_reference', 'status', 'created_at'],
    search: ['provider', 'provider_reference', 'currency'],
    statuses: ['pending', 'authorized', 'paid', 'failed', 'refunded', 'refund_pending'],
    mutable: ['status'],
  },
  reviews: {
    table: 'reviews',
    id: 'id',
    columns: ['id', 'booking_id', 'rating', 'comment', 'status', 'created_at'],
    search: ['comment'],
    statuses: ['published', 'hidden', 'flagged'],
    mutable: ['status'],
    deactivate: { column: 'status', value: 'hidden' },
  },
  complaints: {
    table: 'complaints',
    id: 'id',
    columns: ['id', 'user_id', 'booking_id', 'subject', 'details', 'status', 'resolution', 'created_at'],
    search: ['subject', 'details'],
    statuses: ['open', 'investigating', 'resolved', 'dismissed'],
    mutable: ['status', 'resolution'],
    deactivate: { column: 'status', value: 'dismissed' },
  },
  notifications: {
    table: 'notifications',
    id: 'id',
    columns: ['id', 'user_id', 'title', 'message', 'status', 'created_at'],
    search: ['title', 'message'],
    statuses: ['queued', 'sent', 'failed', 'read'],
    mutable: ['user_id', 'title', 'message', 'status'],
    required: ['title', 'message'],
  },
};

const getResource = (name) => resources[name] || null;

function sendError(res, error) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid request data.', details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })) });
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'A record with the same unique value already exists.' });
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'The change conflicts with related records.' });
  }
  throw error;
}

function validBody(resource, body, creating = false) {
  const allowed = resource.mutable || [];
  const unknown = Object.keys(body || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw Object.assign(new Error('Invalid request data.'), {
      name: 'ZodError',
      issues: unknown.map((field) => ({ path: [field], message: 'Field is not editable.' })),
    });
  }
  if (creating) {
    for (const field of resource.required || []) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        throw Object.assign(new Error('Invalid request data.'), {
          name: 'ZodError',
          issues: [{ path: [field], message: 'Required.' }],
        });
      }
    }
  }
  return body;
}

export function getListQuery(resource, q, status) {
  const values = [];
  const clauses = [];

  if (q && resource.search?.length) {
    clauses.push(`(${resource.search.map((column) => `${column} LIKE ?`).join(' OR ')})`);
    values.push(...resource.search.map(() => `%${q}%`));
  }

  const statusField = resource.statusField || 'status';
  if (status) {
    clauses.push(`${statusField} = ?`);
    values.push(status);
  }

  return {
    where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

router.get('/permissions', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT id, permission_key, description FROM permissions ORDER BY permission_key');
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/rbac/matrix', async (req, res, next) => {
  try {
    res.json({
      data: {
        roles: Object.fromEntries(Object.entries(ROLE_PERMISSION_MATRIX).map(([role, permissions]) => [role, permissions])),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/rbac/effective-permissions', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ? AND r.is_active = TRUE`,
      [req.admin.id]
    );
    res.json({ data: rows.map((row) => row.permission_key) });
  } catch (error) {
    next(error);
  }
});

router.get('/security/status', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT module_key, is_locked, lock_reason FROM module_locks ORDER BY module_key');
    const moduleLocks = Object.fromEntries(rows.map((row) => [row.module_key, { locked: Boolean(row.is_locked), reason: row.lock_reason || null } ]));
    const [settings] = await pool.execute('SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ("platform_status", "maintenance_mode")');
    const settingsMap = Object.fromEntries(settings.map((setting) => [setting.setting_key, setting.setting_value]));
    const systemState = getSystemLockState({
      platform_status: settingsMap.platform_status,
      maintenance_mode: settingsMap.maintenance_mode,
    });
    res.json({
      data: {
        system: systemState,
        modules: moduleLocks,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/security/lock', async (req, res, next) => {
  const parsed = z.object({
    module_key: z.string().trim().min(1).max(80).optional(),
    is_locked: z.boolean().optional(),
    lock_reason: z.string().trim().max(255).optional(),
    platform_status: z.enum(['open', 'locked', 'maintenance']).optional(),
    maintenance_mode: z.boolean().optional(),
  }).strict().safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Lock settings are invalid.' });

  try {
    await inTransaction(async (db) => {
      if (parsed.data.module_key) {
        const value = parsed.data.is_locked ?? false;
        await db.execute(
          `INSERT INTO module_locks (module_key, is_locked, lock_reason, locked_by, locked_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE is_locked = VALUES(is_locked), lock_reason = VALUES(lock_reason), locked_by = VALUES(locked_by), locked_at = NOW()`,
          [parsed.data.module_key, value, parsed.data.lock_reason || (value ? 'Module locked by administrator' : null), req.admin.id]
        );
      }

      if (parsed.data.platform_status) {
        await db.execute(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
          ['platform_status', parsed.data.platform_status, req.admin.id]
        );
      }

      if (parsed.data.maintenance_mode !== undefined) {
        await db.execute(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
          ['maintenance_mode', String(parsed.data.maintenance_mode), req.admin.id]
        );
      }

      if (parsed.data.module_key || parsed.data.platform_status || parsed.data.maintenance_mode !== undefined) {
        const details = {};
        if (parsed.data.module_key) details.module_key = parsed.data.module_key;
        if (parsed.data.is_locked !== undefined) details.is_locked = parsed.data.is_locked;
        if (parsed.data.lock_reason) details.lock_reason = parsed.data.lock_reason;
        if (parsed.data.platform_status) details.platform_status = parsed.data.platform_status;
        if (parsed.data.maintenance_mode !== undefined) details.maintenance_mode = parsed.data.maintenance_mode;
        await writeAudit(db, { actorId: req.admin.id, action: 'security.lock_updated', entityType: 'security', entityId: parsed.data.module_key || 'platform', details, ip: req.ip });
      }
    });

    const state = getSystemLockState({
      platform_status: parsed.data.platform_status,
      maintenance_mode: parsed.data.maintenance_mode,
    });
    const moduleState = parsed.data.module_key ? getModuleLockState({ [parsed.data.module_key]: parsed.data.is_locked ?? false }, parsed.data.module_key) : { locked: false, reason: null };
    res.json({ data: { system: state, module: moduleState } });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/summary', async (req, res, next) => {
  try {
    const [[users]] = await pool.query(`SELECT COUNT(*) AS total_users, SUM(status = 'active') AS active_users FROM users`);
    const [[vendors]] = await pool.query(`SELECT COUNT(*) AS total_vendors, SUM(verification_status = 'pending') AS pending_vendors, SUM(verification_status = 'verified') AS verified_vendors FROM vendor_profiles`);
    const [[events]] = await pool.query(`SELECT COUNT(*) AS total_events, SUM(status = 'completed') AS completed_events FROM events`);
    const [[bookings]] = await pool.query(`SELECT COUNT(*) AS total_bookings, SUM(status = 'under_review') AS bookings_under_review FROM bookings`);
    const [[payments]] = await pool.query(`SELECT COUNT(*) AS total_payments, SUM(status = 'paid') AS confirmed_payments, SUM(status = 'refund_pending') AS refunds_pending FROM payments`);
    const [[complaints]] = await pool.query(`SELECT COUNT(*) AS open_complaints FROM complaints WHERE status IN ('open', 'investigating')`);
    res.json({ data: { users, vendors, events, bookings, payments, complaints } });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard/overview', async (req, res, next) => {
  const parsed = dashboardDateRangeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid date range no longer than 366 days.' });

  try {
    const data = await loadAdminDashboardOverview(pool, parsed.data);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get('/audit-logs', async (req, res, next) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const { page, pageSize, q } = parsed.data;

  try {
    const values = [];
    let where = '';
    if (q) {
      where = ' WHERE action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ?';
      values.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM audit_logs${where}`, values);
    const [rows] = await pool.execute(`SELECT id, actor_id, action, entity_type, entity_id, details, ip_address, created_at FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...values, Number(pageSize), Number((page - 1) * pageSize)]);
    res.json({ data: rows, pagination: { page, pageSize, total: countRows[0].total } });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value, updated_by, updated_at FROM system_settings ORDER BY setting_key');
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

router.put('/settings/:key', async (req, res, next) => {
  const key = String(req.params.key);
  const value = req.body?.value;
  if (!/^[a-z][a-z0-9_.-]{1,119}$/.test(key) || typeof value !== 'string' || value.length > 4000) {
    return res.status(400).json({ error: 'Setting key or value is invalid.' });
  }

  try {
    await inTransaction(async (db) => {
      await db.execute(
        'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
        [key, value, req.admin.id]
      );
      await writeAudit(db, { actorId: req.admin.id, action: 'settings.updated', entityType: 'system_setting', entityId: key, details: { key }, ip: req.ip });
    });
    res.json({ data: { setting_key: key, setting_value: value } });
  } catch (error) {
    next(error);
  }
});

router.patch('/profile', async (req, res, next) => {
  const parsed = z.object({
    full_name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().max(40).nullable().optional(),
  }).strict().safeParse(req.body);

  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: 'Provide a valid name or phone number.' });
  }

  try {
    const fields = Object.keys(parsed.data);
    await pool.execute(`UPDATE users SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.data[field]), req.admin.id]);
    const [[profile]] = await pool.execute('SELECT id, full_name, email, phone FROM users WHERE id = ?', [req.admin.id]);
    res.json({ user: profile });
  } catch (error) {
    next(error);
  }
});

router.post('/users', async (req, res, next) => {
  const parsed = z.object({
    full_name: z.string().trim().min(1).max(160),
    email: z.string().email().max(254),
    phone: z.string().max(40).optional(),
    password: z.string().min(16).max(128),
    role_id: z.coerce.number().int().positive(),
  }).strict().safeParse(req.body);

  if (!parsed.success) return sendError(res, parsed.error);

  try {
    const [roleRows] = await pool.execute('SELECT id FROM roles WHERE id = ? AND is_active = TRUE AND is_admin = FALSE', [parsed.data.role_id]);
    if (!roleRows.length) return res.status(400).json({ error: 'Select an active non-administrator role.' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const id = await inTransaction(async (db) => {
      const [created] = await db.execute('INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [parsed.data.full_name, parsed.data.email.toLowerCase(), parsed.data.phone || null, passwordHash]);
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [created.insertId, parsed.data.role_id]);
      await writeAudit(db, { actorId: req.admin.id, action: 'user.created', entityType: 'user', entityId: created.insertId, details: { email: parsed.data.email.toLowerCase(), role_id: parsed.data.role_id }, ip: req.ip });
      return created.insertId;
    });

    res.status(201).json({ data: { id } });
  } catch (error) {
    try {
      sendError(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.patch('/users/:id', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({
    full_name: z.string().trim().min(1).max(160).optional(),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(40).nullable().optional(),
  }).strict().safeParse(req.body);

  if (!id.success || !parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: 'Provide a valid name, email, or phone number.' });
  }

  try {
    await inTransaction(async (db) => {
      const fields = Object.keys(parsed.data);
      const values = fields.map((field) => (field === 'email' ? parsed.data[field].toLowerCase() : parsed.data[field]));
      const [result] = await db.execute(`UPDATE users SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...values, id.data]);
      if (!result.affectedRows) throw Object.assign(new Error('User not found.'), { status: 404 });
      await writeAudit(db, { actorId: req.admin.id, action: 'user.updated', entityType: 'user', entityId: id.data, details: { fields }, ip: req.ip });
    });
    res.json({ data: { id: id.data } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    try {
      sendError(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.patch('/users/:id/role', async (req, res, next) => {
  const userId = idSchema.safeParse(req.params.id);
  const roleId = idSchema.safeParse(req.body?.role_id);

  if (!userId.success || !roleId.success || userId.data === req.admin.id) {
    return res.status(400).json({ error: 'User and role are invalid; you cannot change your own role.' });
  }

  try {
    await inTransaction(async (db) => {
      const [[target]] = await db.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId.data]);
      const [[role]] = await db.execute('SELECT id FROM roles WHERE id = ? AND is_active = TRUE AND is_admin = FALSE', [roleId.data]);
      if (!target || !role) throw Object.assign(new Error('User or active non-admin role not found.'), { status: 404 });
      await db.execute('DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.is_admin = FALSE', [userId.data]);
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId.data, roleId.data]);
      await writeAudit(db, { actorId: req.admin.id, action: 'user.role_changed', entityType: 'user', entityId: userId.data, details: { role_id: roleId.data }, ip: req.ip });
    });

    res.json({ data: { id: userId.data, role_id: roleId.data } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch('/users/:id/status', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const status = z.enum(['active', 'suspended', 'pending']).safeParse(req.body?.status);
  const reason = z.string().trim().min(3).max(500).safeParse(req.body?.reason);

  if (!id.success || !status.success || !reason.success || (id.data === req.admin.id && status.data !== 'active')) {
    return res.status(400).json({ error: 'A valid status and reason are required; you cannot suspend your own account.' });
  }

  try {
    await inTransaction(async (db) => {
      const [[target]] = await db.execute('SELECT id, status FROM users WHERE id = ? FOR UPDATE', [id.data]);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (status.data === 'suspended') {
        const [[admins]] = await db.execute(`SELECT COUNT(*) AS total
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          JOIN users u ON u.id = ur.user_id
          WHERE r.is_admin = TRUE AND r.is_active = TRUE AND u.status = 'active' AND u.id <> ?`, [id.data]);
        const [[isAdmin]] = await db.execute('SELECT COUNT(*) AS total FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.is_admin = TRUE', [id.data]);
        if (isAdmin.total && admins.total === 0) throw Object.assign(new Error('Cannot suspend the last active administrator.'), { status: 409 });
      }
      await db.execute('UPDATE users SET status = ? WHERE id = ?', [status.data, id.data]);
      if (status.data !== 'active') await db.execute('DELETE FROM admin_sessions WHERE user_id = ?', [id.data]);
      await writeAudit(db, { actorId: req.admin.id, action: 'user.status_changed', entityType: 'user', entityId: id.data, details: { from: target.status, to: status.data, reason: reason.data }, ip: req.ip });
    });

    res.json({ data: { id: id.data, status: status.data } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/roles/:id/permissions', async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  if (!roleId.success) return res.status(400).json({ error: 'Role ID is invalid.' });
  try {
    const [rows] = await pool.execute('SELECT p.permission_key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.permission_key', [roleId.data]);
    res.json({ data: rows.map((row) => row.permission_key) });
  } catch (error) {
    next(error);
  }
});

router.patch('/roles/:id/permissions', async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  const parsed = z.object({ permission_keys: z.array(z.string().max(120)).max(100) }).strict().safeParse(req.body);
  if (!roleId.success || !parsed.success || parsed.data.permission_keys.includes('admin:*')) {
    return res.status(400).json({ error: 'Role or permissions are invalid; the global administrator permission cannot be delegated.' });
  }

  try {
    await inTransaction(async (db) => {
      const [[role]] = await db.execute('SELECT id, is_admin FROM roles WHERE id = ?', [roleId.data]);
      if (!role || role.is_admin) throw Object.assign(new Error('Role not found or administrator permissions cannot be edited.'), { status: 400 });
      const [permissions] = await db.execute(`SELECT id, permission_key FROM permissions WHERE permission_key IN (${parsed.data.permission_keys.map(() => '?').join(',') || 'NULL'})`, parsed.data.permission_keys);
      if (permissions.length !== new Set(parsed.data.permission_keys).size) throw Object.assign(new Error('One or more permissions do not exist.'), { status: 400 });
      await db.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId.data]);
      for (const permission of permissions) {
        await db.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId.data, permission.id]);
      }
      await writeAudit(db, { actorId: req.admin.id, action: 'role.permissions_changed', entityType: 'role', entityId: roleId.data, details: { permission_keys: parsed.data.permission_keys }, ip: req.ip });
    });
    res.json({ data: { role_id: roleId.data, permission_keys: parsed.data.permission_keys } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch('/vendors/:id/verification', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({ decision: z.enum(['verified', 'rejected']), reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body);
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: 'A valid decision and verification basis (at least 5 characters) are required.' });
  }

  try {
    await inTransaction(async (db) => {
      const [[vendor]] = await db.execute('SELECT id, verification_status FROM vendor_profiles WHERE id = ? FOR UPDATE', [id.data]);
      if (!vendor) throw Object.assign(new Error('Vendor not found.'), { status: 404 });
      if (!['pending', 'rejected'].includes(vendor.verification_status)) throw Object.assign(new Error('Only pending or previously rejected vendors may receive a new decision.'), { status: 409 });
      await db.execute('UPDATE vendor_profiles SET verification_status = ?, verification_reason = ?, verified_at = ? WHERE id = ?', [parsed.data.decision, parsed.data.reason, parsed.data.decision === 'verified' ? new Date() : null, id.data]);
      await writeAudit(db, { actorId: req.admin.id, action: `vendor.${parsed.data.decision}`, entityType: 'vendor', entityId: id.data, details: { from: vendor.verification_status, decision: parsed.data.decision, reason: parsed.data.reason }, ip: req.ip });
    });
    res.json({ data: { id: id.data, verification_status: parsed.data.decision } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch('/bookings/:id/moderation', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(['under_review', 'accepted', 'rejected', 'cancelled']), reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body);
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: 'A valid moderation status and reason are required.' });
  }

  try {
    await inTransaction(async (db) => {
      const [[booking]] = await db.execute('SELECT id, status FROM bookings WHERE id = ? FOR UPDATE', [id.data]);
      if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
      const allowedTransition = booking.status === 'under_review' ? ['accepted', 'rejected', 'cancelled', 'under_review'] : ['under_review', 'cancelled'];
      if (!allowedTransition.includes(parsed.data.status)) throw Object.assign(new Error('Invalid moderation transition for the current booking status.'), { status: 409 });
      await db.execute('UPDATE bookings SET status = ?, moderation_reason = ? WHERE id = ?', [parsed.data.status, parsed.data.reason, id.data]);
      await writeAudit(db, { actorId: req.admin.id, action: 'booking.moderated', entityType: 'booking', entityId: id.data, details: { from: booking.status, to: parsed.data.status, reason: parsed.data.reason }, ip: req.ip });
    });
    res.json({ data: { id: id.data, status: parsed.data.status } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/payments/:id/refunds', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const reason = z.string().trim().min(5).max(500).safeParse(req.body?.reason);
  if (!id.success || !reason.success) {
    return res.status(400).json({ error: 'A valid payment ID and refund reason are required.' });
  }

  try {
    const [[payment]] = await pool.execute('SELECT id, status FROM payments WHERE id = ?', [id.data]);
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    await writeAudit(pool, { actorId: req.admin.id, action: 'payment.refund_requested_unavailable', entityType: 'payment', entityId: id.data, details: { status: payment.status, reason: reason.data, outcome: 'not_processed_provider_unconfigured' }, ip: req.ip });
    res.status(503).json({ error: 'Refunds are unavailable: no verified payment provider is configured. No refund was initiated.' });
  } catch (error) {
    next(error);
  }
});

router.get('/event-package-requests', async (req, res, next) => {
  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const { page, pageSize, q, status } = parsed.data;
  if (status && !['new', 'reviewed', 'replied', 'closed'].includes(status)) return res.status(400).json({ error: 'Status filter is invalid.' });

  const clauses = [];
  const values = [];
  if (q) {
    clauses.push('(r.event_title LIKE ? OR r.requester_name LIKE ? OR r.requester_email LIKE ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    clauses.push('r.status = ?');
    values.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  try {
    const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM event_package_requests r${where}`, values);
    const [rows] = await pool.execute(
      `SELECT r.id, r.event_id, r.event_title, r.event_type, r.requested_date, r.requested_location,
              r.requester_name, r.requester_email, r.service_category, r.guest_count, r.budget,
              r.notes, r.status, r.created_at
       FROM event_package_requests r${where}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize]
    );
    res.json({ data: rows, pagination: { page, pageSize, total: Number(countRow.total) } });
  } catch (error) {
    next(error);
  }
});

router.patch('/event-package-requests/:id/status', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(['new', 'reviewed', 'replied', 'closed']) }).strict().safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'A valid request ID and status are required.' });

  try {
    const [result] = await pool.execute('UPDATE event_package_requests SET status = ? WHERE id = ?', [parsed.data.status, id.data]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Package request not found.' });
    await writeAudit(pool, { actorId: req.admin.id, action: 'event_package_request.status_updated', entityType: 'event_package_request', entityId: id.data, details: { status: parsed.data.status }, ip: req.ip });
    res.json({ data: { id: id.data, status: parsed.data.status } });
  } catch (error) {
    next(error);
  }
});

router.post('/:resource', async (req, res, next) => {
  const resource = getResource(req.params.resource);
  if (!resource || !resource.mutable) return res.status(404).json({ error: 'Resource not found or not creatable.' });

  try {
    const body = validBody(resource, req.body, true);
    const fields = Object.keys(body);
    const [result] = await pool.execute(`INSERT INTO ${resource.table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map((field) => body[field]));
    await writeAudit(pool, { actorId: req.admin.id, action: `${req.params.resource}.created`, entityType: req.params.resource, entityId: result.insertId, details: { fields }, ip: req.ip });
    res.status(201).json({ data: { id: result.insertId } });
  } catch (error) {
    try {
      sendError(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.patch('/:resource/:id', async (req, res, next) => {
  const resource = getResource(req.params.resource);
  const id = idSchema.safeParse(req.params.id);
  if (!resource || !resource.mutable || !id.success) return res.status(404).json({ error: 'Resource or record not found.' });
  if (req.params.resource === 'users') return res.status(405).json({ error: 'Use the dedicated user update endpoint.' });

  try {
    const body = validBody(resource, req.body, false);
    const fields = Object.keys(body);
    if (!fields.length) return res.status(400).json({ error: 'Provide at least one editable field.' });
    const [result] = await pool.execute(`UPDATE ${resource.table} SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE ${resource.id} = ?`, [...fields.map((field) => body[field]), id.data]);
    if (!result.affectedRows) throw Object.assign(new Error('Record not found.'), { status: 404 });
    await writeAudit(pool, { actorId: req.admin.id, action: `${req.params.resource}.updated`, entityType: req.params.resource, entityId: id.data, details: { fields }, ip: req.ip });
    res.json({ data: { id: id.data } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    try {
      sendError(res, error);
    } catch (unhandled) {
      next(unhandled);
    }
  }
});

router.delete('/:resource/:id', async (req, res, next) => {
  const resource = getResource(req.params.resource);
  const id = idSchema.safeParse(req.params.id);
  if (!resource || !resource.deactivate || !id.success) return res.status(405).json({ error: 'This resource cannot be deactivated through this endpoint.' });
  if (req.params.resource === 'users') return res.status(405).json({ error: 'Use the audited account status action.' });

  try {
    const [result] = await pool.execute(`UPDATE ${resource.table} SET ${resource.deactivate.column} = ? WHERE ${resource.id} = ?`, [resource.deactivate.value, id.data]);
    if (!result.affectedRows) throw Object.assign(new Error('Record not found.'), { status: 404 });
    await writeAudit(pool, { actorId: req.admin.id, action: `${req.params.resource}.deactivated`, entityType: req.params.resource, entityId: id.data, details: { field: resource.deactivate.column, value: resource.deactivate.value }, ip: req.ip });
    res.status(204).end();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/:resource', async (req, res, next) => {
  const resource = getResource(req.params.resource);
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });

  const parsed = pageSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);

  const { page, pageSize, q, status } = parsed.data;
  if (status && resource.statuses && !resource.statuses.includes(status)) return res.status(400).json({ error: 'Status filter is invalid.' });

  try {
    const { where, values } = getListQuery(resource, q, status);
    const countBase = `SELECT COUNT(*) AS total FROM ${resource.table}`;
    const [countRows] = await pool.execute(`${countBase}${where}`, values);
    const baseSelect = resource.query ? resource.query : `SELECT ${resource.columns.join(', ')} FROM ${resource.table}`;
    const [rows] = await pool.execute(`${baseSelect}${where}${resource.group || ''} ORDER BY ${resource.id} DESC LIMIT ? OFFSET ?`, [...values, Number(pageSize), Number((page - 1) * pageSize)]);
    res.json({ data: rows, pagination: { page, pageSize, total: countRows[0].total } });
  } catch (error) {
    next(error);
  }
});

export default router;
