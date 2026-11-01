import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getPasswordResetEmailConfig, sendPasswordResetOtpEmail } from '../lib/passwordResetEmail.js';
import { createPasswordResetOtp, hashPasswordResetOtp } from '../lib/passwordResetOtp.js';
import { pool, inTransaction } from '../db.js';
import {
  ASSIGNABLE_PLATFORM_ROLES,
  describePermission,
  getModuleLockState,
  getRolePermissionPolicy,
  getSystemLockState,
  isCriticalPermission,
  ROLE_PERMISSION_MATRIX,
} from '../lib/rbac.js';
import { writeAudit } from '../lib/security.js';
import { dashboardDateRangeSchema, loadAdminDashboardOverview } from '../lib/dashboardFilters.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { getProfilePhoto, profilePhotoUploadParser, removeProfilePhoto, saveProfilePhoto } from '../lib/profilePhoto.js';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SYSTEM_SETTING_SCHEMAS,
  loadSystemSettings,
  mergeSystemSettings,
  serializeSystemSettingValue,
  systemSettingsPatchSchema,
  updateSystemSettingsCache,
} from '../lib/systemSettings.js';

const router = Router();
const profilePhotoParser = profilePhotoUploadParser(express);
const idSchema = z.coerce.number().int().positive();
const userListSchema = z.object({
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
const roleListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).strict();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(120).optional(),
  status: z.string().max(40).optional(),
});
const vendorVerificationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(['pending', 'under_review', 'information_requested', 'verified', 'rejected', 'suspended']).optional(),
}).strict();
const vendorVerificationStatusSchema = z.object({
  status: z.enum(['under_review', 'verified', 'rejected', 'information_requested', 'suspended']),
  reason: z.string().trim().min(5).max(1000),
}).strict();

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
    mutable: [],
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
    mutable: ['business_name', 'category_id', 'city', 'description'],
    required: ['business_name'],
  },
  events: {
    table: 'events',
    id: 'id',
    columns: ['id', 'organizer_id', 'title', 'event_type', 'description', 'city', 'venue', 'cover_image_url', 'start_date', 'end_date', 'budget', 'capacity', 'status', 'notes', 'created_at'],
    search: ['title', 'event_type', 'city', 'venue'],
    statuses: ['draft', 'active', 'booked', 'in_progress', 'completed', 'cancelled'],
    mutable: ['organizer_id', 'title', 'event_type', 'description', 'city', 'venue', 'cover_image_url', 'start_date', 'end_date', 'budget', 'capacity', 'status', 'notes'],
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

function getDatabase(req) {
  return req.app?.locals?.database || pool;
}

async function inDatabaseTransaction(database, work) {
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

async function transitionVendorVerification(database, { vendorId, actorId, status, reason, ip }) {
  const [[vendor]] = await database.execute(
    'SELECT id, user_id, verification_status FROM vendor_profiles WHERE id = ? FOR UPDATE',
    [vendorId],
  );
  if (!vendor) throw Object.assign(new Error('Vendor application not found.'), { status: 404 });
  if (Number(vendor.user_id) === Number(actorId)) {
    throw Object.assign(new Error('Administrators cannot review their own vendor applications.'), { status: 403 });
  }

  const allowedTransitions = {
    pending: ['under_review'],
    under_review: ['verified', 'rejected', 'information_requested'],
    information_requested: ['under_review'],
    verified: ['suspended'],
    suspended: ['verified'],
    rejected: [],
  };
  if (!(allowedTransitions[vendor.verification_status] || []).includes(status)) {
    throw Object.assign(new Error(`Cannot change vendor application from ${vendor.verification_status} to ${status}.`), { status: 409 });
  }

  await database.execute(
    `UPDATE vendor_profiles
     SET verification_status = ?, verification_reason = ?,
         verified_at = CASE WHEN ? = 'verified' THEN NOW() WHEN ? = 'rejected' THEN NULL ELSE verified_at END
     WHERE id = ?`,
    [status, reason, status, status, vendorId],
  );
  await database.execute(
    `INSERT INTO vendor_verification_history (vendor_id, actor_id, from_status, to_status, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [vendorId, actorId, vendor.verification_status, status, reason],
  );
  const notice = {
    under_review: ['Vendor application under review', 'Your vendor application is now under review.'],
    verified: ['Vendor application approved', 'Your vendor application has been approved.'],
    rejected: ['Vendor application update', `Your vendor application was not approved: ${reason}`],
    information_requested: ['More information requested', `Please provide additional information for your vendor application: ${reason}`],
    suspended: ['Vendor account suspended', `Your vendor account has been suspended: ${reason}`],
  }[status];
  if (notice) {
    await database.execute(
      'INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)',
      [vendor.user_id, notice[0], notice[1]],
    );
  }
  await writeAudit(database, {
    actorId,
    action: `vendor.${status}`,
    entityType: 'vendor',
    entityId: vendorId,
    details: { from: vendor.verification_status, to: status, reason },
    ip,
  });
  return { id: vendorId, verification_status: status, previous_status: vendor.verification_status };
}

function isValidDate(value) {
  if (!value) return true;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

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
  if (resource.table === 'events' && body.cover_image_url) {
    let imageUrl;
    try {
      imageUrl = new URL(body.cover_image_url);
    } catch {
      throw Object.assign(new Error('Invalid request data.'), {
        name: 'ZodError',
        issues: [{ path: ['cover_image_url'], message: 'Enter a valid HTTP image URL.' }],
      });
    }
    if (!['http:', 'https:'].includes(imageUrl.protocol)) {
      throw Object.assign(new Error('Invalid request data.'), {
        name: 'ZodError',
        issues: [{ path: ['cover_image_url'], message: 'Enter a valid HTTP image URL.' }],
      });
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

router.get('/permissions', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const database = getDatabase(req);
    const [rows] = await database.execute('SELECT id, permission_key, description FROM permissions ORDER BY permission_key');
    res.json({
      data: rows.map((row) => {
        const { module, action } = describePermission(row.permission_key);
        return {
          ...row,
          module,
          action,
          critical: isCriticalPermission(row.permission_key),
          assignable_roles: ASSIGNABLE_PLATFORM_ROLES.filter((role) => getRolePermissionPolicy(role).includes(row.permission_key)),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/roles', requirePermission('roles.manage'), async (req, res, next) => {
  const parsed = roleListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const { page, pageSize, q, status } = parsed.data;
  const database = getDatabase(req);
  const conditions = [];
  const values = [];
  if (q) {
    conditions.push('(r.name LIKE ? OR COALESCE(r.description, \'\') LIKE ?)');
    values.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    conditions.push('r.is_active = ?');
    values.push(status === 'active' ? 1 : 0);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  try {
    const [[count]] = await database.execute(`SELECT COUNT(*) AS total FROM roles r${where}`, values);
    const [roleRows] = await database.execute(
      `SELECT r.id, r.name, r.description, r.is_admin, r.is_active, r.created_at,
         COUNT(DISTINCT ur.user_id) AS user_count,
         COUNT(DISTINCT rp.permission_id) AS permission_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       ${where}
       GROUP BY r.id, r.name, r.description, r.is_admin, r.is_active, r.created_at
       ORDER BY r.is_admin DESC, r.name ASC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    const rows = roleRows.map((role) => ({
      ...role,
      is_assignable: !role.is_admin && ASSIGNABLE_PLATFORM_ROLES.includes(String(role.name).toLowerCase()),
      permission_policy_count: getRolePermissionPolicy(role.name).length,
    }));
    res.json({ data: rows, pagination: { page, pageSize, total: Number(count.total) } });
  } catch (error) {
    next(error);
  }
});

router.get('/roles/:id/users', requirePermission('roles.manage'), async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(120).optional(),
  }).strict().safeParse(req.query);
  if (!roleId.success || !parsed.success) return res.status(400).json({ error: 'Role or pagination filters are invalid.' });
  const database = getDatabase(req);
  const { page, pageSize, q } = parsed.data;
  const conditions = ['ur.role_id = ?'];
  const values = [roleId.data];
  if (q) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR CAST(u.id AS CHAR) = ?)');
    values.push(`%${q}%`, `%${q}%`, q);
  }
  const where = ` WHERE ${conditions.join(' AND ')}`;
  try {
    const [[role]] = await database.execute('SELECT id, name FROM roles WHERE id = ?', [roleId.data]);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    const [[count]] = await database.execute(
      `SELECT COUNT(DISTINCT u.id) AS total FROM users u JOIN user_roles ur ON ur.user_id = u.id${where}`,
      values,
    );
    const [rows] = await database.execute(
      `SELECT u.id, u.full_name, u.email, u.status, u.created_at
       FROM users u JOIN user_roles ur ON ur.user_id = u.id${where}
       ORDER BY u.full_name ASC, u.id ASC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    res.json({ data: rows, role, pagination: { page, pageSize, total: Number(count.total) } });
  } catch (error) {
    next(error);
  }
});

router.post('/roles', requirePermission('roles.manage'), (req, res) => {
  res.status(405).json({ error: 'Only the approved system roles can be managed.' });
});

router.patch('/roles/:id/status', requirePermission('roles.manage'), async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  const parsed = z.object({ is_active: z.boolean() }).strict().safeParse(req.body);
  if (!roleId.success || !parsed.success) return res.status(400).json({ error: 'Role status is invalid.' });
  const database = getDatabase(req);
  try {
    await inDatabaseTransaction(database, async (db) => {
      const [[role]] = await db.execute(
        'SELECT id, name, is_admin, is_active FROM roles WHERE id = ? FOR UPDATE',
        [roleId.data],
      );
      if (!role) throw Object.assign(new Error('Role not found.'), { status: 404 });
      if (Boolean(role.is_active) === parsed.data.is_active) return;
      if (!parsed.data.is_active && role.is_admin) {
        const [[admins]] = await db.execute(
          `SELECT COUNT(DISTINCT u.id) AS total
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles active_admin_role ON active_admin_role.id = ur.role_id
           WHERE u.status = 'active' AND active_admin_role.is_admin = TRUE
             AND active_admin_role.is_active = TRUE AND active_admin_role.id <> ?`,
          [roleId.data],
        );
        if (Number(admins.total) === 0) {
          throw Object.assign(new Error('Cannot disable the last active Administrator role.'), { status: 409 });
        }
      } else if (!parsed.data.is_active) {
        const [[assigned]] = await db.execute(
          'SELECT COUNT(DISTINCT user_id) AS total FROM user_roles WHERE role_id = ?',
          [roleId.data],
        );
        if (Number(assigned.total) > 0) {
          throw Object.assign(new Error('Reassign users before disabling this role.'), { status: 409 });
        }
      }

      await db.execute('UPDATE roles SET is_active = ? WHERE id = ?', [parsed.data.is_active, roleId.data]);
      if (!parsed.data.is_active && role.is_admin) {
        await db.execute(
          `DELETE s FROM admin_sessions s
           JOIN user_roles ur ON ur.user_id = s.user_id
           WHERE ur.role_id = ?`,
          [roleId.data],
        );
      }
      await writeAudit(db, {
        actorId: req.admin.id,
        action: 'role.status_changed',
        entityType: 'role',
        entityId: roleId.data,
        details: { name: role.name, from: Boolean(role.is_active), to: parsed.data.is_active },
        ip: req.ip,
      });
    });
    res.json({ data: { id: roleId.data, is_active: parsed.data.is_active } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.patch('/roles/:id', requirePermission('roles.manage'), (req, res) => {
  res.status(405).json({ error: 'Role names and system role properties are protected.' });
});

router.delete('/roles/:id', requirePermission('roles.manage'), (req, res) => {
  res.status(405).json({ error: 'System roles cannot be deleted.' });
});

router.get('/rbac/matrix', requirePermission('roles.manage'), async (req, res, next) => {
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
    const [rows] = await getDatabase(req).execute(
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

    const updatedSystemSettings = {};
    if (parsed.data.platform_status !== undefined) updatedSystemSettings.platform_status = parsed.data.platform_status;
    if (parsed.data.maintenance_mode !== undefined) updatedSystemSettings.maintenance_mode = parsed.data.maintenance_mode;
    if (Object.keys(updatedSystemSettings).length) updateSystemSettingsCache(req.app, updatedSystemSettings);

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
    const supportedKeys = Object.keys(SYSTEM_SETTING_SCHEMAS);
    const placeholders = supportedKeys.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT setting_key, setting_value, updated_at FROM system_settings WHERE setting_key IN (${placeholders}) ORDER BY setting_key`,
      supportedKeys,
    );
    const settings = mergeSystemSettings(rows);
    const savedRows = new Map(rows.map((row) => [row.setting_key, row]));
    const data = Object.entries(settings).map(([setting_key, setting_value]) => ({
      setting_key,
      setting_value,
      updated_at: savedRows.get(setting_key)?.updated_at ?? null,
    }));
    res.json({ data, settings });
  } catch (error) {
    next(error);
  }
});

