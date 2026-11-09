import { Router } from 'express';
import { z } from 'zod';
import { getRequestId } from '../lib/requestContext.js';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SYSTEM_SETTING_SCHEMAS,
  loadSystemSettings,
  mergeSystemSettings,
  serializeSystemSettingValue,
  systemSettingsPatchSchema,
  updateSystemSettingsCache,
} from '../lib/systemSettings.js';
import { auditSeverityForAction, sanitizeAuditDetails } from '../lib/security.js';
import { requirePermission } from '../middleware/rbac.js';

const consequentialSettings = new Set([
  'public_registration_enabled',
  'default_registration_role',
  'platform_status',
  'maintenance_mode',
  'booking_cancellation_cutoff_hours',
  'booking_rescheduling_enabled',
  'booking_reschedule_cutoff_hours',
  'booking_confirmation_workflow',
  'vendor_require_category',
  'vendor_require_city',
  'vendor_require_description',
  'refund_request_window_days',
]);

async function writeAudit(executor, { actorId, action, entityType, entityId = null, details, ip }) {
  await executor.query(
    `INSERT INTO audit_logs
      (actor_id, action, entity_type, entity_id, details, ip_address, request_id, outcome, severity)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'success', $8)`,
    [
      actorId,
      action,
      entityType,
      entityId === null ? null : String(entityId),
      JSON.stringify(sanitizeAuditDetails(details)),
      ip || null,
      getRequestId(),
      auditSeverityForAction(action),
    ],
  );
}

function validationError(res, error) {
  return res.status(400).json({
    error: 'One or more settings are invalid or unsupported.',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  });
}

