declare global {
  interface Window {
    __OVL_CONFIG__?: { apiUrl?: string };
  }
}

const SERVER_KEY = 'ovl.server';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * API origin, in priority order:
 * 1. a server chosen on the sign-in screen (self-hosted deployments, native apps),
 * 2. runtime config.js (Docker image),
 * 3. VITE_API_URL at build time (mobile / desktop release builds),
 * 4. same origin.
 */
export function apiUrl(): string {
  return read(SERVER_KEY) || window.__OVL_CONFIG__?.apiUrl || import.meta.env.VITE_API_URL || '';
}

export function customServer(): string | null {
  return read(SERVER_KEY);
}

export function setCustomServer(url: string | null): void {
  try {
    if (url) localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Running inside the Capacitor (Android/iOS) or Tauri (desktop) shell. */
export const isNativeShell =
  /^(capacitor|tauri|ionic|file):$/.test(location.protocol) || location.hostname === 'tauri.localhost';
