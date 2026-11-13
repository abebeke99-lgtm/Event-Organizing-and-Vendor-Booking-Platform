import '../src/lib/environment.js';
import bcrypt from 'bcryptjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStrongPassword, normalizeEmail } from '../src/lib/authFlow.js';
import { loadNeonTestEnvironment } from '../src/lib/neonTestEnvironment.js';
import {
  createPostgresDatabase,
  formatPostgresError,
  getPostgresFailureCode,
} from '../src/postgresDb.js';

const REQUIRED_VARIABLES = ['ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const SAMPLE_PASSWORD_VARIABLES = [
  'SEED_ORGANIZER_PASSWORD',
  'SEED_VENDOR_PASSWORD',
  'SEED_CUSTOMER_PASSWORD',
];

const SAMPLE_CATEGORIES = [
  { name: 'Catering', description: 'Food and beverage services for events.' },
  { name: 'Photography', description: 'Event photography and media coverage.' },
  { name: 'Event Rentals', description: 'Furniture and equipment for events.' },
];

const SAMPLE_EVENTS = [
  {
    title: 'EventHub Sample - Addis Wedding Celebration',
    eventType: 'Wedding',
    city: 'Addis Ababa',
    venue: 'Unity Hall',
    daysFromNow: 45,
    budget: 180000,
  },
  {
    title: 'EventHub Sample - Innovation Conference',
    eventType: 'Conference',
    city: 'Addis Ababa',
    venue: 'Technology Center',
    daysFromNow: 75,
    budget: 95000,
  },
  {
    title: 'EventHub Sample - Community Arts Festival',
    eventType: 'Festival',
    city: 'Bahir Dar',
    venue: 'Lakeside Pavilion',
    daysFromNow: 105,
    budget: 65000,
  },
];

export class SeedConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedConfigurationError';
  }
}

export class SeedDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedDataError';
  }
}

export function readSeedConfiguration(environment = process.env) {
  const missing = REQUIRED_VARIABLES.filter((name) => (
    typeof environment[name] !== 'string' || !environment[name].trim()
  ));
  if (missing.length) {
    throw new SeedConfigurationError(
      `Set the required seed environment variables: ${missing.join(', ')}.`,
    );
  }

  const email = normalizeEmail(environment.ADMIN_EMAIL);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new SeedConfigurationError('ADMIN_EMAIL must be a valid email address.');
  }

  const missingSamplePasswords = SAMPLE_PASSWORD_VARIABLES.filter((name) => (
    typeof environment[name] !== 'string' || !environment[name].trim()
  ));
  const configuredSamplePasswords = SAMPLE_PASSWORD_VARIABLES.length - missingSamplePasswords.length;
  if (configuredSamplePasswords > 0 && missingSamplePasswords.length > 0) {
    throw new SeedConfigurationError(
      `Set all sample account password variables or omit them all: ${missingSamplePasswords.join(', ')}.`,
    );
  }

  const accounts = [
    { email, password: environment.ADMIN_PASSWORD, name: 'EventHub Administrator', role: 'admin' },
  ];

  if (configuredSamplePasswords === SAMPLE_PASSWORD_VARIABLES.length) {
    accounts.push(
      {
        email: 'organizer@example.com',
        password: environment.SEED_ORGANIZER_PASSWORD,
        name: 'Sample Event Organizer',
        role: 'organizer',
      },
      {
        email: 'vendor@example.com',
        password: environment.SEED_VENDOR_PASSWORD,
        name: 'Sample Event Vendor',
        role: 'vendor',
      },
      {
        email: 'customer@example.com',
        password: environment.SEED_CUSTOMER_PASSWORD,
        name: 'Sample Event Customer',
        role: 'customer',
      },
    );
  }

  if (new Set(accounts.map((account) => account.email)).size !== accounts.length) {
    throw new SeedConfigurationError(
      'ADMIN_EMAIL must be different from the sample account email addresses.',
    );
  }

  for (const account of accounts) {
    const passwordLength = Array.from(account.password).length;
    const passwordBytes = Buffer.byteLength(account.password, 'utf8');
    const validPassword = account.role === 'admin'
      ? isStrongPassword(account.password) && passwordBytes <= 72
      : passwordLength >= 24
        && passwordBytes <= 72
        && /[A-Z]/.test(account.password)
        && /[a-z]/.test(account.password)
        && /\d/.test(account.password);
    if (!validPassword) {
      const variable = account.role === 'admin'
        ? 'ADMIN_PASSWORD'
        : `SEED_${account.role.toUpperCase()}_PASSWORD`;
      const requirements = account.role === 'admin'
        ? '12-16 characters, uppercase and lowercase letters, a digit, and at most 72 UTF-8 bytes'
        : 'at least 24 characters, uppercase and lowercase letters, a digit, and at most 72 UTF-8 bytes';
      throw new SeedConfigurationError(`${variable} must contain ${requirements}.`);
    }
  }

  return accounts;
}

