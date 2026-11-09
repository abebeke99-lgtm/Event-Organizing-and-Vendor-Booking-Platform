import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { hasPermission } from '../lib/rbac.js';
import { sanitizeAuditDetails } from '../lib/security.js';

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
const baseQuery = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id`;
const selectFields = `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action,
  a.entity_type, a.entity_id, a.details, a.ip_address, a.request_id,
  a.outcome, a.severity, a.created_at, split_part(a.action, '.', 1) AS module`;
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

function buildAuditFilters(filters) {
  const clauses = [];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace('$n', `$${values.length}`));
  };
  if (filters.q) {
    const term = `%${filters.q}%`;
    values.push(term);
    const marker = `$${values.length}`;
    clauses.push(`(a.actor_id::text ILIKE ${marker} OR u.full_name ILIKE ${marker}
      OR a.action ILIKE ${marker} OR a.entity_type ILIKE ${marker}
      OR a.entity_id ILIKE ${marker} OR a.request_id ILIKE ${marker})`);
  }
  if (filters.actor) {
    values.push(filters.actor, `%${filters.actor}%`);
    clauses.push(`(a.actor_id::text = $${values.length - 1} OR u.full_name ILIKE $${values.length})`);
  }
  if (filters.action) add('a.action = $n', filters.action);
  if (filters.module) add(`split_part(a.action, '.', 1) = $n`, filters.module);
  if (filters.entityType) add('a.entity_type = $n', filters.entityType);
  if (filters.entityId) add('a.entity_id = $n', filters.entityId);
  if (filters.requestId) add('a.request_id = $n', filters.requestId);
  if (filters.severity) add('a.severity = $n', filters.severity);
  if (filters.outcome) add('a.outcome = $n', filters.outcome);
  if (filters.dateFrom) add('a.created_at >= $n::date', filters.dateFrom);
  if (filters.dateTo) add("a.created_at < ($n::date + INTERVAL '1 day')", filters.dateTo);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function mapAuditRow(row) {
  let details = row.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = null;
    }
  }
  return {
    ...row,
    id: Number(row.id),
    actor_id: Number(row.actor_id),
    details: sanitizeAuditDetails(details),
  };
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function validateFilters(res, parsed) {
  if (!parsed.success) {
    res.status(400).json({ error: 'Audit log filters are invalid.' });
    return false;
  }
  const { dateFrom, dateTo } = parsed.data;
  if (!validDate(dateFrom) || !validDate(dateTo)) {
    res.status(400).json({ error: 'Audit log dates must be valid calendar dates.' });
    return false;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    res.status(400).json({ error: 'The start date must be on or before the end date.' });
    return false;
  }
  return true;
}

export function createPostgresAdminAuditLogRouter({ database }) {
  const router = Router();

  router.get('/audit-logs/options', requirePermission('audit_logs.view'), asyncHandler(async (req, res) => {
    const actions = await database.query('SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 200');
    const modules = await database.query(
      "SELECT DISTINCT split_part(action, '.', 1) AS module FROM audit_logs ORDER BY module LIMIT 100",
    );
    res.json({
      data: {
        actions: actions.rows.map((row) => row.action),
        modules: modules.rows.map((row) => row.module),
        canExport: hasPermission(req.permissions, 'audit_logs.export'),
      },
    });
  }));

  router.get('/audit-logs', requirePermission('audit_logs.view'), asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!validateFilters(res, parsed)) return;
    const filters = parsed.data;
    const { where, values } = buildAuditFilters(filters);
    const count = await database.query(`SELECT COUNT(*) AS total ${baseQuery} ${where}`, values);
    const pageValues = [...values, filters.pageSize, (filters.page - 1) * filters.pageSize];
    const rows = await database.query(
      `${selectFields} ${baseQuery} ${where}
       ORDER BY ${sortColumns[filters.sortBy]} ${filters.sortDirection.toUpperCase()}, a.id DESC
       LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
    );
    res.json({
      data: rows.rows.map(mapAuditRow),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: Number(count.rows[0].total),
      },
    });
  }));

  router.get('/audit-logs/export', requirePermission('audit_logs.export'), asyncHandler(async (req, res) => {
    const parsed = exportSchema.safeParse(req.query);
    if (!validateFilters(res, parsed)) return;
    const { where, values } = buildAuditFilters(parsed.data);
    const count = await database.query(`SELECT COUNT(*) AS total ${baseQuery} ${where}`, values);
    if (Number(count.rows[0].total) > 10000) {
      return res.status(413).json({
        error: 'More than 10,000 audit records match. Narrow the date range or filters before exporting.',
      });
    }
    const rows = await database.query(
      `${selectFields} ${baseQuery} ${where}
       ORDER BY ${sortColumns[parsed.data.sortBy]} ${parsed.data.sortDirection.toUpperCase()}, a.id DESC
       LIMIT 10000`,
      values,
    );
    const headers = [
      'id', 'actor_id', 'actor_name', 'action', 'module', 'entity_type', 'entity_id',
      'outcome', 'severity', 'created_at', 'request_id', 'ip_address', 'details',
    ];
    const lines = [
      headers.map(csvCell).join(','),
      ...rows.rows.map((row) => {
        const record = mapAuditRow(row);
        return headers.map((header) => csvCell(record[header])).join(',');
      }),
    ];
    res.type('text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    return res.send(`\uFEFF${lines.join('\r\n')}`);
  }));

  return router;
}
