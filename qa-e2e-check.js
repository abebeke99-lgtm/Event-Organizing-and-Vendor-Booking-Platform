const mysql = require('mysql2/promise');
const base = 'http://127.0.0.1:4000';
const unique = '20261101103700';
const orgEmail = `qa.organizer.${unique}@example.com`;
const vendorEmail = `qa.vendor.${unique}@example.com`;
const orgPassword = 'StrongPass123!';
const vendorPassword = 'StrongPass123!';

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  const res = await fetch(base + path, {
    ...options,
    headers,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

(async () => {
  const orgReg = await api('/api/platform/register', { method: 'POST', body: JSON.stringify({ name: 'QA Organizer', email: orgEmail, password: orgPassword, role: 'organizer' }) });
  console.log('ORGANIZER_REGISTER', orgReg.status, JSON.stringify(orgReg.data));

  const vendorReg = await api('/api/platform/register', { method: 'POST', body: JSON.stringify({ name: 'QA Vendor', email: vendorEmail, password: vendorPassword, role: 'vendor' }) });
  console.log('VENDOR_REGISTER', vendorReg.status, JSON.stringify(vendorReg.data));

  const orgLogin = await api('/api/platform/login', { method: 'POST', body: JSON.stringify({ email: orgEmail, password: orgPassword }) });
  console.log('ORGANIZER_LOGIN', orgLogin.status, JSON.stringify(orgLogin.data));
  const orgCookies = orgLogin.headers['set-cookie'] || '';

  const eventCreate = await api('/api/platform/events', {
    method: 'POST',
    headers: { Cookie: orgCookies },
    body: JSON.stringify({ title: 'QA Test Event', type: 'Wedding', description: 'Real database validation event', city: 'Addis Ababa', venue: 'Bole Convention Center', startDate: '2030-12-10T09:00', endDate: '2030-12-11T18:00', budget: 15000, guestCount: 120, capacity: 200, notes: 'QA test event' })
  });
  console.log('EVENT_CREATE', eventCreate.status, JSON.stringify(eventCreate.data));

  const vendorLogin = await api('/api/platform/login', { method: 'POST', body: JSON.stringify({ email: vendorEmail, password: vendorPassword }) });
  console.log('VENDOR_LOGIN', vendorLogin.status, JSON.stringify(vendorLogin.data));
  const vendorCookies = vendorLogin.headers['set-cookie'] || '';

  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'event_platform' });
  await conn.execute("UPDATE vendor_profiles SET verification_status = 'verified', verified_at = NOW() WHERE user_id = (SELECT id FROM users WHERE email = ?)", [vendorEmail]);
  const [profileRows] = await conn.execute('SELECT id, verification_status FROM vendor_profiles WHERE user_id = (SELECT id FROM users WHERE email = ?)', [vendorEmail]);
  console.log('VENDOR_PROFILE_VERIFIED', JSON.stringify(profileRows));
  await conn.end();

  const serviceCreate = await api('/api/vendor/services', {
    method: 'POST',
    headers: { Cookie: vendorCookies },
    body: JSON.stringify({ title: 'QA Catering Package', description: 'Isolated QA service', categoryId: 1, price: 2500, currency: 'ETB', status: 'active' })
  });
  console.log('SERVICE_CREATE', serviceCreate.status, JSON.stringify(serviceCreate.data));

  const bookingCreate = await api('/api/platform/bookings', {
    method: 'POST',
    headers: { Cookie: orgCookies },
    body: JSON.stringify({ eventId: eventCreate.data.data.id, serviceId: serviceCreate.data.data.id, notes: 'QA booking request' })
  });
  console.log('BOOKING_CREATE', bookingCreate.status, JSON.stringify(bookingCreate.data));

  const vendorAccept = await api(`/api/platform/bookings/${bookingCreate.data.data.id}/status`, {
    method: 'PATCH',
    headers: { Cookie: vendorCookies },
    body: JSON.stringify({ status: 'accepted', reason: 'QA approved' })
  });
  console.log('BOOKING_ACCEPTED', vendorAccept.status, JSON.stringify(vendorAccept.data));

  const conn2 = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'event_platform' });
  const [rows] = await conn2.execute("SELECT 'users' AS table_name, id, email, full_name AS name FROM users WHERE email IN (?, ?) UNION ALL SELECT 'events', id, NULL, title FROM events WHERE title = 'QA Test Event' UNION ALL SELECT 'services', id, NULL, title FROM services WHERE title = 'QA Catering Package' UNION ALL SELECT 'bookings', id, NULL, service_description FROM bookings WHERE service_description LIKE '%QA booking request%' ORDER BY table_name, id", [orgEmail, vendorEmail]);
  console.log('DB_ROWS', JSON.stringify(rows));
  await conn2.end();
})();