async function ensureUser(client, account, passwordHash, roleId) {
  const result = await client.query(
    `INSERT INTO users (full_name, email, password_hash, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (LOWER(email)) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [account.name, account.email, passwordHash],
  );
  const userId = result.rows[0]?.id;
  if (!userId) throw new SeedDataError('The database did not return an account identifier.');

  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId],
  );
  return userId;
}

async function ensureServiceCategory(client, category) {
  await client.query(
    `INSERT INTO service_categories (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING`,
    [category.name, category.description],
  );
  const result = await client.query(
    'SELECT id FROM service_categories WHERE name = $1 AND is_active = TRUE',
    [category.name],
  );
  if (!result.rows[0]) {
    throw new SeedDataError('A required service category is unavailable or inactive.');
  }
  return result.rows[0].id;
}

async function ensureVendorProfile(client, userId, categoryId) {
  await client.query(
    `INSERT INTO vendor_profiles
       (user_id, business_name, category_id, city, description, verification_status)
     VALUES ($1, 'Sample Event Services', $2, 'Addis Ababa',
       'Catering, photography, and event rental services.', 'verified')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, categoryId],
  );
  const result = await client.query(
    'SELECT id, category_id FROM vendor_profiles WHERE user_id = $1',
    [userId],
  );
  if (!result.rows[0]) throw new SeedDataError('The sample vendor profile could not be loaded.');
  return result.rows[0];
}

async function ensureService(client, vendorId, categoryId, service) {
  const existing = await client.query(
    `SELECT id, status FROM services
     WHERE vendor_id = $1 AND LOWER(title) = LOWER($2)
     ORDER BY id
     LIMIT 1
     FOR UPDATE`,
    [vendorId, service.title],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status !== 'active') {
      throw new SeedDataError('A sample service already exists but is not active.');
    }
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO services (vendor_id, category_id, title, description, price, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'ETB', 'active')
     RETURNING id`,
    [vendorId, categoryId, service.title, service.description, service.price],
  );
  return inserted.rows[0].id;
}

async function ensureEvent(client, organizerId, event) {
  const existing = await client.query(
    `SELECT id FROM events
     WHERE organizer_id = $1 AND title = $2
     ORDER BY id
     LIMIT 1
     FOR UPDATE`,
    [organizerId, event.title],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const startDate = new Date(Date.now() + event.daysFromNow * 24 * 60 * 60 * 1000);
  const endDate = new Date(startDate.getTime() + 5 * 60 * 60 * 1000);
  const inserted = await client.query(
    `INSERT INTO events
       (organizer_id, title, event_type, city, venue, start_date, end_date, budget,
        status, is_featured, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', FALSE, NOW())
     RETURNING id`,
    [
      organizerId,
      event.title,
      event.eventType,
      event.city,
      event.venue,
      startDate,
      endDate,
      event.budget,
    ],
  );
  return inserted.rows[0].id;
}

async function ensureBooking(client, {
  eventId,
  vendorId,
  serviceId,
  serviceDescription,
  amount,
  scheduledDate,
}) {
  const existing = await client.query(
    `SELECT id FROM bookings
     WHERE event_id = $1 AND vendor_id = $2 AND service_id = $3
       AND service_description = $4
     ORDER BY id
     LIMIT 1
     FOR UPDATE`,
    [eventId, vendorId, serviceId, serviceDescription],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO bookings
       (event_id, vendor_id, service_id, service_description, quoted_amount,
        currency, status, scheduled_date)
     VALUES ($1, $2, $3, $4, $5, 'ETB', 'accepted', $6)
     RETURNING id`,
    [eventId, vendorId, serviceId, serviceDescription, amount, scheduledDate],
  );
  return inserted.rows[0].id;
}

