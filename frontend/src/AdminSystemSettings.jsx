import { useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, Bell, Building2, CalendarDays, Check, CircleHelp, Clock3,
  CloudDownload, FileText, Globe2, Image, Mail, Palette, RotateCcw, Save, Search,
  ShieldCheck, SlidersHorizontal, Upload, Users, Wallet, X,
} from 'lucide-react';
import {
  createDefaultAdminSystemSettings, loadAdminSystemSettings, saveAdminSystemSettings,
  SYSTEM_SETTINGS_SECTIONS, validateAdminSetting,
} from './adminSystemSettingsData.js';
import { translate, useLanguage } from './language.js';
import './adminSystemSettings.css';

const sectionIcons = {
  general: SlidersHorizontal, platform: Building2, appearance: Palette, localization: Globe2,
  email: Mail, notifications: Bell, payments: Wallet, bookings: CalendarDays, roles: Users,
  security: ShieldCheck, privacy: ShieldCheck, media: Image, maintenance: Clock3,
  backup: CloudDownload, social: Globe2, contact: Building2, terms: FileText, policy: FileText, logs: Activity,
};

const selectOptions = {
  language: ['English', 'Amharic'], currency: ['ETB', 'USD', 'EUR'], timezone: ['Africa/Addis_Ababa', 'UTC', 'Europe/London', 'America/New_York'],
  dateFormat: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], timeFormat: ['12-hour', '24-hour'], theme: ['Light', 'Dark', 'System'],
  sidebarAppearance: ['Dark', 'Light', 'Colored'], dashboardLayout: ['Comfortable', 'Compact', 'Wide'], fontFamily: ['DM Sans', 'Inter', 'Manrope', 'System'],
  cardStyle: ['Elevated', 'Flat', 'Outlined'], currencyPosition: ['Before amount', 'After amount'], firstDayOfWeek: ['Monday', 'Sunday', 'Saturday'],
  encryption: ['None', 'TLS', 'SSL'], availability: ['Email support available 24/7', 'Business hours only', 'Phone and email support'],
  imageQuality: ['60', '70', '80', '85', '90', '100'], status: ['Draft', 'Published'], activation: ['Manual approval', 'Email verification', 'Admin verification', 'No account'],
};

const sectionsWithFields = {
  general: [
    ['platformName', 'Platform Name'], ['tagline', 'Platform Tagline'], ['description', 'Platform Description', 'textarea'],
    ['websiteUrl', 'Website URL', 'url'], ['language', 'Default Language', 'select'], ['currency', 'Default Currency', 'select'],
    ['timezone', 'Time Zone', 'select'], ['dateFormat', 'Date Format', 'select'], ['timeFormat', 'Time Format', 'select'],
    ['contactEmail', 'Contact Email', 'email'], ['contactPhone', 'Contact Phone', 'tel'],
  ],
  platform: [
    ['platformName', 'Platform Name'], ['organizationName', 'Organization Name'], ['owner', 'Platform Owner'],
    ['institution', 'Institution / Company Name'], ['registrationNumber', 'Registration Number'], ['supportEmail', 'Support Email', 'email'],
    ['supportPhone', 'Support Phone', 'tel'], ['address', 'Business Address'], ['country', 'Country'], ['city', 'City'], ['postalCode', 'Postal Code'],
  ],
  appearance: [
    ['primaryColor', 'Primary Color', 'color'], ['secondaryColor', 'Secondary Color', 'color'], ['accentColor', 'Accent Color', 'color'],
    ['backgroundColor', 'Background Color', 'color'], ['textColor', 'Text Color', 'color'], ['theme', 'Theme', 'select'],
    ['sidebarAppearance', 'Sidebar Appearance', 'select'], ['dashboardLayout', 'Dashboard Layout', 'select'], ['fontFamily', 'Font Family', 'select'],
    ['borderRadius', 'Border Radius (px)', 'number'], ['cardStyle', 'Card Style', 'select'],
  ],
  localization: [
    ['language', 'Default Language', 'select'], ['currency', 'Default Currency', 'select'], ['currencySymbol', 'Currency Symbol'],
    ['currencyPosition', 'Currency Position', 'select'], ['timezone', 'Time Zone', 'select'], ['dateFormat', 'Date Format', 'select'],
    ['timeFormat', 'Time Format', 'select'], ['numberFormat', 'Number Format'], ['firstDayOfWeek', 'First Day of Week', 'select'],
  ],
  email: [
    ['senderName', 'Sender Name'], ['senderEmail', 'Sender Email', 'email'], ['replyToEmail', 'Reply-To Email', 'email'],
    ['smtpHost', 'SMTP Host'], ['smtpPort', 'SMTP Port', 'number'], ['smtpUsername', 'SMTP Username'],
    ['smtpPassword', 'SMTP Password', 'password'], ['encryption', 'Encryption Type', 'select'],
  ],
  payments: [
    ['currency', 'Default Currency', 'select'], ['currencySymbol', 'Currency Symbol'], ['platformCommission', 'Platform Commission (%)', 'number'],
    ['vendorCommission', 'Vendor Commission (%)', 'number'], ['minimumBookingAmount', 'Minimum Booking Amount', 'number'],
    ['maximumBookingAmount', 'Maximum Booking Amount', 'number'],
  ],
  bookings: [
    ['cancellationDeadline', 'Cancellation Deadline (hours)', 'number'], ['expirationPeriod', 'Booking Expiration (hours)', 'number'],
    ['minimumNotice', 'Minimum Booking Notice (hours)', 'number'], ['maximumAdvance', 'Maximum Advance Booking (days)', 'number'],
  ],
  security: [
    ['passwordMinimumLength', 'Password Minimum Length', 'number'], ['passwordExpiration', 'Password Expiration (days)', 'number'],
    ['maximumLoginAttempts', 'Maximum Login Attempts', 'number'], ['sessionTimeout', 'Session Timeout (minutes)', 'number'],
  ],
  media: [
    ['maximumImageSize', 'Maximum Image Upload Size (MB)', 'number'], ['maximumDocumentSize', 'Maximum Document Upload Size (MB)', 'number'],
    ['imageFormats', 'Allowed Image Formats'], ['documentFormats', 'Allowed Document Formats'], ['imageQuality', 'Image Quality (%)', 'select'],
  ],
  maintenance: [
    ['title', 'Maintenance Title'], ['message', 'Maintenance Message', 'textarea'], ['estimatedCompletion', 'Estimated Completion Time', 'datetime-local'],
  ],
  social: [
    ['Facebook', 'Facebook URL', 'url'], ['Instagram', 'Instagram URL', 'url'], ['Telegram', 'Telegram URL', 'url'], ['LinkedIn', 'LinkedIn URL', 'url'],
    ['YouTube', 'YouTube URL', 'url'], ['TikTok', 'TikTok URL', 'url'], ['X', 'X URL', 'url'],
  ],
  contact: [
    ['organizationName', 'Organization Name'], ['email', 'Contact Email', 'email'], ['phone', 'Phone Number', 'tel'],
    ['alternativePhone', 'Alternative Phone', 'tel'], ['address', 'Office Address'], ['city', 'City'], ['country', 'Country'],
    ['mapsUrl', 'Google Maps URL', 'url'], ['businessHours', 'Business Hours'], ['availability', 'Support Availability', 'select'],
  ],
  terms: [['title', 'Document Title'], ['version', 'Version Number'], ['updatedAt', 'Last Updated', 'date'], ['status', 'Publish Status', 'select'], ['content', 'Document Content', 'textarea']],
  policy: [['title', 'Policy Title'], ['version', 'Version Number'], ['updatedAt', 'Last Updated', 'date'], ['status', 'Policy Status', 'select'], ['content', 'Policy Content', 'textarea']],
};