router.patch('/settings', async (req, res, next) => {
  const parsed = systemSettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'One or more settings are invalid or unsupported.',
      details: parsed.error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
    });
  }

  try {
    const currentSettings = await loadSystemSettings(pool);
    const entries = Object.entries(parsed.data);
    await inTransaction(async (db) => {
      for (const [key, value] of entries) {
        await db.execute(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
          [key, serializeSystemSettingValue(value), req.admin.id],
        );
      }
      await writeAudit(db, {
        actorId: req.admin.id,
        action: 'settings.updated',
        entityType: 'system_settings',
        details: { keys: entries.map(([key]) => key) },
        ip: req.ip,
      });
    });

    const settings = { ...currentSettings, ...parsed.data };
    updateSystemSettingsCache(req.app, settings);
    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
});

router.post('/settings/reset', async (req, res, next) => {
  try {
    await inTransaction(async (db) => {
      for (const [key, value] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
        await db.execute(
          'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
          [key, serializeSystemSettingValue(value), req.admin.id],
        );
      }
      await writeAudit(db, {
        actorId: req.admin.id,
        action: 'settings.reset',
        entityType: 'system_settings',
        details: { keys: Object.keys(DEFAULT_SYSTEM_SETTINGS) },
        ip: req.ip,
      });
    });

    updateSystemSettingsCache(req.app, DEFAULT_SYSTEM_SETTINGS);
    res.json({ data: DEFAULT_SYSTEM_SETTINGS });
  } catch (error) {
    next(error);
  }
});

