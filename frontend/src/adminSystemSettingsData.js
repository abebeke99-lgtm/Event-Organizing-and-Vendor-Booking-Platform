export const ADMIN_SYSTEM_SETTINGS_STORAGE_KEY = 'eventhub:admin-system-settings:v1';

export const SYSTEM_SETTINGS_SECTIONS = [
  { id: 'general', label: 'General Settings', translationKey: 'nav.dashboard.settings.general', description: 'Core platform identity, language, and regional defaults.' },
  { id: 'platform', label: 'Platform Information', translationKey: 'nav.dashboard.settings.platform', description: 'Organization and registration information.' },
  { id: 'appearance', label: 'Appearance Settings', translationKey: 'nav.dashboard.settings.appearance', description: 'Customize the look and feel of the platform.' },
  { id: 'localization', label: 'Localization Settings', translationKey: 'nav.dashboard.settings.localization', description: 'Configure language, currency, and date conventions.' },
  { id: 'email', label: 'Email Configuration', translationKey: 'nav.dashboard.settings.email', description: 'Configure demonstration email sender preferences.' },
  { id: 'notifications', label: 'Notification Settings', translationKey: 'nav.dashboard.settings.notifications', description: 'Choose which events generate a demonstration notification.' },
  { id: 'payments', label: 'Payment Settings', translationKey: 'nav.dashboard.settings.payments', description: 'Preview platform payment and commission preferences.' },
  { id: 'bookings', label: 'Booking Settings', translationKey: 'nav.dashboard.settings.bookings', description: 'Configure the demonstration booking workflow.' },
  { id: 'roles', label: 'User & Role Settings', translationKey: 'nav.dashboard.settings.roles', description: 'Review roles and configure demo permission presets.' },
  { id: 'security', label: 'Security Settings', translationKey: 'nav.dashboard.settings.security', description: 'Review demonstration account and session preferences.' },
  { id: 'privacy', label: 'Privacy Settings', translationKey: 'nav.dashboard.settings.privacy', description: 'Configure privacy, visibility, and data preferences.' },
  { id: 'media', label: 'File & Media Settings', translationKey: 'nav.dashboard.settings.media', description: 'Set demonstration file limits and image defaults.' },
  { id: 'maintenance', label: 'Maintenance Mode', translationKey: 'nav.dashboard.settings.maintenance', description: 'Preview a maintenance experience without affecting the live platform.' },
  { id: 'backup', label: 'Backup & Restore', translationKey: 'nav.dashboard.settings.backup', description: 'Create and restore downloadable demonstration settings snapshots.' },
  { id: 'social', label: 'Social Media Settings', translationKey: 'nav.dashboard.settings.social', description: 'Manage public social links and their preview.' },
  { id: 'contact', label: 'Contact Information', translationKey: 'nav.dashboard.settings.contact', description: 'Configure and preview public support information.' },
  { id: 'terms', label: 'Terms & Conditions', translationKey: 'nav.dashboard.settings.terms', description: 'Edit and preview the demonstration terms document.' },
  { id: 'policy', label: 'Privacy Policy', translationKey: 'nav.dashboard.settings.policy', description: 'Edit and preview the demonstration privacy policy.' },
  { id: 'logs', label: 'System Logs', translationKey: 'nav.dashboard.settings.logs', description: 'Inspect sample browser-generated activity logs.' },
];

const notificationTypes = [
  'New User Registration', 'New Organizer Registration', 'New Vendor Registration',
  'Vendor Verification Request', 'Vendor Verification Approved', 'Vendor Verification Rejected',
  'New Event Created', 'New Booking Request', 'Booking Confirmed', 'Booking Cancelled',
  'New Quotation', 'Payment Status Updated', 'New Review', 'New Complaint', 'System Maintenance',
];

