import { OvlClient, type TokenStore, type Tokens } from '@ovl/sdk';

declare global {
  interface Window {
    __OVL_CONFIG__?: { apiUrl?: string };
  }
}

// The admin panel keeps its own session, separate from the client app.
const KEY = 'ovl.admin.tokens';

const store: TokenStore = {
  get(): Tokens | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  set(tokens) {
    try {
      if (tokens) sessionStorage.setItem(KEY, JSON.stringify(tokens));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};

export const api = new OvlClient({
  baseUrl: window.__OVL_CONFIG__?.apiUrl || import.meta.env.VITE_API_URL || '',
  tokenStore: store,
  onSignedOut: () => window.dispatchEvent(new Event('ovl:signed-out')),
});
