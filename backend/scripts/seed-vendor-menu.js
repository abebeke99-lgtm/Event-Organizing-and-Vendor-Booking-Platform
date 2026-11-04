import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const categories = [
  ['Photography and Videography', 'Photography and video production for events.'],
  ['Catering', 'Food and beverage services for events.'],
  ['Decoration and Flowers', 'Event decoration, floral design, and styling.'],
  ['Venues and Halls', 'Event venues, halls, and reception spaces.'],
  ['Music and DJ', 'Music performers and DJ services for events.'],
  ['Sound and Lighting', 'Event sound systems and lighting production.'],
  ['Makeup and Beauty', 'Makeup, hair, and beauty services for events.'],
  ['Wedding Cars and Transport', 'Wedding cars and event transportation.'],
  ['Event Planners', 'Planning and coordination for events.'],
  ['Tents and Furniture Rental', 'Tents, seating, and event furniture rental.'],
  ['Cake and Bakery', 'Cakes and baked goods for events.'],
  ['Security Services', 'Security and safety services for events.'],
];

function assertExpectedLocalDatabase() {
  if (process.env.NODE_ENV !== 'development'
    || process.env.DB_HOST !== '127.0.0.1'
    || process.env.DB_PORT !== '3306'
    || process.env.DB_NAME !== 'event_platform') {
    throw new Error('Refusing to seed: this script is restricted to the configured local XAMPP event_platform database.');
  }
}

function hasEnumValue(columnType, value) {
  return String(columnType || '').includes(`'${value}'`);
}

assertExpectedLocalDatabase();

const { inTransaction, pool } = await import('../src/db.js');
try {
  const [verificationColumns] = await pool.query("SHOW COLUMNS FROM vendor_profiles LIKE 'verification_status'");
  const [userStatusColumns] = await pool.query("SHOW COLUMNS FROM users LIKE 'status'");
  if (!hasEnumValue(verificationColumns[0]?.Type, 'verified')
    || !hasEnumValue(userStatusColumns[0]?.Type, 'active')) {
    throw new Error('The database does not support verified vendor profiles and active users.');
  }

  const results = await inTransaction(async (connection) => {
    const [roleRows] = await connection.execute(
      "SELECT id FROM roles WHERE LOWER(name) = 'vendor' AND is_active = TRUE LIMIT 1",
    );
    if (!roleRows.length) throw new Error('The active Vendor role does not exist; run the existing migrations first.');

    let categoryCount = 0;
    let vendorCount = 0;
    for (const [name, description] of categories) {
      await connection.execute(
        'INSERT IGNORE INTO service_categories (name, description, is_active) VALUES (?, ?, TRUE)',
        [name, description],
      );
      const [categoryRows] = await connection.execute(
        'SELECT id, is_active FROM service_categories WHERE name = ? LIMIT 1',
        [name],
      );
      const category = categoryRows[0];
      if (!category) throw new Error(`Could not load the vendor category "${name}".`);
      categoryCount += 1;
      if (!category.is_active) continue;

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      for (let index = 1; index <= 2; index += 1) {
        const email = `eventhub.sample.${slug}.${index}@example.invalid`;
        const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10);
        const [userResult] = await connection.execute(
          `INSERT INTO users (full_name, email, password_hash, status)
           VALUES (?, ?, ?, 'active')
           ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), status = 'active'`,
          [`Sample ${name} Vendor ${index}`, email, passwordHash],
        );
        const userId = Number(userResult.insertId);
        await connection.execute(
          'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [userId, roleRows[0].id],
        );
        await connection.execute(
          `INSERT INTO vendor_profiles
            (user_id, business_name, category_id, city, description, verification_status, verified_at)
           VALUES (?, ?, ?, 'Addis Ababa', ?, 'verified', NOW())
           ON DUPLICATE KEY UPDATE
             business_name = VALUES(business_name),
             category_id = VALUES(category_id),
             city = VALUES(city),
             description = VALUES(description),
             verification_status = 'verified',
             verified_at = COALESCE(verified_at, NOW())`,
          [
            userId,
            `Sample ${name} Vendor ${index}`,
            category.id,
            `Development sample vendor listing for the ${name} category.`,
          ],
        );
        vendorCount += 1;
      }
    }
    return { categoryCount, vendorCount };
  });
  console.log(`Seeded ${results.categoryCount} vendor categories and ${results.vendorCount} active, verified sample vendor profiles.`);
} catch (error) {
  console.error(`Vendor menu seed failed: ${error.code || error.name || 'ERROR'}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
