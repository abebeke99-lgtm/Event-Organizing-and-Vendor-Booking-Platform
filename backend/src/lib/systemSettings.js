import { z } from 'zod';

const socialLinksSchema = z.string().superRefine((value, context) => {
  let links;
  try {
    links = JSON.parse(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter valid JSON.' });
    return;
  }

  const parsed = z.array(z.object({
    label: z.string().trim().min(1).max(40),
    url: z.string().url().max(500).refine((url) => /^https?:\/\//i.test(url)),
  }).strict()).max(10).safeParse(links);
  if (!parsed.success) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Social links must be an array of up to 10 label and HTTPS/HTTP URL pairs.' });
  }
});

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
  platform_name: 'EventHub',
  platform_description: 'Event organizing and vendor booking platform.',
  support_email: '',
  support_phone: '',
  support_address: '',
  support_hours: '',
  social_links: '[]',
  public_registration_enabled: true,
  default_registration_role: 'customer',
  platform_status: 'open',
  maintenance_mode: false,
  maintenance_message: 'We are performing scheduled maintenance. Please check back soon.',
});

export const SYSTEM_SETTING_SCHEMAS = Object.freeze({
  platform_name: z.string().trim().min(1).max(100),
  platform_description: z.string().trim().max(500),
  support_email: z.union([z.literal(''), z.string().trim().email().max(254)]),
  support_phone: z.string().trim().max(40).regex(/^[+\d().\-\s]*$/, 'Enter a valid phone number.'),
  support_address: z.string().trim().max(255),
  support_hours: z.string().trim().max(255),
  social_links: socialLinksSchema,
  public_registration_enabled: z.boolean(),
  default_registration_role: z.enum(['customer', 'organizer', 'vendor']),
  platform_status: z.enum(['open', 'locked', 'maintenance']),
  maintenance_mode: z.boolean(),
  maintenance_message: z.string().trim().min(1).max(1000),
});

export const systemSettingsPatchSchema = z.object(
  Object.fromEntries(Object.entries(SYSTEM_SETTING_SCHEMAS).map(([key, schema]) => [key, schema.optional()])),
).strict().refine((settings) => Object.keys(settings).length > 0, 'At least one supported setting is required.');

export function serializeSystemSettingValue(value) {
  return String(value);
}

export function parseStoredSystemSetting(key, value) {
  const schema = SYSTEM_SETTING_SCHEMAS[key];
  if (!schema) return undefined;
  let candidate = String(value ?? '');
  if (key === 'maintenance_mode' || key === 'public_registration_enabled') {
    if ([true, 1, 'true', '1'].includes(value)) candidate = true;
    else if ([false, 0, 'false', '0'].includes(value)) candidate = false;
    else throw new Error(`Stored system setting "${key}" is invalid.`);
  }
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Stored system setting "${key}" is invalid.`);
  }
  return parsed.data;
}

export function mergeSystemSettings(rows = []) {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS };
  for (const row of rows) {
    const key = String(row.setting_key || '');
    if (Object.hasOwn(SYSTEM_SETTING_SCHEMAS, key)) {
      settings[key] = parseStoredSystemSetting(key, row.setting_value);
    }
  }
  return settings;
}

export async function loadSystemSettings(database, keys = Object.keys(SYSTEM_SETTING_SCHEMAS)) {
  const supportedKeys = keys.filter((key) => Object.hasOwn(SYSTEM_SETTING_SCHEMAS, key));
  if (!supportedKeys.length) return {};
  const placeholders = supportedKeys.map(() => '?').join(', ');
  const [rows] = await database.execute(
    `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (${placeholders})`,
    supportedKeys,
  );
  return mergeSystemSettings(rows);
}

export function updateSystemSettingsCache(app, settings) {
  app.locals.systemSettings = { ...(app.locals.systemSettings || {}), ...settings };
  app.locals.platformSettingsCache = {
    values: app.locals.systemSettings,
    expiresAt: Date.now() + 1000,
  };
}
