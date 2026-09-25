import { OvlClient, type TokenStore } from '@ovl/sdk';
import { getLocale } from '@ovl/ui';
import { accounts } from './accounts';
import { apiUrl } from './config';

/** The SDK always talks as the active account. */
const activeAccountTokens: TokenStore = {
  get: () => accounts.active()?.tokens ?? null,
  set: (tokens) => accounts.setActiveTokens(tokens),
};

export const api = new OvlClient({
  baseUrl: apiUrl(),
  tokenStore: activeAccountTokens,
  onSignedOut: () => window.dispatchEvent(new Event('ovl:signed-out')),
  locale: getLocale,
});
