export const DEMO_ACCOUNT_STORAGE_KEY = 'eventhub-demo-accounts';
export const DEMO_SESSION_STORAGE_KEY = 'eventhub-demo-session';

export const DEMO_LOGIN_CREDENTIALS = [
  { username: 'admin', email: 'admin@demo.eventhub', password: 'AdminDemo123', name: 'Demo Administrator', role: 'admin' },
  { username: 'customer', email: 'customer@demo.eventhub', password: 'CustomerDemo12', name: 'Demo Customer', role: 'customer' },
  { username: 'organizer', email: 'organizer@demo.eventhub', password: 'Organizer12Ab', name: 'Demo Organizer', role: 'organizer' },
  { username: 'vendor', email: 'vendor@demo.eventhub', password: 'VendorDemo12', name: 'Demo Vendor', role: 'vendor' },
];

const DEMO_ROLES = new Set(['admin', 'customer', 'organizer', 'vendor']);

export function isValidDemoPassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && password.length <= 16
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password);
}

export function normalizeDemoProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  const role = typeof profile.role === 'string' ? profile.role.trim().toLowerCase() : '';
  if (!name || !email || !DEMO_ROLES.has(role)) return null;
  return { name, email, role };
}

function getStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('Demo storage is unavailable in this browser.');
  }
  return storage;
}

function readAccounts(storage) {
  const value = getStorage(storage).getItem(DEMO_ACCOUNT_STORAGE_KEY);
  if (value === null) return [];
  let accounts;
  try {
    accounts = JSON.parse(value);
  } catch {
    throw new Error('Saved demo account data is invalid. Clear the EventHub demo data and try again.');
  }
  if (!Array.isArray(accounts) || accounts.some((account) => !normalizeDemoProfile(account))) {
    throw new Error('Saved demo account data is invalid. Clear the EventHub demo data and try again.');
  }
  return accounts.map(normalizeDemoProfile);
}

export function saveDemoAccount(profile, storage = globalThis.localStorage) {
  const normalized = normalizeDemoProfile(profile);
  if (!normalized) throw new Error('Enter a valid name, email, and account type.');
  const targetStorage = getStorage(storage);
  const accounts = readAccounts(targetStorage);
  if (accounts.some((account) => account.email === normalized.email)) {
    throw new Error('A demo account with this email already exists.');
  }
  targetStorage.setItem(DEMO_ACCOUNT_STORAGE_KEY, JSON.stringify([...accounts, normalized]));
  return normalized;
}

export function saveDemoSession(profile, storage = globalThis.localStorage) {
  const normalized = normalizeDemoProfile(profile);
  if (!normalized) throw new Error('The demo account profile is invalid.');
  getStorage(storage).setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readDemoSession(storage = globalThis.localStorage) {
  const value = getStorage(storage).getItem(DEMO_SESSION_STORAGE_KEY);
  if (value === null) return null;
  let profile;
  try {
    profile = JSON.parse(value);
  } catch {
    throw new Error('Saved demo session data is invalid. Sign in again.');
  }
  const normalized = normalizeDemoProfile(profile);
  if (!normalized) throw new Error('Saved demo session data is invalid. Sign in again.');
  return normalized;
}

export function clearDemoSession(storage = globalThis.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') {
    throw new Error('Demo storage is unavailable in this browser.');
  }
  storage.removeItem(DEMO_SESSION_STORAGE_KEY);
}

export function findDemoLogin(emailOrUsername, password) {
  const identifier = typeof emailOrUsername === 'string' ? emailOrUsername.trim().toLowerCase() : '';
  return DEMO_LOGIN_CREDENTIALS.find((credential) =>
    (credential.email === identifier || credential.username === identifier) && credential.password === password
  ) || null;
}