async function ensureBookingNotifications(client, bookingId, organizerId, vendorUserId) {
  const notifications = [
    {
      userId: organizerId,
      title: 'Sample booking confirmed',
      message: 'A sample vendor booking is ready to review.',
      audience: 'organizer',
    },
    {
      userId: vendorUserId,
      title: 'Sample booking received',
      message: 'A sample event booking has been added to your dashboard.',
      audience: 'vendor',
    },
  ];

  for (const notification of notifications) {
    const key = `eventhub-seed:booking:${bookingId}:${notification.audience}`;
    const inserted = await client.query(
      `INSERT INTO notifications
         (user_id, title, message, status, notification_type, related_entity_type,
          related_entity_id, idempotency_key, delivery_channel, delivery_status)
       VALUES ($1, $2, $3, 'sent', 'booking_update', 'booking', $4, $5, 'in_app', 'delivered')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [notification.userId, notification.title, notification.message, String(bookingId), key],
    );
    if (inserted.rows[0]) {
      await client.query(
        `INSERT INTO notification_history (notification_id, actor_id, action, details)
         VALUES ($1, $2, 'created', $3::jsonb)`,
        [
          inserted.rows[0].id,
          organizerId,
          JSON.stringify({ source: 'eventhub_seed', booking_id: String(bookingId) }),
        ],
      );
    }
  }
}

async function seedRecords(client, accounts, passwordHashes) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('eventhub-seed-v1'))");
  const includeSamples = accounts.length > 1;

  const roleResult = await client.query(
    `SELECT id, LOWER(name) AS normalized_name, is_admin
     FROM roles
     WHERE is_active = TRUE`,
  );
  const roleIds = new Map();
  for (const role of roleResult.rows) {
    if (role.is_admin || ['admin', 'administrator'].includes(role.normalized_name)) {
      roleIds.set('admin', role.id);
    } else {
      roleIds.set(role.normalized_name, role.id);
    }
  }
  const requiredRoles = includeSamples ? ['admin', 'organizer', 'vendor', 'customer'] : ['admin'];
  for (const requiredRole of requiredRoles) {
    if (!roleIds.has(requiredRole)) {
      throw new SeedDataError('A required active role is missing; apply the PostgreSQL migrations first.');
    }
  }

  const users = {};
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    users[account.role] = await ensureUser(
      client,
      account,
      passwordHashes[index],
      roleIds.get(account.role),
    );
  }

  if (!includeSamples) return;

  const categories = new Map();
  for (const category of SAMPLE_CATEGORIES) {
    categories.set(category.name, await ensureServiceCategory(client, category));
  }

  const vendorProfile = await ensureVendorProfile(
    client,
    users.vendor,
    categories.get('Catering'),
  );
  const services = {};
  const serviceDefinitions = [
    {
      key: 'catering',
      category: 'Catering',
      title: 'Sample Event Catering',
      description: 'Seasonal buffet catering for private and corporate events.',
      price: 25000,
    },
    {
      key: 'photography',
      category: 'Photography',
      title: 'Sample Event Photography',
      description: 'Professional event photography coverage.',
      price: 12000,
    },
    {
      key: 'rentals',
      category: 'Event Rentals',
      title: 'Sample Event Equipment Rental',
      description: 'Tables, seating, and event equipment rental.',
      price: 8000,
    },
  ];
  for (const service of serviceDefinitions) {
    services[service.key] = await ensureService(
      client,
      vendorProfile.id,
      categories.get(service.category),
      service,
    );
  }

  const events = [];
  for (const event of SAMPLE_EVENTS) {
    events.push(await ensureEvent(client, users.organizer, event));
  }

  const bookings = [
    await ensureBooking(client, {
      eventId: events[0],
      vendorId: vendorProfile.id,
      serviceId: services.photography,
      serviceDescription: 'Sample Event Photography',
      amount: 12000,
      scheduledDate: new Date(Date.now() + SAMPLE_EVENTS[0].daysFromNow * 24 * 60 * 60 * 1000),
    }),
    await ensureBooking(client, {
      eventId: events[1],
      vendorId: vendorProfile.id,
      serviceId: services.catering,
      serviceDescription: 'Sample Event Catering',
      amount: 25000,
      scheduledDate: new Date(Date.now() + SAMPLE_EVENTS[1].daysFromNow * 24 * 60 * 60 * 1000),
    }),
  ];

  for (const bookingId of bookings) {
    await ensureBookingNotifications(client, bookingId, users.organizer, users.vendor);
  }
}

export async function runSeed({ environment = process.env } = {}) {
  const accounts = readSeedConfiguration(environment);
  const testEnvironment = await loadNeonTestEnvironment({ environment });
  const database = createPostgresDatabase(testEnvironment);
  let client;

  try {
    const identity = await database.verifyRuntimeConnection();
    if (identity.database_name !== 'eventhub') {
      throw new SeedDataError('The seed script may only run against the isolated eventhub test database.');
    }

    const passwordHashes = await Promise.all(
      accounts.map((account) => bcrypt.hash(account.password, 12)),
    );
    client = await database.runtimePool.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      await seedRecords(client, accounts, passwordHashes);
      await client.query('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The seed transaction failed and its rollback could not be completed.',
          );
        }
      }
      throw error;
    } finally {
      client.release();
      client = null;
    }

    console.log('Neon test database identity verified.');
    console.log(accounts.length > 1
      ? 'Seed transaction committed: administrator, sample accounts, categories, services, events, bookings, and notifications.'
      : 'Seed transaction committed: administrator account.');
  } finally {
    if (client) client.release();
    await database.close();
  }
}

function isSafeSeedError(error) {
  return error instanceof SeedConfigurationError
    || error instanceof SeedDataError
    || error instanceof AggregateError;
}

async function main() {
  try {
    await runSeed();
  } catch (error) {
    const message = isSafeSeedError(error)
      ? error.message
      : formatPostgresError(error);
    const failureCode = error instanceof SeedConfigurationError
      ? 'SEED_CONFIG_INVALID'
      : error instanceof SeedDataError
        ? 'SEED_DATA_INVALID'
        : error instanceof AggregateError
          ? 'SEED_TRANSACTION_FAILED'
          : getPostgresFailureCode(error);
    console.error(`Neon seed failed [${failureCode}]: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
