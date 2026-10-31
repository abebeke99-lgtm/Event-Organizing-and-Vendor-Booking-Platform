import { useSyncExternalStore } from 'react';

function readSavedTheme() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('eventhub-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let theme = readSavedTheme();
const listeners = new Set();

function applyTheme(nextTheme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = nextTheme;
}

applyTheme(theme);

export function getTheme() {
  return theme;
}

export function setTheme(nextTheme) {
  if (nextTheme !== 'light' && nextTheme !== 'dark') return;
  theme = nextTheme;
  applyTheme(theme);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('eventhub-theme', theme);
    } catch {
      // Keep the in-session theme switch functional when storage is blocked.
    }
  }
  listeners.forEach((listener) => listener());
}

export function subscribeToTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  return useSyncExternalStore(subscribeToTheme, getTheme, () => 'light');
}
