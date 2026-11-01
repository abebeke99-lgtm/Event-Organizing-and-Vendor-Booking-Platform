import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { hasPermission } from '../lib/rbac.js';
import { sanitizeAuditDetails } from '../lib/security.js';

const router = Router();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional().default(''),
  actor: z.string().trim().max(120).optional().default(''),
  action: z.string().trim().max(120).optional().default(''),
  module: z.string().trim().max(80).optional().default(''),
  entityType: z.string().trim().max(80).optional().default(''),
  entityId: z.string().trim().max(80).optional().default(''),
  requestId: z.string().trim().max(64).optional().default(''),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum(['created_at', 'action', 'actor_name', 'entity_type', 'severity']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
}).strict();
const exportSchema = listSchema.omit({ page: true, pageSize: true });

function buildAuditFilters(filters) {
  const clauses = [];
  const values = [];
  if (filters.q) {
    const term = `%${filters.q}%`;
    clauses.push(`(CAST(a.actor_id AS CHAR) LIKE ? OR u.full_name LIKE ? OR a.action LIKE ?
      OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.request_id LIKE ?)`);
    values.push(term, term, term, term, term, term);
  }
  if (filters.actor) {
    clauses.push('(CAST(a.actor_id AS CHAR) = ? OR u.full_name LIKE ?)');
    values.push(filters.actor, `%${filters.actor}%`);
  }
  if (filters.action) {
    clauses.push('a.action = ?');
    values.push(filters.action);
  }
  if (filters.module) {
    clauses.push("SUBSTRING_INDEX(a.action, '.', 1) = ?");
    values.push(filters.module);
  }
  if (filters.entityType) {
    clauses.push('a.entity_type = ?');
    values.push(filters.entityType);
  }
  if (filters.entityId) {
    clauses.push('a.entity_id = ?');
    values.push(filters.entityId);
  }
  if (filters.requestId) {
    clauses.push('a.request_id = ?');
    values.push(filters.requestId);
  }
  if (filters.severity) {
    clauses.push('a.severity = ?');
    values.push(filters.severity);
  }
  if (filters.outcome) {
    clauses.push('a.outcome = ?');
    values.push(filters.outcome);
  }
  if (filters.dateFrom) {
    clauses.push('a.created_at >= ?');
    values.push(`${filters.dateFrom} 00:00:00`);
  }
  if (filters.dateTo) {
    clauses.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(filters.dateTo);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function parseDetails(value) {
  let details = value;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      return null;
    }
  }
  return sanitizeAuditDetails(details);
}

function mapAuditRow(row) {
  return {
    ...row,
    id: Number(row.id),
    actor_id: Number(row.actor_id),
    details: parseDetails(row.details),
  };
}

const baseQuery = `FROM audit_logs a
  LEFT JOIN users u ON u.id = a.actor_id`;
const selectFields = `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action,
  a.entity_type, a.entity_id, a.details, a.ip_address, a.request_id,
  a.outcome, a.severity, a.created_at,
  SUBSTRING_INDEX(a.action, '.', 1) AS module`;
const sortColumns = {
  created_at: 'a.created_at',
  action: 'a.action',
  actor_name: 'u.full_name',
  entity_type: 'a.entity_type',
  severity: 'a.severity',
};

function validDate(value) {
  if (!value) return true;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.get('/audit-logs/options', requirePermission('audit_logs.view'), asyncHandler(async (req, res) => {
  const database = req.app.locals.database;
  const [actions] = await database.execute(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 200',
  );
  const [modules] = await database.execute(
    "SELECT DISTINCT SUBSTRING_INDEX(action, '.', 1) AS module FROM audit_logs ORDER BY module LIMIT 100",
  );
  res.json({
    data: {
      actions: actions.map((row) => row.action),
      modules: modules.map((row) => row.module),
      canExport: hasPermission(req.permissions, 'audit_logs.export'),
    },
  });
}));

router.get('/audit-logs', requirePermission('audit_logs.view'), asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Audit log filters are invalid.' });
  const filters = parsed.data;
  if (!validDate(filters.dateFrom) || !validDate(filters.dateTo)) {
    return res.status(400).json({ error: 'Audit log dates must be valid calendar dates.' });
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return res.status(400).json({ error: 'The start date must be on or before the end date.' });
  }
  const { where, values } = buildAuditFilters(filters);
  const database = req.app.locals.database;
  const [[count]] = await database.execute(
    `SELECT COUNT(*) AS total ${baseQuery} ${where}`,
    values,
  );
  const [rows] = await database.execute(
    `${selectFields} ${baseQuery} ${where}
     ORDER BY ${sortColumns[filters.sortBy]} ${filters.sortDirection.toUpperCase()}, a.id DESC
     LIMIT ? OFFSET ?`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize],
  );
  res.json({
    data: rows.map(mapAuditRow),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(count.total),
    },
  });
}));

function csvCell(value) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

router.get('/audit-logs/export', requirePermission('audit_logs.export'), asyncHandler(async (req, res) => {
  const parsed = exportSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Audit log export filters are invalid.' });
  const filters = parsed.data;
  if (!validDate(filters.dateFrom) || !validDate(filters.dateTo)) {
    return res.status(400).json({ error: 'Audit log dates must be valid calendar dates.' });
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return res.status(400).json({ error: 'The start date must be on or before the end date.' });
  }
  const { where, values } = buildAuditFilters(filters);
  const database = req.app.locals.database;
  const [[count]] = await database.execute(
    `SELECT COUNT(*) AS total ${baseQuery} ${where}`,
    values,
  );
  if (Number(count.total) > 10000) {
    return res.status(413).json({ error: 'More than 10,000 audit records match. Narrow the date range or filters before exporting.' });
  }
  const [rows] = await database.execute(
    `${selectFields} ${baseQuery} ${where}
     ORDER BY ${sortColumns[filters.sortBy]} ${filters.sortDirection.toUpperCase()}, a.id DESC
     LIMIT 10000`,
    values,
  );
  const headers = [
    'id', 'actor_id', 'actor_name', 'action', 'module', 'entity_type', 'entity_id',
    'outcome', 'severity', 'created_at', 'request_id', 'ip_address', 'details',
  ];
  const lines = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => {
      const record = mapAuditRow(row);
      return headers.map((header) => csvCell(record[header])).join(',');
    }),
  ];
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  res.send(lines.join('\r\n'));
}));

export default router;