const bookingStatuses = ['Pending', 'Accepted', 'Awaiting Payment', 'Confirmed', 'In Progress', 'Completed', 'Rejected', 'Cancelled', 'Expired'];
const roleNames = ['Administrator', 'Event Organizer', 'Vendor', 'Customer', 'Visitor / Guest'];
const permissionNames = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Manage'];
const roleDescriptions = [
  'Full platform administration and configuration.',
  'Creates and manages events and vendor bookings.',
  'Manages services, quotations, and assigned bookings.',
  'Browses services and manages personal bookings.',
  'Browses public event and vendor information.',
];

const makeRole = (name, index) => ({
  name,
  description: roleDescriptions[index],
  enabled: true,
  dashboard: ['Admin dashboard', 'Organizer dashboard', 'Vendor dashboard', 'Customer dashboard', 'Public site'][index],
  activation: ['Manual approval', 'Email verification', 'Admin verification', 'Email verification', 'No account'][index],
  permissions: Object.fromEntries(permissionNames.map((permission) => [permission, index === 0 || (index === 1 && ['View', 'Create', 'Edit', 'Delete'].includes(permission)) || (index === 2 && ['View', 'Create', 'Edit'].includes(permission)) || (index === 3 && ['View', 'Create', 'Edit'].includes(permission)) || (index === 4 && permission === 'View')])),
});

