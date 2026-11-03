import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { validateVendorVerificationDocument } from '../src/lib/vendorVerificationDocuments.js';

const adminToken = 'vendor-verification-admin-session';
const platformToken = 'vendor-verification-platform-session';
const adminId = 10;

function createDatabase() {
  const statements = [];
  const auditRecords = [];
  const notifications = [];
  const notificationHistory = [];
  const history = [];
  const documentContent = Buffer.from('%PDF-1.7 verification document');
  const documents = [{
    id: 501,
    vendor_id: 1,
    original_name: 'business-license.pdf',
    content_type: 'application/pdf',
    file_size: documentContent.length,
    content: documentContent,
    created_at: '2026-10-01T10:00:00Z',
  }];
  const vendors = [
    {
      id: 1,
      user_id: 20,
      business_name: 'Aster Catering',
      category_id: 3,
      category_name: 'Catering',
      city: 'Addis Ababa',
      description: 'Wedding and event catering.',
      verification_status: 'pending',
      verification_reason: null,
      verified_at: null,
      created_at: '2026-10-01T09:00:00Z',
      owner_name: 'Vendor Owner',
      email: 'vendor@example.test',
      phone: '+251900000000',
    },
    {
      id: 2,
      user_id: 21,
      business_name: 'Blue Photography',
      category_id: 4,
      category_name: 'Photography',
      city: 'Bahir Dar',
      description: 'Photography services.',
      verification_status: 'under_review',
      verification_reason: null,
      verified_at: null,
      created_at: '2026-10-02T09:00:00Z',
      owner_name: 'Photo Owner',
      email: 'photo@example.test',
      phone: '+251911000000',
    },
  ];

  async function execute(sql, values = []) {
    statements.push({ sql, values });
    if (sql.includes('FROM admin_sessions s')) {
      return [values[0] === hashToken(adminToken) ? [{
        id: adminId,
        full_name: 'Verification Admin',
        email: 'admin@example.test',
        phone: null,
        status: 'active',
        roles: 'Admin',
      }] : [], []];
    }
    if (sql.includes('FROM user_sessions s')) {
      return [values[0] === hashToken(platformToken) ? [{
        id: 20,
        full_name: 'Vendor Owner',
        email: 'vendor@example.test',
        phone: '+251900000000',
        status: 'active',
        role: 'organizer',
        permission_keys: '',
      }] : [], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM vendor_profiles vp')) {
      return [[{ total: vendors.filter((vendor) => {
        let index = 0;
        if (sql.includes('vp.verification_status = ?') && vendor.verification_status !== values[index++]) return false;
        if (sql.includes('vp.business_name LIKE ?')) {
          const patterns = values.slice(index, index + 4).map((value) => String(value).replaceAll('%', '').toLowerCase());
          const id = String(values[index + 4]);
          const matched = patterns.some((pattern) => (
            vendor.business_name.toLowerCase().includes(pattern)
            || vendor.owner_name.toLowerCase().includes(pattern)
            || vendor.email.toLowerCase().includes(pattern)
            || vendor.phone.toLowerCase().includes(pattern)
          )) || String(vendor.id) === id;
          if (!matched) return false;
        }
        return true;
      }).length }], []];
    }
    if (sql.includes('FROM vendor_profiles vp') && sql.includes('AS document_count')) {
      return [vendors.map((vendor) => ({
        ...vendor,
        document_count: documents.filter((document) => document.vendor_id === vendor.id).length,
      })).filter((vendor) => {
        let index = 0;
        if (sql.includes('vp.verification_status = ?') && vendor.verification_status !== values[index++]) return false;
        if (sql.includes('vp.business_name LIKE ?')) {
          const patterns = values.slice(index, index + 4).map((value) => String(value).replaceAll('%', '').toLowerCase());
          const id = String(values[index + 4]);
          return patterns.some((pattern) => (
            vendor.business_name.toLowerCase().includes(pattern)
            || vendor.owner_name.toLowerCase().includes(pattern)
            || vendor.email.toLowerCase().includes(pattern)
            || vendor.phone.toLowerCase().includes(pattern)
          )) || String(vendor.id) === id;
        }
        return true;
      }), []];
    }
    if (sql.includes('GROUP BY verification_status')) {
      const grouped = new Map();
      vendors.forEach((vendor) => grouped.set(vendor.verification_status, (grouped.get(vendor.verification_status) || 0) + 1));
      return [[...grouped].map(([verification_status, total]) => ({ verification_status, total })), []];
    }
    if (sql.includes('FROM vendor_profiles vp') && sql.includes('WHERE vp.id = ?')) {
      return [vendors.filter((vendor) => vendor.id === Number(values[0])).map((vendor) => ({ ...vendor })), []];
    }
    if (sql.includes('FROM vendor_verification_documents') && sql.includes('WHERE id = ? AND vendor_id = ?')) {
      return [documents.filter((document) => document.id === Number(values[0]) && document.vendor_id === Number(values[1]))
        .map(({ original_name, content_type, content }) => ({ original_name, content_type, content })), []];
    }
    if (sql.includes('FROM vendor_verification_documents') && sql.includes('WHERE vendor_id = ?')) {
      return [documents.filter((document) => document.vendor_id === Number(values[0]))
        .map(({ content: _content, vendor_id: _vendorId, ...metadata }) => metadata), []];
    }
    if (sql.includes('FROM vendor_verification_history h')) {
      return [history.filter((entry) => entry.vendor_id === Number(values[0])).map((entry) => ({
        ...entry,
        actor_name: 'Verification Admin',
      })), []];
    }
    if (sql.startsWith('SELECT id, user_id, verification_status FROM vendor_profiles WHERE id = ? FOR UPDATE')) {
      return [vendors.filter((vendor) => vendor.id === Number(values[0]))
        .map(({ id, user_id, verification_status }) => ({ id, user_id, verification_status })), []];
    }
    if (sql.includes('SELECT id, verification_status FROM vendor_profiles') && sql.includes('WHERE user_id = ?')) {
      return [vendors.filter((vendor) => vendor.user_id === Number(values[0])
        && (!sql.includes('verification_status IN')
          || ['pending', 'under_review', 'information_requested'].includes(vendor.verification_status)))
        .slice(0, 1)
        .map(({ id, verification_status }) => ({ id, verification_status })), []];
    }
    if (sql.startsWith('SELECT id FROM vendor_profiles WHERE user_id = ?')) {
      return [vendors.filter((vendor) => vendor.user_id === Number(values[0])).map(({ id }) => ({ id })), []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM vendor_verification_documents WHERE vendor_id = ?')) {
      return [[{ total: documents.filter((document) => document.vendor_id === Number(values[0])).length }], []];
    }
    if (sql.includes('UPDATE vendor_profiles') && sql.includes('SET verification_status = ?')) {
      const [status, reason, , , vendorId] = values;
      const vendor = vendors.find((row) => row.id === Number(vendorId));
      vendor.verification_status = status;
      vendor.verification_reason = reason;
      if (status === 'verified') vendor.verified_at = new Date();
      if (status === 'rejected') vendor.verified_at = null;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO vendor_verification_history')) {
      history.push({
        id: history.length + 1,
        vendor_id: Number(values[0]),
        actor_id: values[1],
        from_status: values[2],
        to_status: values[3],
        reason: values[4],
        created_at: new Date().toISOString(),
      });
      return [{ insertId: history.length, affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO notifications')) {
      notifications.push({ user_id: values[0], title: values[1], message: values[2] });
      return [{ insertId: notifications.length, affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO notification_history')) {
      notificationHistory.push({
        notification_id: values[0],
        actor_id: values[1],
        action: 'created',
        details: JSON.parse(values[2]),
      });
      return [{ insertId: notificationHistory.length, affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO vendor_verification_documents')) {
      const [vendorId, uploadedBy, originalName, contentType, fileSize, content] = values;
      const document = {
        id: Math.max(...documents.map((entry) => entry.id)) + 1,
        vendor_id: Number(vendorId),
        uploaded_by: Number(uploadedBy),
        original_name: originalName,
        content_type: contentType,
        file_size: fileSize,
        content: Buffer.from(content),
        created_at: new Date().toISOString(),
      };
      documents.push(document);
      return [{ insertId: document.id, affectedRows: 1 }, []];
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      auditRecords.push({ actor_id: values[0], action: values[1], entity_type: values[2], entity_id: values[3], details: JSON.parse(values[4]) });
      return [{ insertId: auditRecords.length, affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected vendor verification SQL: ${sql}`);
  }

  return {
    statements,
    auditRecords,
    notifications,
    notificationHistory,
    history,
    documents,
    vendors,
    execute,
    async query() { return [[], []]; },
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
}

const database = createDatabase();
const app = createApp({ database });
app.locals.platformSettingsCache = {
  values: { platform_status: 'open', maintenance_mode: 'false', maintenance_message: '' },
  expiresAt: Date.now() + 60_000,
};
const server = app.listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

function adminRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', `admin_session=${adminToken}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('vendor verification listing is admin-only and searches database application records', async () => {
  const denied = await fetch(`${baseUrl}/api/admin/vendor-verification`);
  assert.equal(denied.status, 401);

  const response = await adminRequest('/api/admin/vendor-verification?status=pending&q=vendor%40example.test&page=1&pageSize=10');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.total, 1);
  assert.equal(body.data[0].business_name, 'Aster Catering');
  assert.equal(body.data[0].document_count, 1);
  assert.equal(body.counts.pending, 1);
  assert.equal(database.statements.some(({ sql }) => sql.includes('u.email LIKE ?') && sql.includes('CAST(vp.id AS CHAR) = ?')), true);
});

test('vendor detail includes profile, private document metadata, and verification history only', async () => {
  const response = await adminRequest('/api/admin/vendor-verification/1');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.owner_name, 'Vendor Owner');
  assert.equal(body.data.category_name, 'Catering');
  assert.equal(body.data.documents[0].original_name, 'business-license.pdf');
  assert.equal(Object.hasOwn(body.data.documents[0], 'content'), false);
  assert.deepEqual(body.data.history, []);
});

test('vendors cannot use administrator verification actions to review themselves', async () => {
  const vendorCookies = new Headers({ Cookie: 'platform_session=vendor-session' });
  const response = await fetch(`${baseUrl}/api/admin/vendor-verification/1/status`, {
    method: 'PATCH',
    headers: vendorCookies,
    body: JSON.stringify({ status: 'under_review', reason: 'Reviewed application' }),
  });
  assert.equal(response.status, 401);

  const vendor = database.vendors[0];
  const originalOwner = vendor.user_id;
  vendor.user_id = adminId;
  const selfReview = await adminRequest('/api/admin/vendor-verification/1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'under_review', reason: 'Reviewed application' }),
  });
  vendor.user_id = originalOwner;
  assert.equal(selfReview.status, 403);
  assert.equal(vendor.verification_status, 'pending');
});

test('verification workflow requires review, records decisions, and notifies the vendor', async () => {
  const directApproval = await adminRequest('/api/admin/vendor-verification/1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'verified', reason: 'Checks completed and documents validated.' }),
  });
  assert.equal(directApproval.status, 409);

  const missingReason = await adminRequest('/api/admin/vendor-verification/1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'under_review', reason: 'no' }),
  });
  assert.equal(missingReason.status, 400);

  for (const [status, expected, message] of [
    ['under_review', 'under_review', 'Application documents and identity are being checked.'],
    ['information_requested', 'information_requested', 'Please submit current business registration evidence.'],
    ['under_review', 'under_review', 'Additional documents received and review resumed.'],
    ['verified', 'verified', 'Business information and all submitted documents were validated.'],
    ['suspended', 'suspended', 'Suspend due to a documented policy violation.'],
    ['verified', 'verified', 'Suspension basis resolved and the business review reconfirmed.'],
  ]) {
    const response = await adminRequest('/api/admin/vendor-verification/1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason: message }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.verification_status, expected);
  }

  assert.equal(database.history.length, 6);
  assert.equal(database.notifications.length, 6);
  assert.equal(database.notifications[0].user_id, 20);
  assert.match(database.notifications.find((notice) => notice.title === 'More information requested').message, /business registration evidence/);
  assert.equal(database.auditRecords.length, 6);
  assert.equal(database.auditRecords[0].action, 'vendor.under_review');
  assert.equal(database.auditRecords[3].action, 'vendor.verified');
});

test('vendor rejection is audited and cannot be approved directly from pending', async () => {
  const response = await adminRequest('/api/admin/vendor-verification/2/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'rejected', reason: 'Submitted license does not match the registered business.' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.verification_status, 'rejected');
  assert.equal(database.notifications.at(-1).title, 'Vendor application update');
  assert.equal(database.auditRecords.at(-1).action, 'vendor.rejected');
});

test('sensitive verification documents require administrator authorization and remain scoped to their vendor', async () => {
  const denied = await fetch(`${baseUrl}/api/admin/vendor-verification/1/documents/501`);
  assert.equal(denied.status, 401);

  const forbiddenDocument = await adminRequest('/api/admin/vendor-verification/2/documents/501');
  assert.equal(forbiddenDocument.status, 404);

  const response = await adminRequest('/api/admin/vendor-verification/1/documents/501');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '%PDF-1.7 verification document');
});

test('verification document upload validation checks signatures, types, and the 5 MB limit', () => {
  assert.equal(validateVendorVerificationDocument(Buffer.from('%PDF-1.7 file'), 'application/pdf'), null);
  assert.match(validateVendorVerificationDocument(Buffer.from('not pdf'), 'application/pdf'), /contents do not match/);
  assert.match(validateVendorVerificationDocument(Buffer.from('%PDF-1.7 file'), 'image/png'), /contents do not match/);
  assert.match(validateVendorVerificationDocument(Buffer.alloc(5 * 1024 * 1024 + 1), 'application/pdf'), /5 MB or smaller/);
});

test('vendor application document uploads require a platform session and remain private to the account', async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/platform/vendor-application/documents`);
  assert.equal(unauthenticated.status, 401);

  const vendor = database.vendors[0];
  const originalStatus = vendor.verification_status;
  vendor.verification_status = 'information_requested';
  const pdf = Buffer.from('%PDF-1.7 registration certificate');
  const uploaded = await fetch(`${baseUrl}/api/platform/vendor-application/documents?filename=registration.pdf`, {
    method: 'POST',
    headers: {
      Cookie: `platform_session=${platformToken}`,
      'Content-Type': 'application/pdf',
    },
    body: pdf,
  });
  assert.equal(uploaded.status, 201);

  const listed = await fetch(`${baseUrl}/api/platform/vendor-application/documents`, {
    headers: { Cookie: `platform_session=${platformToken}` },
  });
  assert.equal(listed.status, 200);
  const documents = (await listed.json()).data;
  assert.ok(documents.some((document) => document.original_name === 'registration.pdf'));
  assert.equal(Object.hasOwn(documents.find((document) => document.original_name === 'registration.pdf'), 'content'), false);

  const invalidType = await fetch(`${baseUrl}/api/platform/vendor-application/documents?filename=spoofed.pdf`, {
    method: 'POST',
    headers: {
      Cookie: `platform_session=${platformToken}`,
      'Content-Type': 'application/pdf',
    },
    body: Buffer.from('not a PDF'),
  });
  assert.equal(invalidType.status, 400);
  vendor.verification_status = originalStatus;
});
