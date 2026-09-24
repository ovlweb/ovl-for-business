import { OvlClient, type TokenStore, type Tokens } from '@ovl/sdk';
import { apiUrl } from './config';

const TOKENS_KEY = 'ovl.tokens';

class LocalTokenStore implements TokenStore {
  get(): Tokens | null {
    try {
      const raw = localStorage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  }
  set(tokens: Tokens | null): void {
    try {
      if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
      else localStorage.removeItem(TOKENS_KEY);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  }
}

export const api = new OvlClient({
  baseUrl: apiUrl(),
  tokenStore: new LocalTokenStore(),
  onSignedOut: () => window.dispatchEvent(new Event('ovl:signed-out')),
});