export const DEFAULT_ADMIN_SYSTEM_SETTINGS = {
  general: {
    platformName: 'EventHub', tagline: 'Plan better. Celebrate more.', description: 'A trusted marketplace for events, organizers, and service professionals.', websiteUrl: 'https://eventhub.example', language: 'English', currency: 'ETB', timezone: 'Africa/Addis_Ababa', dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', contactEmail: 'hello@eventhub.example', contactPhone: '+251 11 123 4567', logo: '', favicon: '',
  },
  platform: {
    platformName: 'EventHub', organizationName: 'EventHub Events', owner: 'Platform Administrator', institution: 'EventHub Events PLC', registrationNumber: 'DEMO-REG-2025', supportEmail: 'support@eventhub.example', supportPhone: '+251 11 123 4567', address: 'Bole Road, Friendship City Center', country: 'Ethiopia', city: 'Addis Ababa', postalCode: '1000',
  },
  appearance: {
    primaryColor: '#3074b3', secondaryColor: '#172554', accentColor: '#7658d6', backgroundColor: '#f4f6fb', textColor: '#17233a', theme: 'Light', sidebarAppearance: 'Dark', dashboardLayout: 'Comfortable', fontFamily: 'DM Sans', borderRadius: '12', cardStyle: 'Elevated',
  },
  localization: {
    language: 'English', availableLanguages: ['English', 'Amharic'], currency: 'ETB', currencySymbol: 'Br', currencyPosition: 'Before amount', timezone: 'Africa/Addis_Ababa', dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', numberFormat: '1,234.56', firstDayOfWeek: 'Monday',
  },
  email: {
    senderName: 'EventHub', senderEmail: 'notifications@eventhub.example', replyToEmail: 'support@eventhub.example', smtpHost: 'smtp.example.test', smtpPort: '587', smtpUsername: 'demo-user', smtpPassword: '', encryption: 'TLS', enabled: true, testStatus: 'Not tested',
  },
  notifications: {
    channels: { Email: true, 'In-App': true, 'SMS (demo)': false },
    events: Object.fromEntries(notificationTypes.map((name) => [name, true])),
  },
  payments: {
    currency: 'ETB', currencySymbol: 'Br', platformCommission: '5', vendorCommission: '3', minimumBookingAmount: '100', maximumBookingAmount: '1000000', paymentDemo: true, refundDemo: true,
    methods: { 'Bank Transfer': true, Cash: true, Telebirr: true, 'CBE Birr': true, 'Other Payment Methods': false },
    statuses: ['Pending', 'Authorized', 'Paid', 'Failed', 'Refunded'],
  },
  bookings: {
    newBookings: true, customerLogin: true, vendorApproval: true, bookingConfirmation: true, cancellation: true, cancellationDeadline: '48', expirationPeriod: '72', minimumNotice: '24', maximumAdvance: '365', quotations: true, reviews: true, contactVendors: true, statuses: bookingStatuses,
  },
  roles: { roles: roleNames.map(makeRole) },
  security: {
    twoFactorDemo: false, passwordMinimumLength: '10', uppercase: true, lowercase: true, numbers: true, specialCharacters: true, passwordExpiration: '90', maximumLoginAttempts: '5', sessionTimeout: '30', loginNotifications: true, accountLockout: true, activeSessions: true,
  },
  privacy: {
    privacyConfiguration: 'Demonstration privacy preferences. No personal data is collected by these settings.', termsConfiguration: 'Demonstration terms preferences.', cookieConsent: true, dataCollection: 'Essential platform data only', publicProfiles: true, customerProfiles: false, vendorProfiles: true, reviewVisibility: true, dataExport: 'Users can request a copy of their information from account support.', accountDeletion: 'Deletion requests are reviewed by the platform support team.',
  },
  media: {
    maximumImageSize: '5', maximumDocumentSize: '10', imageFormats: 'JPG, PNG, WebP', documentFormats: 'PDF, DOCX', imageQuality: '85', imagePreview: true, defaultProfileImage: '', defaultEventImage: '', defaultVendorImage: '',
  },
  maintenance: {
    enabled: false, title: 'We will be back soon', message: 'We are improving EventHub to serve you better. Please check back shortly.', estimatedCompletion: '', illustration: '', displayContact: true,
  },
  backup: { history: [], selectedBackup: '' },
  social: {
    enabled: true, Facebook: 'https://facebook.com/eventhub', Instagram: 'https://instagram.com/eventhub', Telegram: 'https://t.me/eventhub', LinkedIn: '', YouTube: '', TikTok: '', X: '',
  },
  contact: {
    organizationName: 'EventHub Events', email: 'support@eventhub.example', phone: '+251 11 123 4567', alternativePhone: '', address: 'Bole Road, Friendship City Center', city: 'Addis Ababa', country: 'Ethiopia', mapsUrl: '', businessHours: 'Monday–Friday, 9:00 AM–5:00 PM', availability: 'Email support available 24/7',
  },
  terms: {
    title: 'Terms & Conditions', content: 'Welcome to EventHub. By using this demonstration platform, you agree to use it responsibly.\\n\\nBookings and payments shown here are for demonstration only. No real transaction is created.', version: '1.0', updatedAt: '2025-01-01', status: 'Draft',
  },
  policy: {
    title: 'Privacy Policy', content: 'This demonstration does not send settings to a server. Preferences are stored in this browser only.\\n\\nDo not enter real credentials or sensitive personal information.', version: '1.0', updatedAt: '2025-01-01', status: 'Draft',
  },
  logs: { records: [
    { id: 'DEMO-001', activity: 'Administrator signed in', user: 'admin@eventhub.example', role: 'Administrator', type: 'Authentication', date: '2025-02-20T08:30:00Z', status: 'Success', details: 'Sample browser-generated log. Not a server audit record.' },
    { id: 'DEMO-002', activity: 'Vendor verification reviewed', user: 'admin@eventhub.example', role: 'Administrator', type: 'Vendor', date: '2025-02-19T13:15:00Z', status: 'Success', details: 'Demonstration review activity.' },
    { id: 'DEMO-003', activity: 'Booking settings previewed', user: 'admin@eventhub.example', role: 'Administrator', type: 'Settings', date: '2025-02-18T10:45:00Z', status: 'Info', details: 'Settings page opened in demonstration mode.' },
    { id: 'DEMO-004', activity: 'Payment demonstration initiated', user: 'vendor@eventhub.example', role: 'Vendor', type: 'Payment', date: '2025-02-17T15:05:00Z', status: 'Info', details: 'No payment gateway or real transaction was used.' },
    { id: 'DEMO-005', activity: 'Account activation request', user: 'organizer@eventhub.example', role: 'Event Organizer', type: 'Account', date: '2025-02-16T09:10:00Z', status: 'Pending', details: 'Sample organizer activation record.' },
  ] },
};