export function createPostgresAdminSettingsRouter({ database }) {
  const router = Router();

  router.get('/settings', requirePermission('system.settings.manage'), async (req, res, next) => {
    try {
      const supportedKeys = Object.keys(SYSTEM_SETTING_SCHEMAS);
      const placeholders = supportedKeys.map((_, index) => `$${index + 1}`).join(', ');
      const [settingsResult, currencyResult] = await Promise.all([
        database.query(
          `SELECT setting_key, setting_value, updated_at
           FROM system_settings
           WHERE setting_key IN (${placeholders})
           ORDER BY setting_key`,
          supportedKeys,
        ),
        database.query(
          `SELECT currency FROM services
           UNION SELECT currency FROM payments
           UNION SELECT currency FROM bookings
           ORDER BY currency`,
        ),
      ]);
      const rows = settingsResult.rows;
      const settings = mergeSystemSettings(rows);
      const savedRows = new Map(rows.map((row) => [row.setting_key, row]));
      const data = Object.entries(settings).map(([setting_key, setting_value]) => ({
        setting_key,
        setting_value,
        updated_at: savedRows.get(setting_key)?.updated_at ?? null,
      }));
      const paymentProvider = req.app.locals.paymentProvider;
      const notifications = req.app.locals.notificationServices || {};
      const supportedCurrencies = [...new Set(currencyResult.rows
        .map((row) => String(row.currency || '').toUpperCase())
        .filter((currency) => /^[A-Z]{3}$/.test(currency)))];
      return res.json({
        data,
        settings,
        configuration: {
          notifications: {
            inApp: { supported: true, configured: true },
            email: { supported: true, configured: Boolean(notifications.emailConfigured) },
            sms: { supported: false, configured: false },
          },
          payments: {
            configured: Boolean(paymentProvider),
            provider: paymentProvider?.name || null,
            state: paymentProvider ? 'configured' : 'pending_integration',
            supportedCurrencies,
          },
          vendor: {
            verificationRequired: true,
            serviceApproval: 'not_supported',
            requiredDocuments: 'configured_by_verification_workflow',
          },
          security: {
            administratorSessionHours: 8,
            userSessionHours: 8,
            passwordMinimumLength: 12,
            passwordMaximumLength: 16,
            strongPasswordRequired: true,
            credentialsManagedOutsideSystemSettings: true,
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/settings', requirePermission('system.settings.manage'), async (req, res, next) => {
    const { confirmConsequential = false, ...requestedSettings } = req.body || {};
    if (typeof confirmConsequential !== 'boolean') {
      return res.status(400).json({ error: 'Setting confirmation must be a boolean.' });
    }
    const parsed = systemSettingsPatchSchema.safeParse(requestedSettings);
    if (!parsed.success) return validationError(res, parsed.error);

    try {
      const currentSettings = await loadSystemSettings(database);
      const entries = Object.entries(parsed.data);
      const changes = entries
        .filter(([key, value]) => JSON.stringify(currentSettings[key]) !== JSON.stringify(value))
        .map(([key, value]) => ({ key, from: currentSettings[key], to: value }));
      const consequentialChanges = changes.filter(({ key }) => consequentialSettings.has(key));
      if (consequentialChanges.length && !confirmConsequential) {
        return res.status(409).json({
          error: 'Confirm consequential settings changes before saving.',
          confirmationRequired: true,
          keys: consequentialChanges.map(({ key }) => key),
        });
      }
      if (!changes.length) return res.json({ data: currentSettings });

      await database.inTransaction(async (transaction) => {
        for (const [key, value] of entries) {
          await transaction.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (setting_key) DO UPDATE
             SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
            [key, serializeSystemSettingValue(value), req.admin.id],
          );
        }
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'settings.updated',
          entityType: 'system_settings',
          details: { changes },
          ip: req.ip,
        });
      });

      const settings = { ...currentSettings, ...parsed.data };
      updateSystemSettingsCache(req.app, settings);
      return res.json({ data: settings });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/settings/reset', requirePermission('system.settings.manage'), async (req, res, next) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Explicit confirmation is required to reset system settings.' });
    }
    try {
      const previousSettings = await loadSystemSettings(database);
      const changes = Object.entries(DEFAULT_SYSTEM_SETTINGS)
        .filter(([key, value]) => JSON.stringify(previousSettings[key]) !== JSON.stringify(value))
        .map(([key, value]) => ({ key, from: previousSettings[key], to: value }));
      await database.inTransaction(async (transaction) => {
        for (const [key, value] of Object.entries(DEFAULT_SYSTEM_SETTINGS)) {
          await transaction.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (setting_key) DO UPDATE
             SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
            [key, serializeSystemSettingValue(value), req.admin.id],
          );
        }
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'settings.reset',
          entityType: 'system_settings',
          details: { changes },
          ip: req.ip,
        });
      });
      updateSystemSettingsCache(req.app, DEFAULT_SYSTEM_SETTINGS);
      return res.json({ data: DEFAULT_SYSTEM_SETTINGS });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/settings/:key', requirePermission('system.settings.manage'), async (req, res, next) => {
    const key = String(req.params.key);
    const rawValue = req.body?.value;
    const value = ['maintenance_mode', 'public_registration_enabled'].includes(key)
      && ['true', 'false'].includes(rawValue)
      ? rawValue === 'true'
      : rawValue;
    const parsed = systemSettingsPatchSchema.safeParse({ [key]: value });
    if (!parsed.success) return res.status(400).json({ error: 'Setting key or value is invalid.' });

    try {
      const current = await loadSystemSettings(database, [key]);
      if (consequentialSettings.has(key)
        && JSON.stringify(current[key]) !== JSON.stringify(parsed.data[key])
        && req.body?.confirmConsequential !== true) {
        return res.status(409).json({
          error: 'Confirm this consequential setting change before saving.',
          confirmationRequired: true,
        });
      }
      if (JSON.stringify(current[key]) === JSON.stringify(parsed.data[key])) {
        return res.json({ data: { setting_key: key, setting_value: parsed.data[key] } });
      }
      await database.inTransaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO system_settings (setting_key, setting_value, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (setting_key) DO UPDATE
           SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
          [key, serializeSystemSettingValue(parsed.data[key]), req.admin.id],
        );
        await writeAudit(transaction, {
          actorId: req.admin.id,
          action: 'settings.updated',
          entityType: 'system_setting',
          entityId: key,
          details: { key, from: current[key], to: parsed.data[key] },
          ip: req.ip,
        });
      });
      updateSystemSettingsCache(req.app, parsed.data);
      return res.json({ data: { setting_key: key, setting_value: parsed.data[key] } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