router.put('/settings/:key', async (req, res, next) => {
  const key = String(req.params.key);
  const rawValue = req.body?.value;
  const value = ['maintenance_mode', 'public_registration_enabled'].includes(key) && ['true', 'false'].includes(rawValue)
    ? rawValue === 'true'
    : rawValue;
  const parsed = systemSettingsPatchSchema.safeParse({ [key]: value });
  if (!parsed.success) {
    return res.status(400).json({ error: 'Setting key or value is invalid.' });
  }

  try {
    await inTransaction(async (db) => {
      await db.execute(
        'INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
        [key, serializeSystemSettingValue(parsed.data[key]), req.admin.id]
      );
      await writeAudit(db, { actorId: req.admin.id, action: 'settings.updated', entityType: 'system_setting', entityId: key, details: { key }, ip: req.ip });
    });
    updateSystemSettingsCache(req.app, parsed.data);
    res.json({ data: { setting_key: key, setting_value: parsed.data[key] } });
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

router.get('/profile/photo', asyncHandler(async (req, res) => getProfilePhoto(pool, req.admin.id, res)));
router.put('/profile/photo', profilePhotoParser, asyncHandler(async (req, res) => saveProfilePhoto(pool, req.admin.id, req, res)));
router.delete('/profile/photo', asyncHandler(async (req, res) => removeProfilePhoto(pool, req.admin.id, res)));

router.get('/users', async (req, res, next) => {
  const parsed = userListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const { page, pageSize, q, status, role, dateFrom, dateTo, sortBy, sortDirection } = parsed.data;
  if (!isValidDate(dateFrom) || !isValidDate(dateTo) || (dateFrom && dateTo && dateFrom > dateTo)) {
    return res.status(400).json({ error: 'Registration date range is invalid.' });
  }

  const database = getDatabase(req);
  const conditions = [];
  const values = [];
  if (q) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(u.phone, \'\') LIKE ? OR CAST(u.id AS CHAR) = ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (status) {
    conditions.push('u.status = ?');
    values.push(status);
  }
  if (role) {
    conditions.push(`EXISTS (
      SELECT 1 FROM user_roles filter_ur
      JOIN roles filter_r ON filter_r.id = filter_ur.role_id
      WHERE filter_ur.user_id = u.id AND LOWER(filter_r.name) = LOWER(?)
    )`);
    values.push(role);
  }
  if (dateFrom) {
    conditions.push('u.created_at >= ?');
    values.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    conditions.push('u.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(`${dateTo} 00:00:00`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const orderColumns = {
    id: 'u.id',
    full_name: 'u.full_name',
    email: 'u.email',
    status: 'u.status',
    created_at: 'u.created_at',
    roles: 'roles',
  };

  try {
    const [[count]] = await database.execute(`SELECT COUNT(*) AS total FROM users u${where}`, values);
    const [rows] = await database.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles,
        MIN(CASE WHEN r.is_admin = FALSE THEN r.id END) AS role_id,
        (SELECT COUNT(DISTINCT b.id)
         FROM bookings b
         LEFT JOIN events e ON e.id = b.event_id
         LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
         WHERE e.organizer_id = u.id OR vp.user_id = u.id) AS bookings_count
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       ${where}
       GROUP BY u.id, u.full_name, u.email, u.phone, u.status, u.created_at
       ORDER BY ${orderColumns[sortBy]} ${sortDirection.toUpperCase()}, u.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    res.json({
      data: rows,
      pagination: { page, pageSize, total: Number(count.total) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'User ID is invalid.' });
  const database = getDatabase(req);
  try {
    const [rows] = await database.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS roles,
        MIN(CASE WHEN r.is_admin = FALSE THEN r.id END) AS role_id
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?
       GROUP BY u.id, u.full_name, u.email, u.phone, u.status, u.created_at`,
      [id.data],
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id/activity', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'User ID is invalid.' });
  const database = getDatabase(req);
  try {
    const [[user]] = await database.execute('SELECT id FROM users WHERE id = ?', [id.data]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const [bookings] = await database.execute(
      `SELECT b.id, b.service_description, b.quoted_amount, b.currency, b.status, b.created_at,
        e.title AS event_title, vp.business_name AS vendor_name,
        COALESCE(p.payment_count, 0) AS payment_count, COALESCE(p.paid_total, 0) AS paid_total
       FROM bookings b
       LEFT JOIN events e ON e.id = b.event_id
       LEFT JOIN vendor_profiles vp ON vp.id = b.vendor_id
       LEFT JOIN (
         SELECT booking_id, COUNT(*) AS payment_count,
           SUM(CASE WHEN status IN ('authorized', 'paid', 'refunded', 'refund_pending') THEN amount ELSE 0 END) AS paid_total
         FROM payments GROUP BY booking_id
       ) p ON p.booking_id = b.id
       WHERE e.organizer_id = ? OR vp.user_id = ?
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT 100`,
      [id.data, id.data],
    );
    const [activity] = await database.execute(
      `SELECT id, actor_id, action, entity_type, entity_id, created_at
       FROM audit_logs
       WHERE (entity_type = 'user' AND entity_id = ?) OR actor_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [String(id.data), id.data],
    );
    res.json({ data: { bookings, activity } });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/password-reset', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success || Object.keys(req.body || {}).length !== 0) {
    return res.status(400).json({ error: 'A valid user ID is required.' });
  }
  const database = getDatabase(req);
  const resetServices = req.app.locals.passwordReset || {};
  const emailConfigured = resetServices.emailConfigured || (() => Boolean(getPasswordResetEmailConfig()));
  if (!emailConfigured()) return res.status(503).json({ error: 'Password reset email is temporarily unavailable.' });

  try {
    const [users] = await database.execute('SELECT id, full_name, email FROM users WHERE id = ? LIMIT 1', [id.data]);
    const user = users[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const otp = (resetServices.otpGenerator || createPasswordResetOtp)();
    const { hash: otpHash, salt: otpSalt } = await (resetServices.otpHasher || hashPasswordResetOtp)(otp);

    await inDatabaseTransaction(database, async (connection) => {
      await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id.data]);
      const [[challenge]] = await connection.execute(
        `SELECT (last_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooldown_active
         FROM password_reset_otp_challenges WHERE user_id = ? LIMIT 1 FOR UPDATE`,
        [id.data],
      );
      if (challenge?.cooldown_active) {
        throw Object.assign(new Error('A reset code was sent recently. Try again shortly.'), { status: 409 });
      }
      await connection.execute(
        `INSERT INTO password_reset_otp_challenges
          (user_id, otp_hash, otp_salt, expires_at, failed_attempts, consumed_at,
           reset_token_hash, reset_token_expires_at, reset_token_used_at, last_sent_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0, NULL,
           NULL, NULL, NULL, NOW())
         ON DUPLICATE KEY UPDATE otp_hash = VALUES(otp_hash), otp_salt = VALUES(otp_salt),
           expires_at = VALUES(expires_at), failed_attempts = 0, consumed_at = NULL,
           reset_token_hash = NULL, reset_token_expires_at = NULL, reset_token_used_at = NULL,
           last_sent_at = NOW()`,
        [id.data, otpHash, otpSalt],
      );
      await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [id.data]);
      await writeAudit(connection, {
        actorId: req.admin.id,
        action: 'user.password_reset_initiated',
        entityType: 'user',
        entityId: id.data,
        details: { email: user.email },
        ip: req.ip,
      });
    });

    res.status(202).json({ message: 'A password reset verification code was sent to the user.' });
    setImmediate(() => {
      Promise.resolve()
        .then(() => (resetServices.emailSender || sendPasswordResetOtpEmail)({ email: user.email, name: user.full_name, otp }))
        .catch(async (error) => {
          console.error('Password reset email delivery failed.', error?.code || error?.name || 'EMAIL_DELIVERY_FAILED');
          try {
            await database.execute(
              `UPDATE password_reset_otp_challenges
               SET expires_at = NOW(), consumed_at = NOW()
               WHERE user_id = ? AND otp_hash = ?`,
              [id.data, otpHash],
            );
          } catch (invalidationError) {
            console.error('Failed to invalidate undelivered password reset code.', invalidationError?.code || invalidationError?.name || 'DATABASE_ERROR');
          }
        });
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post('/users', async (req, res, next) => {
  const parsed = z.object({
    full_name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
    phone: z.string().trim().max(40).optional(),
    password: z.string().min(16).max(128),
    role_id: z.coerce.number().int().positive(),
  }).strict().safeParse(req.body);

  if (!parsed.success) return sendError(res, parsed.error);

  try {
    const database = getDatabase(req);
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const id = await inDatabaseTransaction(database, async (db) => {
      const [[role]] = await db.execute('SELECT id, name FROM roles WHERE id = ? AND is_active = TRUE AND is_admin = FALSE FOR UPDATE', [parsed.data.role_id]);
      if (!role || !ASSIGNABLE_PLATFORM_ROLES.includes(String(role.name).toLowerCase())) {
        throw Object.assign(new Error('Select an active approved platform role.'), { status: 400 });
      }
      const [[existing]] = await db.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [parsed.data.email]);
      if (existing) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
      const [created] = await db.execute('INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [parsed.data.full_name, parsed.data.email.toLowerCase(), parsed.data.phone || null, passwordHash]);
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [created.insertId, parsed.data.role_id]);
      await writeAudit(db, { actorId: req.admin.id, action: 'user.created', entityType: 'user', entityId: created.insertId, details: { email: parsed.data.email.toLowerCase(), role_id: parsed.data.role_id }, ip: req.ip });
      return created.insertId;
    });

    res.status(201).json({ data: { id } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
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
    email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  }).strict().safeParse(req.body);

  if (!id.success || !parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: 'Provide a valid name, email, or phone number.' });
  }

  try {
    const database = getDatabase(req);
    await inDatabaseTransaction(database, async (db) => {
      const fields = Object.keys(parsed.data);
      const values = fields.map((field) => (field === 'email' ? parsed.data[field].toLowerCase() : parsed.data[field]));
      const [[target]] = await db.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id.data]);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (parsed.data.email) {
        const [[existing]] = await db.execute(
          'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1',
          [parsed.data.email, id.data],
        );
        if (existing) throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
      }
      await db.execute(`UPDATE users SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...values, id.data]);
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
    const database = getDatabase(req);
    await inDatabaseTransaction(database, async (db) => {
      const [[target]] = await db.execute(
        `SELECT u.id, EXISTS (
          SELECT 1 FROM user_roles current_ur
          JOIN roles current_r ON current_r.id = current_ur.role_id
          WHERE current_ur.user_id = u.id AND current_r.is_admin = TRUE
        ) AS is_admin
         FROM users u WHERE u.id = ? FOR UPDATE`,
        [userId.data],
      );
      const [[role]] = await db.execute('SELECT id, name FROM roles WHERE id = ? AND is_active = TRUE AND is_admin = FALSE', [roleId.data]);
      if (!target || !role) throw Object.assign(new Error('User or active non-admin role not found.'), { status: 404 });
      if (!ASSIGNABLE_PLATFORM_ROLES.includes(String(role.name).toLowerCase())) {
        throw Object.assign(new Error('This role is not approved for user assignment.'), { status: 403 });
      }
      if (target.is_admin) throw Object.assign(new Error('Administrator roles cannot be changed through user management.'), { status: 409 });
      await db.execute('DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.is_admin = FALSE', [userId.data]);
      await db.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId.data, roleId.data]);
      await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId.data]);
      await db.execute('DELETE FROM admin_sessions WHERE user_id = ?', [userId.data]);
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
    const database = getDatabase(req);
    await inDatabaseTransaction(database, async (db) => {
      const [[target]] = await db.execute('SELECT id, status FROM users WHERE id = ? FOR UPDATE', [id.data]);
      if (!target) throw Object.assign(new Error('User not found.'), { status: 404 });
      if (status.data !== 'active') {
        const [[admins]] = await db.execute(`SELECT COUNT(*) AS total
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          JOIN users u ON u.id = ur.user_id
          WHERE r.is_admin = TRUE AND r.is_active = TRUE AND u.status = 'active' AND u.id <> ?`, [id.data]);
        const [[isAdmin]] = await db.execute('SELECT COUNT(*) AS total FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.is_admin = TRUE', [id.data]);
        if (isAdmin.total && admins.total === 0) throw Object.assign(new Error('Cannot deactivate the last active administrator.'), { status: 409 });
      }
      await db.execute('UPDATE users SET status = ? WHERE id = ?', [status.data, id.data]);
      if (status.data !== 'active') {
        await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [id.data]);
        await db.execute('DELETE FROM admin_sessions WHERE user_id = ?', [id.data]);
      }
      await writeAudit(db, { actorId: req.admin.id, action: 'user.status_changed', entityType: 'user', entityId: id.data, details: { from: target.status, to: status.data, reason: reason.data }, ip: req.ip });
    });

    res.json({ data: { id: id.data, status: status.data } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/roles/:id/permissions', requirePermission('roles.permissions.manage'), async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  if (!roleId.success) return res.status(400).json({ error: 'Role ID is invalid.' });
  try {
    const database = getDatabase(req);
    const [[role]] = await database.execute('SELECT id, name, is_admin, is_active FROM roles WHERE id = ?', [roleId.data]);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    const [rows] = await database.execute(
      'SELECT p.permission_key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.permission_key',
      [roleId.data],
    );
    const currentKeys = rows.map((row) => row.permission_key);
    res.json({
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
    next(error);
  }
});

router.patch('/roles/:id/permissions', requirePermission('roles.permissions.manage'), async (req, res, next) => {
  const roleId = idSchema.safeParse(req.params.id);
  const parsed = z.object({
    permission_keys: z.array(z.string().trim().min(1).max(120)).max(100),
  }).strict().safeParse(req.body);
  if (!roleId.success || !parsed.success || new Set(parsed.data.permission_keys).size !== parsed.data.permission_keys.length) {
    return res.status(400).json({ error: 'Role or permission selection is invalid.' });
  }

  try {
    const database = getDatabase(req);
    const updatedKeys = [...parsed.data.permission_keys].sort();
    await inDatabaseTransaction(database, async (db) => {
      const [[role]] = await db.execute('SELECT id, name, is_admin FROM roles WHERE id = ? FOR UPDATE', [roleId.data]);
      if (!role) throw Object.assign(new Error('Role not found.'), { status: 404 });
      if (role.is_admin) throw Object.assign(new Error('Administrator permissions are protected and cannot be edited.'), { status: 409 });
      const policyKeys = new Set(getRolePermissionPolicy(role.name));
      const forbidden = updatedKeys.filter((key) => !policyKeys.has(key) || isCriticalPermission(key));
      if (forbidden.length) {
        throw Object.assign(new Error('One or more permissions exceed this role’s approved security policy.'), { status: 403 });
      }
      const [permissions] = updatedKeys.length
        ? await db.execute(
          `SELECT id, permission_key FROM permissions WHERE permission_key IN (${updatedKeys.map(() => '?').join(',')})`,
          updatedKeys,
        )
        : [[]];
      if (permissions.length !== updatedKeys.length) {
        throw Object.assign(new Error('One or more approved permissions are not configured in the database.'), { status: 400 });
      }
      const [currentRows] = await db.execute(
        'SELECT p.permission_key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? FOR UPDATE',
        [roleId.data],
      );
      const currentKeys = currentRows.map((row) => row.permission_key);
      await db.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId.data]);
      for (const permission of permissions) {
        await db.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId.data, permission.id]);
      }
      await writeAudit(db, {
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
    res.json({ data: { role_id: roleId.data, permission_keys: updatedKeys } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.get('/vendor-verification', requirePermission('vendors.verify'), async (req, res, next) => {
  const parsed = vendorVerificationListSchema.safeParse(req.query);
  if (!parsed.success) return sendError(res, parsed.error);
  const { page, pageSize, q, status } = parsed.data;
  const clauses = [];
  const values = [];
  if (status) {
    clauses.push('vp.verification_status = ?');
    values.push(status);
  }
  if (q) {
    clauses.push(`(vp.business_name LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
      OR CAST(vp.id AS CHAR) = ?)`);
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const database = getDatabase(req);
  try {
    const [[count]] = await database.execute(
      `SELECT COUNT(*) AS total FROM vendor_profiles vp JOIN users u ON u.id = vp.user_id ${where}`,
      values,
    );
    const [rows] = await database.execute(
      `SELECT vp.id, vp.user_id, vp.business_name, vp.category_id, sc.name AS category_name,
              vp.city, vp.description, vp.verification_status, vp.verification_reason,
              vp.verified_at, vp.created_at, u.full_name AS owner_name, u.email, u.phone,
              (SELECT COUNT(*) FROM vendor_verification_documents d WHERE d.vendor_id = vp.id) AS document_count
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       LEFT JOIN service_categories sc ON sc.id = vp.category_id
       ${where}
       ORDER BY vp.created_at DESC, vp.id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    const [statusRows] = await database.execute(
      `SELECT verification_status, COUNT(*) AS total FROM vendor_profiles GROUP BY verification_status`,
    );
    const counts = Object.fromEntries(
      ['pending', 'under_review', 'information_requested', 'verified', 'rejected', 'suspended']
        .map((key) => [key, 0]),
    );
    for (const row of statusRows) counts[row.verification_status] = Number(row.total);
    res.json({
      data: rows.map((row) => ({
        ...row,
        id: Number(row.id),
        user_id: Number(row.user_id),
        document_count: Number(row.document_count),
      })),
      pagination: { page, pageSize, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / pageSize) },
      counts,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/vendor-verification/:id', requirePermission('vendors.verify'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Vendor application ID is invalid.' });
  const database = getDatabase(req);
  try {
    const [[vendor]] = await database.execute(
      `SELECT vp.id, vp.user_id, vp.business_name, vp.category_id, sc.name AS category_name,
              vp.city, vp.description, vp.verification_status, vp.verification_reason,
              vp.verified_at, vp.created_at, u.full_name AS owner_name, u.email, u.phone
       FROM vendor_profiles vp
       JOIN users u ON u.id = vp.user_id
       LEFT JOIN service_categories sc ON sc.id = vp.category_id
       WHERE vp.id = ?`,
      [id.data],
    );
    if (!vendor) return res.status(404).json({ error: 'Vendor application not found.' });
    const [documents] = await database.execute(
      `SELECT id, original_name, content_type, file_size, created_at
       FROM vendor_verification_documents WHERE vendor_id = ? ORDER BY created_at DESC`,
      [id.data],
    );
    const [history] = await database.execute(
      `SELECT h.id, h.from_status, h.to_status, h.reason, h.created_at,
              u.full_name AS actor_name
       FROM vendor_verification_history h
       LEFT JOIN users u ON u.id = h.actor_id
       WHERE h.vendor_id = ? ORDER BY h.created_at DESC, h.id DESC`,
      [id.data],
    );
    res.json({ data: { ...vendor, documents, history } });
  } catch (error) {
    next(error);
  }
});

router.get('/vendor-verification/:id/documents/:documentId', requirePermission('vendors.verify'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const documentId = idSchema.safeParse(req.params.documentId);
  if (!id.success || !documentId.success) return res.status(400).json({ error: 'Vendor document ID is invalid.' });
  try {
    const database = getDatabase(req);
    const [[document]] = await database.execute(
      `SELECT original_name, content_type, content
       FROM vendor_verification_documents WHERE id = ? AND vendor_id = ?`,
      [documentId.data, id.data],
    );
    if (!document) return res.status(404).json({ error: 'Vendor verification document not found.' });
    const safeName = String(document.original_name).replace(/[^A-Za-z0-9._-]/g, '_');
    res.set({
      'Content-Type': document.content_type,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(document.content);
  } catch (error) {
    next(error);
  }
});

router.patch('/vendor-verification/:id/status', requirePermission('vendors.verify'), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = vendorVerificationStatusSchema.safeParse(req.body || {});
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: 'Provide a valid status and a verification reason of at least 5 characters.' });
  }
  const database = getDatabase(req);
  try {
    const result = await inDatabaseTransaction(database, (connection) => transitionVendorVerification(connection, {
      vendorId: id.data,
      actorId: req.admin.id,
      status: parsed.data.status,
      reason: parsed.data.reason,
      ip: req.ip,
    }));
    res.json({ data: result });
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
    const result = await inDatabaseTransaction(getDatabase(req), (connection) => transitionVendorVerification(connection, {
      vendorId: id.data,
      actorId: req.admin.id,
      status: parsed.data.decision,
      reason: parsed.data.reason,
      ip: req.ip,
    }));
    res.json({ data: result });
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

router.post('/payments/:id/refunds', requirePermission('payments.refund'), async (req, res, next) => {
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
    const database = getDatabase(req);
    const { where, values } = getListQuery(resource, q, status);
    const countBase = `SELECT COUNT(*) AS total FROM ${resource.table}`;
    const [countRows] = await database.execute(`${countBase}${where}`, values);
    const baseSelect = resource.query ? resource.query : `SELECT ${resource.columns.join(', ')} FROM ${resource.table}`;
    const [rows] = await database.execute(`${baseSelect}${where}${resource.group || ''} ORDER BY ${resource.id} DESC LIMIT ? OFFSET ?`, [...values, Number(pageSize), Number((page - 1) * pageSize)]);
    res.json({ data: rows, pagination: { page, pageSize, total: countRows[0].total } });
  } catch (error) {
    next(error);
  }
});

export default router;