export function createDefaultAdminSystemSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_ADMIN_SYSTEM_SETTINGS));
}

function mergeStoredValue(defaultValue, storedValue, path) {
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(storedValue)) throw new Error(`Saved setting "${path}" must be a list.`);
    return storedValue;
  }
  if (defaultValue && typeof defaultValue === 'object') {
    if (!storedValue || typeof storedValue !== 'object' || Array.isArray(storedValue)) {
      throw new Error(`Saved setting "${path}" must be an object.`);
    }
    const merged = { ...defaultValue };
    for (const [key, value] of Object.entries(defaultValue)) {
      if (Object.prototype.hasOwnProperty.call(storedValue, key)) merged[key] = mergeStoredValue(value, storedValue[key], `${path}.${key}`);
    }
    return merged;
  }
  if (typeof storedValue !== typeof defaultValue) {
    throw new Error(`Saved setting "${path}" has an invalid value type.`);
  }
  return storedValue;
}

export function loadAdminSystemSettings(storage) {
  const defaults = createDefaultAdminSystemSettings();
  const raw = storage.getItem(ADMIN_SYSTEM_SETTINGS_STORAGE_KEY);
  if (raw === null) return { settings: defaults, error: '' };
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Saved system settings are invalid. Reset them to restore defaults.');
  }
  if (parsed._savedAt !== undefined && typeof parsed._savedAt !== 'string') {
    throw new Error('Saved system settings metadata is invalid.');
  }
  const settings = { ...defaults };
  for (const section of SYSTEM_SETTINGS_SECTIONS) {
    const storedSection = parsed[section.id];
    if (storedSection !== undefined) settings[section.id] = mergeStoredValue(defaults[section.id], storedSection, section.id);
  }
  return { settings, error: '', lastSaved: parsed._savedAt || '' };
}

export function saveAdminSystemSettings(settings, storage, savedAt = new Date().toISOString()) {
  storage.setItem(ADMIN_SYSTEM_SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, _savedAt: savedAt }));
}

export function validateAdminSetting(sectionId, key, value) {
  if (typeof value !== 'string') return '';
  const required = {
    general: ['platformName', 'contactEmail'],
    platform: ['organizationName', 'supportEmail'],
    email: ['senderName', 'senderEmail'],
    contact: ['organizationName', 'email'],
    terms: ['title', 'content'],
    policy: ['title', 'content'],
  };
  if ((required[sectionId] || []).includes(key) && !value.trim()) return 'This field is required.';
  if (key.toLowerCase().includes('email') && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Enter a valid email address.';
  }
  if ((key.toLowerCase().includes('url') || key.endsWith('Url') || key === 'mapsUrl' || ['Facebook', 'Instagram', 'Telegram', 'LinkedIn', 'YouTube', 'TikTok', 'X'].includes(key)) && value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return 'Use a valid HTTP or HTTPS URL.';
    } catch {
      return 'Enter a valid URL beginning with https://.';
    }
  }
  if (sectionId === 'appearance' && key.endsWith('Color') && !/^#[\da-f]{6}$/i.test(value)) {
    return 'Enter a 6-digit hexadecimal color.';
  }
  if (sectionId === 'payments' && ['platformCommission', 'vendorCommission'].includes(key) && value !== '' && (Number(value) < 0 || Number(value) > 100)) {
    return 'Commission must be between 0 and 100.';
  }
  const numericKeys = [
    'smtpPort', 'borderRadius', 'minimumBookingAmount', 'maximumBookingAmount', 'cancellationDeadline',
    'expirationPeriod', 'minimumNotice', 'maximumAdvance', 'passwordMinimumLength', 'passwordExpiration',
    'maximumLoginAttempts', 'sessionTimeout', 'maximumImageSize', 'maximumDocumentSize',
  ];
  if (numericKeys.includes(key) && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 1)) {
    return 'Enter a number greater than zero.';
  }
  return '';
}