const toggleFields = {
  email: [['enabled', 'Enable Email Notifications']],
  payments: [['paymentDemo', 'Enable Payment Demonstration'], ['refundDemo', 'Enable Refund Demonstration']],
  bookings: [['newBookings', 'Enable New Bookings'], ['customerLogin', 'Require Customer Login'], ['vendorApproval', 'Require Vendor Approval'], ['bookingConfirmation', 'Require Booking Confirmation'], ['cancellation', 'Allow Booking Cancellation'], ['quotations', 'Enable Quotation Requests'], ['reviews', 'Enable Booking Reviews'], ['contactVendors', 'Allow Customers to Contact Vendors']],
  security: [['twoFactorDemo', 'Enable Two-Factor Authentication (demo)'], ['uppercase', 'Require Uppercase Letters'], ['lowercase', 'Require Lowercase Letters'], ['numbers', 'Require Numbers'], ['specialCharacters', 'Require Special Characters'], ['loginNotifications', 'Enable Login Notifications'], ['accountLockout', 'Enable Account Lockout'], ['activeSessions', 'Display Active Sessions']],
  privacy: [['cookieConsent', 'Cookie Consent Demonstration'], ['publicProfiles', 'Public Profile Visibility'], ['customerProfiles', 'Customer Profile Visibility'], ['vendorProfiles', 'Vendor Profile Visibility'], ['reviewVisibility', 'Review Visibility']],
  media: [['imagePreview', 'Enable Image Preview']],
  maintenance: [['displayContact', 'Display Contact Information']],
  social: [['enabled', 'Enable Social Links']],
};

const notificationTypes = Object.keys(createDefaultAdminSystemSettings().notifications.events);
const permissionNames = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Manage'];
const roleColumns = ['Role', ...permissionNames];
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'The local settings operation could not be completed.';
}

function Field({ section, definition, value, onChange, error, disabled, inputRef }) {
  const [key, label, type = 'text'] = definition;
  const common = {
    id: `${section}-${key}`,
    name: key,
    disabled,
    value: value ?? '',
    onChange: (event) => onChange(event.target.value),
    onBlur: () => {},
  };
  if (type === 'select') {
    const options = selectOptions[key] || (key === 'status' ? ['Draft', 'Published'] : []);
    return <label className="as-field" htmlFor={common.id}><span>{label}</span><select {...common}>{options.map((option) => <option key={option}>{option}</option>)}</select>{error && <small className="as-field-error">{error}</small>}</label>;
  }
  if (type === 'textarea') {
    return <label className="as-field as-field-wide" htmlFor={common.id}><span>{label}</span><textarea {...common} ref={inputRef} rows={key === 'content' || key === 'description' ? 8 : 4} />{error && <small className="as-field-error">{error}</small>}</label>;
  }
  if (type === 'color') {
    return <label className="as-field as-color-field" htmlFor={common.id}><span>{label}</span><span className="as-color-control"><input {...common} type="color" /><input value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={`${label} hex value`} /></span>{error && <small className="as-field-error">{error}</small>}</label>;
  }
  return <label className={`as-field ${['url', 'email'].includes(type) ? '' : ''}`} htmlFor={common.id}><span>{label}</span><input {...common} type={type} min={type === 'number' ? '1' : undefined} />{error && <small className="as-field-error">{error}</small>}</label>;
}

function Toggle({ label, checked, onChange, disabled = false, hint = '' }) {
  return <label className={`as-toggle ${disabled ? 'is-disabled' : ''}`}><span className="as-toggle-copy"><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="as-toggle-track" aria-hidden="true" /></label>;
}

function Card({ title, description, children, className = '' }) {
  return <section className={`as-card ${className}`}><div className="as-card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{children}</section>;
}

export default function AdminSystemSettings() {
  const language = useLanguage();
  const [initial] = useState(() => {
    try {
      return loadAdminSystemSettings(window.localStorage);
    } catch (error) {
      return { settings: createDefaultAdminSystemSettings(), error: getErrorMessage(error), lastSaved: '' };
    }
  });
  const [settings, setSettings] = useState(initial.settings);
  const [savedSettings, setSavedSettings] = useState(() => clone(initial.settings));
  const [activeSection, setActiveSection] = useState('general');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState(initial.error);
  const [lastSaved, setLastSaved] = useState(initial.lastSaved);
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [logFilters, setLogFilters] = useState({ query: '', user: 'All users', role: 'All roles', type: 'All activity', status: 'All statuses', from: '', to: '' });
  const [selectedLog, setSelectedLog] = useState(null);
  const [selectedBackup, setSelectedBackup] = useState('');
  const contentRefs = useRef({});
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const section = SYSTEM_SETTINGS_SECTIONS.find((item) => item.id === activeSection) || SYSTEM_SETTINGS_SECTIONS[0];
  const visibleSections = SYSTEM_SETTINGS_SECTIONS.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  const current = settings[activeSection];
  const sectionDirty = JSON.stringify(current) !== JSON.stringify(savedSettings[activeSection]);

  function update(sectionId, key, value) {
    setSettings((state) => ({ ...state, [sectionId]: { ...state[sectionId], [key]: value } }));
    setError('');
    setToast('');
  }

  function setField(sectionId, key, value) {
    update(sectionId, key, value);
    setFieldErrors((errors) => ({ ...errors, [`${sectionId}.${key}`]: validateAdminSetting(sectionId, key, value) }));
  }

  function saveSnapshot(snapshot, successMessage = 'Settings saved in this browser.') {
    try {
      const savedAt = new Date().toISOString();
      saveAdminSystemSettings(snapshot, window.localStorage, savedAt);
      setSavedSettings(clone(snapshot));
      setLastSaved(savedAt);
      setError('');
      setToast(successMessage);
      setConfirm(null);
      return true;
    } catch (issue) {
      setError(getErrorMessage(issue));
      setToast('');
      return false;
    }
  }

  function validateFields(sectionIds) {
    const failures = {};
    for (const sectionId of sectionIds) {
      const sectionData = settings[sectionId];
      for (const [key, value] of Object.entries(sectionData)) {
        if (typeof value !== 'string') continue;
        const message = validateAdminSetting(sectionId, key, value);
        if (message) failures[`${sectionId}.${key}`] = message;
      }
    }
    if (sectionIds.includes('payments') && Number(settings.payments.maximumBookingAmount) < Number(settings.payments.minimumBookingAmount)) {
      failures['payments.maximumBookingAmount'] = 'Maximum booking amount must be greater than or equal to the minimum amount.';
    }
    setFieldErrors((errors) => ({ ...errors, ...failures }));
    return Object.keys(failures).length === 0;
  }

  function saveAll() {
    if (!validateFields(SYSTEM_SETTINGS_SECTIONS.map((item) => item.id))) {
      setError('Review the highlighted fields before saving.');
      setToast('');
      return;
    }
    saveSnapshot(settings, 'All demonstration settings saved in this browser.');
  }

  function saveSection() {
    if (!validateFields([activeSection])) {
      setError('Review the highlighted fields before saving.');
      setToast('');
      return;
    }
    const snapshot = { ...savedSettings, [activeSection]: clone(settings[activeSection]) };
    if (saveSnapshot(snapshot)) setSettings((state) => ({ ...state, [activeSection]: clone(snapshot[activeSection]) }));
  }

  function resetSection() {
    setConfirm({
      title: 'Reset this section?',
      message: `Discard unsaved changes to ${section.label} and restore the last saved values?`,
      confirmLabel: 'Discard changes',
      onConfirm: () => {
        setSettings((state) => ({ ...state, [activeSection]: clone(savedSettings[activeSection]) }));
        setFieldErrors((errors) => Object.fromEntries(Object.entries(errors).filter(([key]) => !key.startsWith(`${activeSection}.`))));
        setConfirm(null);
        setToast('Unsaved section changes were discarded.');
        setError('');
      },
    });
  }

  function resetAll() {
    setConfirm({
      title: 'Reset all settings?',
      message: 'This replaces all saved demonstration settings in this browser with the original defaults. This does not change server settings.',
      confirmLabel: 'Reset all settings',
      danger: true,
      onConfirm: () => {
        const defaults = createDefaultAdminSystemSettings();
        setSettings(defaults);
        setFieldErrors({});
        saveSnapshot(defaults, 'All demonstration settings were reset to defaults.');
      },
    });
  }

  function requestToggle(sectionId, key, checked) {
    if (sectionId === 'maintenance' && key === 'enabled' && checked) {
      setConfirm({
        title: 'Enable demo maintenance mode?',
        message: 'This only displays a maintenance preview in this settings page. It does not take the live platform offline.',
        confirmLabel: 'Enable preview',
        onConfirm: () => {
          update(sectionId, key, true);
          setConfirm(null);
        },
      });
      return;
    }
    update(sectionId, key, checked);
  }

  async function uploadImage(sectionId, key, file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon'].includes(file.type)) {
      setError('Choose a PNG, JPG, WebP, SVG, or ICO image.');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Choose an image smaller than 1.5 MB so it can be stored safely in this browser.');
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The image could not be read.'));
        reader.readAsDataURL(file);
      });
      update(sectionId, key, dataUrl);
      setToast('Image preview loaded. Save this section to keep it in this browser.');
    } catch (issue) {
      setError(getErrorMessage(issue));
    }
  }

  function downloadJson(filename, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setToast('Demonstration JSON downloaded.');
      setError('');
    } catch (issue) {
      setError(getErrorMessage(issue));
      setToast('');
    }
  }

  function createBackup() {
    const safeSnapshot = { ...clone(settings), backup: { history: [], selectedBackup: '' } };
    const payload = JSON.stringify(safeSnapshot);
    const record = {
      id: `backup-${Date.now()}`,
      name: `EventHub demo settings ${new Date().toLocaleString()}`,
      date: new Date().toISOString(),
      size: `${Math.max(1, Math.round(new Blob([payload]).size / 1024))} KB`,
      status: 'Ready',
      snapshot: safeSnapshot,
    };
    update('backup', 'history', [record, ...settings.backup.history]);
    update('backup', 'selectedBackup', record.id);
    setToast('Demo backup created in this browser. It is not a database backup.');
  }

  function restoreBackup(record) {
    if (!record?.snapshot) {
      setError('The selected demo backup is unavailable.');
      return;
    }
    setConfirm({
      title: 'Restore this demo backup?',
      message: 'The current demonstration settings will be replaced by this saved browser snapshot. This does not restore a database.',
      confirmLabel: 'Restore demo settings',
      onConfirm: () => {
        const restored = { ...clone(record.snapshot), backup: clone(settings.backup) };
        setSettings(restored);
        saveSnapshot(restored, 'Demo settings restored from the selected browser snapshot.');
      },
    });
  }

  function clearLogs() {
    setConfirm({
      title: 'Clear demonstration logs?',
      message: 'This removes the sample log records stored by this browser only. It does not clear server audit logs.',
      confirmLabel: 'Clear demo logs',
      danger: true,
      onConfirm: () => {
        const next = { ...settings, logs: { records: [] } };
        setSettings(next);
        saveSnapshot(next, 'Demonstration logs cleared.');
      },
    });
  }

  function exportLogs() {
    try {
      const rows = filteredLogs.map((row) => [row.id, row.activity, row.user, row.role, row.type, row.date, row.status, row.details]);
      const csv = [['Log ID', 'Activity', 'User', 'Role', 'Action Type', 'Date and Time', 'Status', 'Details'], ...rows]
        .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'eventhub-demo-logs.csv';
      link.click();
      URL.revokeObjectURL(url);
      setToast('Filtered demonstration logs exported.');
      setError('');
    } catch (issue) {
      setError(getErrorMessage(issue));
      setToast('');
    }
  }

  const filteredLogs = useMemo(() => {
    const query = logFilters.query.toLowerCase();
    return settings.logs.records.filter((row) => {
      const matchesQuery = !query || [row.id, row.activity, row.user, row.details].some((value) => String(value).toLowerCase().includes(query));
      const matches = matchesQuery &&
        (logFilters.user === 'All users' || row.user === logFilters.user) &&
        (logFilters.role === 'All roles' || row.role === logFilters.role) &&
        (logFilters.type === 'All activity' || row.type === logFilters.type) &&
        (logFilters.status === 'All statuses' || row.status === logFilters.status) &&
        (!logFilters.from || row.date.slice(0, 10) >= logFilters.from) &&
        (!logFilters.to || row.date.slice(0, 10) <= logFilters.to);
      return matches;
    });
  }, [logFilters, settings.logs.records]);

  function formatSelection(sectionId, key, marker) {
    const area = contentRefs.current[`${sectionId}.${key}`];
    const value = settings[sectionId][key] || '';
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    const selection = value.slice(start, end) || 'text';
    const next = `${value.slice(0, start)}${marker}${selection}${marker}${value.slice(end)}`;
    setField(sectionId, key, next);
    requestAnimationFrame(() => area?.focus());
  }

  function renderFields(sectionId, definitions = sectionsWithFields[sectionId] || []) {
    return <div className="as-fields">{definitions.map((definition) => {
      const [key] = definition;
      return <Field key={key} section={sectionId} definition={definition} value={settings[sectionId][key]} onChange={(value) => setField(sectionId, key, value)} error={fieldErrors[`${sectionId}.${key}`]} inputRef={key === 'content' ? (element) => { contentRefs.current[`${sectionId}.${key}`] = element; } : undefined} />;
    })}</div>;
  }

  function renderToggles(sectionId, definitions = toggleFields[sectionId] || []) {
    return <div className="as-toggle-list">{definitions.map(([key, label]) => <Toggle key={key} label={label} checked={settings[sectionId][key]} onChange={(checked) => requestToggle(sectionId, key, checked)} hint={sectionId === 'security' || sectionId === 'privacy' ? 'Demonstration preference only.' : ''} />)}</div>;
  }

  function renderImageUpload(sectionId, key, label) {
    const value = settings[sectionId][key];
    return <div className="as-upload-field" key={key}>
      <div className="as-upload-heading"><div><strong>{label}</strong><small>Image preview only. Files stay in this browser.</small></div>
        <label className="as-button as-button-quiet"><Upload size={15} /> Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" onChange={(event) => { uploadImage(sectionId, key, event.target.files?.[0]); event.target.value = ''; }} /></label>
      </div>
      <div className="as-image-preview">{value ? <img src={value} alt={`${label} preview`} /> : <span>No image selected</span>}</div>
      <div className="as-inline-actions">
        <button className="as-button as-button-quiet" type="button" disabled={!value} onClick={() => setPreview({ title: `${label} preview`, image: value })}>Preview</button>
        <button className="as-button as-button-quiet" type="button" disabled={!value} onClick={() => setField(sectionId, key, '')}>Remove</button>
      </div>
    </div>;
  }

  function renderNotifications() {
    const data = settings.notifications;
    const setAll = (enabled) => update('notifications', 'events', Object.fromEntries(notificationTypes.map((name) => [name, enabled])));
    return <>
      <Card title="Notification channels" description="SMS is a visual demonstration option only.">
        <div className="as-toggle-list">{Object.entries(data.channels).map(([name, value]) => <Toggle key={name} label={`${name} Notifications`} checked={value} onChange={(checked) => update('notifications', 'channels', { ...data.channels, [name]: checked })} hint={name.includes('SMS') ? 'No messages will be sent.' : ''} />)}</div>
      </Card>
      <Card title="Notification events" description="Choose which sample platform events are enabled.">
        <div className="as-card-actions"><button className="as-button as-button-quiet" type="button" onClick={() => setAll(true)}>Enable all</button><button className="as-button as-button-quiet" type="button" onClick={() => setAll(false)}>Disable all</button></div>
        <div className="as-toggle-list as-toggle-grid">{notificationTypes.map((name) => <Toggle key={name} label={name} checked={data.events[name]} onChange={(checked) => update('notifications', 'events', { ...data.events, [name]: checked })} />)}</div>
      </Card>
    </>;
  }

  function renderRoles() {
    const roles = settings.roles.roles;
    const updateRole = (index, key, value) => update('roles', 'roles', roles.map((role, roleIndex) => roleIndex === index ? { ...role, [key]: value } : role));
    const updatePermission = (index, permission, value) => update('roles', 'roles', roles.map((role, roleIndex) => roleIndex === index ? { ...role, permissions: { ...role.permissions, [permission]: value } } : role));
    return <>
      <Card title="Platform roles" description="Frontend permission previews do not enforce real access control.">
        <div className="as-role-list">{roles.map((role, index) => <article className="as-role-card" key={role.name}>
          <div className="as-role-heading"><div><h3>{role.name}</h3><p>{role.description}</p></div><Toggle label="Role active" checked={role.enabled} disabled={index === 0} onChange={(checked) => updateRole(index, 'enabled', checked)} hint={index === 0 ? 'Administrator access is protected.' : ''} /></div>
          <div className="as-fields as-fields-compact">
            <label className="as-field"><span>Default Dashboard</span><input value={role.dashboard} onChange={(event) => updateRole(index, 'dashboard', event.target.value)} /></label>
            <label className="as-field"><span>Account Activation</span><select value={role.activation} onChange={(event) => updateRole(index, 'activation', event.target.value)}>{selectOptions.activation.map((option) => <option key={option}>{option}</option>)}</select></label>
          </div>
          <label className="as-field"><span>Role Description</span><input value={role.description} onChange={(event) => updateRole(index, 'description', event.target.value)} /></label>
        </article>)}</div>
      </Card>
      <Card title="Permission matrix" description="The last administrator's manage permission cannot be removed in this demo.">
        <div className="as-table-wrap"><table className="as-table"><thead><tr>{roleColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{roles.map((role, index) => <tr key={role.name}><th>{role.name}</th>{permissionNames.map((permission) => <td key={permission}><input type="checkbox" aria-label={`${role.name}: ${permission}`} checked={role.permissions[permission]} disabled={index === 0 && permission === 'Manage'} onChange={(event) => updatePermission(index, permission, event.target.checked)} /></td>)}</tr>)}</tbody></table></div>
      </Card>
    </>;
  }

  function renderLogs() {
    const setFilter = (key, value) => setLogFilters((filters) => ({ ...filters, [key]: value }));
    const users = ['All users', ...new Set(settings.logs.records.map((row) => row.user))];
    const roles = ['All roles', ...new Set(settings.logs.records.map((row) => row.role))];
    const types = ['All activity', ...new Set(settings.logs.records.map((row) => row.type))];
    const statuses = ['All statuses', ...new Set(settings.logs.records.map((row) => row.status))];
    return <Card title="Sample activity" description="These records are generated for this browser demonstration and are not server audit logs.">
      <div className="as-log-filters">
        <label className="as-search"><Search size={16} /><input placeholder="Search logs" value={logFilters.query} onChange={(event) => setFilter('query', event.target.value)} /></label>
        {[['user', users], ['role', roles], ['type', types], ['status', statuses]].map(([key, options]) => <select key={key} aria-label={`Filter by ${key}`} value={logFilters[key]} onChange={(event) => setFilter(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select>)}
        <label>From<input type="date" value={logFilters.from} onChange={(event) => setFilter('from', event.target.value)} /></label>
        <label>To<input type="date" value={logFilters.to} onChange={(event) => setFilter('to', event.target.value)} /></label>
      </div>
      <div className="as-card-actions"><button className="as-button as-button-quiet" type="button" onClick={exportLogs}><ArrowDownToLine size={15} /> Export demonstration logs</button><button className="as-button as-button-danger" type="button" onClick={clearLogs}>Clear demo logs</button></div>
      <div className="as-table-wrap"><table className="as-table"><thead><tr>{['Log ID', 'Activity', 'User', 'Role', 'Action Type', 'Date and Time', 'Status', 'Details'].map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>
        {filteredLogs.map((row) => <tr key={row.id}><td>{row.id}</td><td>{row.activity}</td><td>{row.user}</td><td>{row.role}</td><td>{row.type}</td><td>{new Date(row.date).toLocaleString()}</td><td><span className={`as-status as-status-${row.status.toLowerCase()}`}>{row.status}</span></td><td><button className="as-link-button" type="button" onClick={() => setSelectedLog(row)}>View details</button></td></tr>)}
        {!filteredLogs.length && <tr><td className="as-empty" colSpan="8">No sample logs match these filters.</td></tr>}
      </tbody></table></div>
    </Card>;
  }

  function renderBackups() {
    const history = settings.backup.history;
    const selected = history.find((record) => record.id === (selectedBackup || settings.backup.selectedBackup));
    return <>
      <Card title="Create a demonstration backup" description="Creates a downloadable JSON snapshot of the browser settings only. No database is backed up.">
        <div className="as-inline-actions"><button className="as-button as-button-primary" type="button" onClick={createBackup}><CloudDownload size={16} /> Create demo backup</button>
          <button className="as-button as-button-quiet" type="button" onClick={() => downloadJson('eventhub-demo-settings.json', settings)}>Download current settings</button></div>
      </Card>
      <Card title="Restore a demo backup" description="Restoring replaces the demonstration settings currently in this browser.">
        <div className="as-restore-row"><label className="as-field"><span>Select Demo Backup</span><select value={selectedBackup || settings.backup.selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}><option value="">Choose a backup</option>{history.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
          <button className="as-button as-button-quiet" type="button" disabled={!selected} onClick={() => selected && setPreview({ title: 'Backup details', text: `${selected.name}\nCreated: ${new Date(selected.date).toLocaleString()}\nSize: ${selected.size}\nStatus: ${selected.status}` })}>Preview details</button>
          <button className="as-button as-button-primary" type="button" disabled={!selected} onClick={() => restoreBackup(selected)}>Restore</button>
        </div>
      </Card>
      <Card title="Backup history" description={`${history.length} browser snapshot${history.length === 1 ? '' : 's'}`}>
        <div className="as-table-wrap"><table className="as-table"><thead><tr>{['Backup Name', 'Created Date', 'File Size', 'Status', 'Actions'].map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>
          {history.map((record) => <tr key={record.id}><td>{record.name}</td><td>{new Date(record.date).toLocaleString()}</td><td>{record.size}</td><td>{record.status}</td><td><button className="as-link-button" type="button" onClick={() => downloadJson(`${record.id}.json`, record.snapshot)}>Download</button><button className="as-link-button" type="button" onClick={() => restoreBackup(record)}>Restore</button></td></tr>)}
          {!history.length && <tr><td className="as-empty" colSpan="5">No demo backups created yet.</td></tr>}
        </tbody></table></div>
      </Card>
    </>;
  }

  function renderDocument(sectionId) {
    const title = sectionId === 'terms' ? 'Terms & Conditions' : 'Privacy Policy';
    const contentKey = 'content';
    return <>
      <Card title={`${title} editor`} description="Use the formatting shortcuts or edit the demonstration document text.">
        <div className="as-format-controls"><button className="as-button as-button-quiet" type="button" onClick={() => formatSelection(sectionId, contentKey, '**')}><strong>B</strong> Bold</button><button className="as-button as-button-quiet" type="button" onClick={() => formatSelection(sectionId, contentKey, '*')}><em>I</em> Italic</button><button className="as-button as-button-quiet" type="button" onClick={() => formatSelection(sectionId, contentKey, '\n- ')}>Add list item</button></div>
        <div className="as-fields">{renderFields(sectionId)}</div>
        <div className="as-card-actions"><button className="as-button as-button-quiet" type="button" onClick={() => setPreview({ title: settings[sectionId].title, text: settings[sectionId].content })}>Preview</button><button className="as-button as-button-quiet" type="button" onClick={saveSection}>Save Draft</button><button className="as-button as-button-primary" type="button" onClick={() => {
          if (!validateFields([sectionId])) {
            setError('Add a document title and content before publishing.');
            return;
          }
          const next = { ...settings[sectionId], status: 'Published', updatedAt: new Date().toISOString().slice(0, 10) };
          setSettings((state) => ({ ...state, [sectionId]: next }));
          const snapshot = { ...savedSettings, [sectionId]: next };
          saveSnapshot(snapshot, `${title} published in the demonstration.`);
        }}>Publish Demonstration</button></div>
      </Card>
    </>;
  }

  function renderActiveSection() {
    switch (activeSection) {
      case 'general':
        return <>
          <Card title="Platform identity" description="These values are a local demonstration configuration.">
            {renderFields('general')}
          </Card>
          <Card title="Brand assets" description="Images are stored as browser previews, not uploaded to a server.">
            <div className="as-fields as-asset-grid">{renderImageUpload('general', 'logo', 'Platform Logo')}{renderImageUpload('general', 'favicon', 'Favicon')}</div>
          </Card>
        </>;
      case 'platform':
        return <Card title="Organization details" description="Platform ownership and support information.">{renderFields('platform')}</Card>;
      case 'appearance':
        {
          const previewDark = settings.appearance.theme === 'Dark' ||
            (settings.appearance.theme === 'System' && window.matchMedia('(prefers-color-scheme: dark)').matches);
          const previewSidebarLight = settings.appearance.sidebarAppearance === 'Light';
          const previewSidebarColor = settings.appearance.sidebarAppearance === 'Colored'
            ? settings.appearance.primaryColor
            : previewSidebarLight ? '#f8fafc' : settings.appearance.secondaryColor;
        return <>
          <Card title="Appearance preferences" description="Changes immediately update the preview beside this form.">{renderFields('appearance')}</Card>
          <Card title="Theme preview" description="Preview only; this does not change other application screens.">
            <div className={`as-theme-preview ${settings.appearance.dashboardLayout.toLowerCase()} ${settings.appearance.cardStyle.toLowerCase()}`} style={{ '--preview-primary': settings.appearance.primaryColor, '--preview-secondary': settings.appearance.secondaryColor, '--preview-accent': settings.appearance.accentColor, '--preview-bg': previewDark ? '#172033' : settings.appearance.backgroundColor, '--preview-text': previewDark ? '#f3f5fa' : settings.appearance.textColor, '--preview-surface': previewDark ? '#26344c' : '#fff', '--preview-sidebar': previewSidebarColor, '--preview-sidebar-text': previewSidebarLight ? '#344158' : '#fff', '--preview-radius': `${settings.appearance.borderRadius}px`, fontFamily: settings.appearance.fontFamily }}>
              <div className="as-preview-sidebar"><img className="as-preview-logo" src={settings.general.logo || '/eventhub-logo.png'} alt="Platform logo preview" /><span>Dashboard</span><span>Bookings</span><span>Settings</span></div>
              <div className="as-preview-main"><span className="as-preview-chip">Live preview</span><h3>Good morning, Admin</h3><p>Your event platform at a glance.</p><div className="as-preview-metric"><strong>128</strong><span>Active bookings</span></div><button type="button" onClick={() => setPreview({ title: 'Theme preview', text: 'Your appearance settings are shown in this preview only.' })}>Preview Theme</button></div>
            </div>
          </Card>
        </>;
        }
      case 'localization':
        return <>
          <Card title="Regional defaults" description="English and Amharic are available in this demonstration.">{renderFields('localization')}</Card>
          <Card title="Available languages"><div className="as-toggle-list">{['English', 'Amharic'].map((language) => <Toggle key={language} label={language === 'Amharic' ? 'Amharic (አማርኛ)' : language} checked={settings.localization.availableLanguages.includes(language)} onChange={(checked) => update('localization', 'availableLanguages', checked ? [...settings.localization.availableLanguages, language] : settings.localization.availableLanguages.filter((item) => item !== language))} />)}</div></Card>
        </>;
      case 'email':
        return <>
          <Card title="Sender and SMTP demonstration" description="Never enter real SMTP credentials. No email will be sent.">{renderFields('email')}{renderToggles('email')}
            <div className="as-notice"><CircleHelp size={17} />Email tests only change a local status indicator; no message or network request is created.</div>
            <div className="as-card-actions"><button className="as-button as-button-quiet" type="button" onClick={() => {
              if (!validateFields(['email'])) {
                setError('Review the highlighted email settings before running the local demonstration test.');
                return;
              }
              update('email', 'testStatus', 'Test passed (demo)');
            }}>Test Email Configuration</button><span className="as-status as-status-info">{settings.email.testStatus}</span></div>
          </Card>
        </>;
      case 'notifications': return renderNotifications();
      case 'payments':
        return <>
          <Card title="Payment configuration preview" description="No gateway integration, payment collection, or real transaction is performed.">{renderFields('payments')}{renderToggles('payments')}</Card>
          <Card title="Demonstration payment methods"><div className="as-toggle-list">{Object.entries(settings.payments.methods).map(([name, value]) => <Toggle key={name} label={name} checked={value} onChange={(checked) => update('payments', 'methods', { ...settings.payments.methods, [name]: checked })} />)}</div></Card>
          <Card title="Payment status configuration"><div className="as-chip-list">{settings.payments.statuses.map((status) => <span className="as-chip" key={status}>{status}</span>)}</div></Card>
        </>;
      case 'bookings':
        return <>
          <Card title="Booking workflow" description="Preferences apply only to this browser demonstration.">{renderFields('bookings')}{renderToggles('bookings')}</Card>
          <Card title="Booking statuses"><div className="as-chip-list">{settings.bookings.statuses.map((status) => <span className="as-chip" key={status}>{status}</span>)}</div></Card>
        </>;
      case 'roles': return renderRoles();
      case 'security':
        return <>
          <Card title="Password and session preferences" description="These interface settings do not enforce authentication security.">{renderFields('security')}{renderToggles('security')}</Card>
          <Card title="Active sessions demonstration"><p className="as-muted-copy">No server sessions are read. This sample panel illustrates where session information could appear.</p><div className="as-session-row"><span className="as-status as-status-success">Current browser</span><span>Demonstration session</span><span>Active now</span></div></Card>
        </>;
      case 'privacy':
        return <>
          <Card title="Privacy preferences" description="These values are stored locally and do not update a public policy.">{renderFields('privacy', [['privacyConfiguration', 'Privacy Policy Configuration', 'textarea'], ['termsConfiguration', 'Terms and Conditions Configuration', 'textarea'], ['dataCollection', 'Data Collection Preferences'], ['dataExport', 'Data Export Information', 'textarea'], ['accountDeletion', 'Account Deletion Policy', 'textarea']])}{renderToggles('privacy')}</Card>
          <Card title="Privacy preview"><button className="as-button as-button-quiet" type="button" onClick={() => setPreview({ title: 'Privacy configuration preview', text: `${settings.privacy.privacyConfiguration}\n\n${settings.privacy.dataExport}\n\n${settings.privacy.accountDeletion}` })}>Preview privacy configuration</button></Card>
        </>;
      case 'media':
        return <>
          <Card title="Upload preferences" description="Limits are previews only; no file is uploaded to a server.">{renderFields('media')}{renderToggles('media')}</Card>
          <Card title="Default image previews"><div className="as-fields as-asset-grid">{renderImageUpload('media', 'defaultProfileImage', 'Default Profile Image')}{renderImageUpload('media', 'defaultEventImage', 'Default Event Image')}{renderImageUpload('media', 'defaultVendorImage', 'Default Vendor Image')}</div></Card>
        </>;
      case 'maintenance':
        return <>
          {settings.maintenance.enabled && <div className="as-maintenance-preview"><strong>Maintenance mode preview enabled</strong><span>The simulated maintenance state is visible only here; the platform remains online.</span></div>}
          <Card title="Maintenance page" description="Enabling this setting only displays a local preview; it does not affect the live site.">{renderToggles('maintenance')}{renderFields('maintenance')}{renderImageUpload('maintenance', 'illustration', 'Maintenance Illustration')}
            <div className="as-card-actions"><button className="as-button as-button-quiet" type="button" onClick={() => setPreview({ title: settings.maintenance.title, text: settings.maintenance.message, image: settings.maintenance.illustration })}>Show Maintenance Page Preview</button></div>
          </Card>
        </>;
      case 'backup': return renderBackups();
      case 'social':
        return <>
          <Card title="Social profiles" description="Links are previews only; they are not added to public pages.">{renderToggles('social')}{renderFields('social')}</Card>
          <Card title="Live link preview"><div className="as-social-preview">{settings.social.enabled ? Object.entries(settings.social).filter(([key, value]) => key !== 'enabled' && safeHttpUrl(value)).map(([name, value]) => <a key={name} href={safeHttpUrl(value)} target="_blank" rel="noreferrer">{name}<span>{value}</span></a>) : <p>Social links are currently disabled.</p>}</div></Card>
        </>;
      case 'contact':
        return <>
          <Card title="Contact details" description="Preview how public support information could be displayed.">{renderFields('contact')}</Card>
          <Card title="Contact preview"><div className="as-contact-preview"><strong>{settings.contact.organizationName}</strong><span>{settings.contact.address}, {settings.contact.city}, {settings.contact.country}</span><a href={`mailto:${settings.contact.email}`}>{settings.contact.email}</a><span>{settings.contact.phone}{settings.contact.alternativePhone ? ` · ${settings.contact.alternativePhone}` : ''}</span><span>{settings.contact.businessHours}</span><span>{settings.contact.availability}</span></div>{safeHttpUrl(settings.contact.mapsUrl) && <a className="as-link-button" href={safeHttpUrl(settings.contact.mapsUrl)} target="_blank" rel="noreferrer">Open map preview</a>}</Card>
        </>;
      case 'terms': case 'policy': return renderDocument(activeSection);
      case 'logs': return renderLogs();
      default: return null;
    }
  }

  return <section className="page admin-system-settings">
    <header className="as-page-header">
      <div><div className="as-breadcrumb"><span>{translate('nav.dashboard.groupOverview', language)}</span><span>/</span><strong>{translate('nav.dashboard.systemSettings', language)}</strong></div><h1>System Settings</h1><p>Manage and configure your event management platform.</p></div>
      <div className="as-header-actions"><button className="as-button as-button-quiet" type="button" onClick={resetAll}><RotateCcw size={15} /> Reset to Default</button><button className="as-button as-button-primary" type="button" onClick={saveAll} disabled={!dirty}><Save size={15} /> Save All Settings</button></div>
    </header>
    <div className="as-statusline"><span className={dirty ? 'as-dirty-indicator' : 'as-clean-indicator'}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span><span>Last saved: {lastSaved ? new Date(lastSaved).toLocaleString() : 'Not saved yet'}</span><span className="as-demo-note">Browser demonstration only</span></div>
    {error && <div className="as-alert as-alert-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
    {toast && <div className="as-alert as-alert-success" role="status"><Check size={16} />{toast}<button type="button" onClick={() => setToast('')} aria-label="Dismiss notice"><X size={15} /></button></div>}
    <div className="as-settings-layout">
      <aside className="as-settings-nav">
        <label className="as-search"><Search size={16} /><input placeholder="Search settings" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <nav aria-label={translate('nav.dashboard.sections', language)}>{visibleSections.map((item) => {
          const Icon = sectionIcons[item.id] || SlidersHorizontal;
          return <button key={item.id} type="button" className={`as-nav-item ${activeSection === item.id ? 'active' : ''}`} onClick={() => { setActiveSection(item.id); setError(''); setToast(''); }}><Icon size={16} /><span>{translate(item.translationKey, language)}</span>{JSON.stringify(settings[item.id]) !== JSON.stringify(savedSettings[item.id]) && <i aria-label="Unsaved changes" />}</button>;
        })}{visibleSections.length === 0 && <p className="as-nav-empty">No settings sections found.</p>}</nav>
      </aside>
      <main className="as-settings-main">
        <div className="as-section-heading"><div><span className="as-section-kicker">CONFIGURATION</span><h2>{section.label}</h2><p>{section.description}</p></div><div className="as-section-actions"><button className="as-button as-button-quiet" type="button" onClick={resetSection}><RotateCcw size={14} /> Reset Changes</button><button className="as-button as-button-primary" type="button" onClick={saveSection} disabled={!sectionDirty}><Save size={14} /> Save Changes</button></div></div>
        {renderActiveSection()}
      </main>
    </div>
    {confirm && <div className="as-modal-backdrop" role="presentation"><section className="as-modal" role="dialog" aria-modal="true" aria-labelledby="as-confirm-title"><button className="as-modal-close" type="button" aria-label="Close dialog" onClick={() => setConfirm(null)}><X size={18} /></button><h2 id="as-confirm-title">{confirm.title}</h2><p>{confirm.message}</p><div className="as-modal-actions"><button className="as-button as-button-quiet" type="button" onClick={() => setConfirm(null)}>Cancel</button><button className={`as-button ${confirm.danger ? 'as-button-danger' : 'as-button-primary'}`} type="button" onClick={confirm.onConfirm}>{confirm.confirmLabel}</button></div></section></div>}
    {(preview || selectedLog) && <div className="as-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPreview(null); setSelectedLog(null); } }}><section className="as-modal as-preview-modal" role="dialog" aria-modal="true" aria-labelledby="as-preview-title"><button className="as-modal-close" type="button" aria-label="Close preview" onClick={() => { setPreview(null); setSelectedLog(null); }}><X size={18} /></button><h2 id="as-preview-title">{selectedLog ? `Log ${selectedLog.id}` : preview?.title}</h2>{selectedLog ? <dl className="as-log-details">{Object.entries(selectedLog).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{key === 'date' ? new Date(value).toLocaleString() : value}</dd></div>)}</dl> : preview?.image ? <img className="as-modal-image" src={preview.image} alt="" /> : null}{preview?.text && <pre>{preview.text}</pre>}</section></div>}
  </section>;
}
