import type { Tokens } from '@ovl/sdk';
import type { Badge, Me, Role } from '@ovl/shared';

/**
 * Multi-account: several signed-in accounts on one device, one of them active.
 * Everything lives in localStorage; each account keeps its own refresh token.
 */
export interface StoredAccount {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  badges: Badge[];
  theme?: string;
  tokens: Tokens;
  addedAt: number;
}

const ACCOUNTS_KEY = 'ovl.accounts';
const ACTIVE_KEY = 'ovl.activeAccount';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

type Listener = () => void;

class AccountStore {
  private accounts: StoredAccount[] = read<StoredAccount[]>(ACCOUNTS_KEY, []);
  private activeId: string | null = read<string | null>(ACTIVE_KEY, null);
  private readonly listeners = new Set<Listener>();

  constructor() {
    if (this.activeId && !this.accounts.some((a) => a.id === this.activeId)) this.activeId = null;
    // Other tabs rotate tokens too: pick up their changes so a refresh race never signs us out.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== ACCOUNTS_KEY) return;
        this.accounts = read<StoredAccount[]>(ACCOUNTS_KEY, []);
        if (this.activeId && !this.accounts.some((a) => a.id === this.activeId)) this.activeId = null;
        for (const l of this.listeners) l();
      });
    }
  }

  private save(): void {
    write(ACCOUNTS_KEY, this.accounts);
    write(ACTIVE_KEY, this.activeId);
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): StoredAccount[] {
    return [...this.accounts].sort((a, b) => a.addedAt - b.addedAt);
  }

  active(): StoredAccount | null {
    return this.accounts.find((a) => a.id === this.activeId) ?? null;
  }

  setActive(id: string | null): void {
    this.activeId = id;
    this.save();
  }

  /** Add or refresh an account from a fresh sign-in and make it active. */
  signIn(user: Me, tokens: Tokens): void {
    const existing = this.accounts.find((a) => a.id === user.id);
    const account: StoredAccount = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      badges: user.badges,
      theme: user.preferences.theme,
      tokens,
      addedAt: existing?.addedAt ?? Date.now(),
    };
    this.accounts = [...this.accounts.filter((a) => a.id !== user.id), account];
    this.activeId = user.id;
    this.save();
  }

  /** Keep the cached profile of the active account fresh (name, avatar, theme). */
  updateProfile(user: Me): void {
    const account = this.accounts.find((a) => a.id === user.id);
    if (!account) return;
    Object.assign(account, {
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      badges: user.badges,
      theme: user.preferences.theme,
    });
    this.save();
  }

  setActiveTokens(tokens: Tokens | null): void {
    const account = this.active();
    if (!account) return;
    if (tokens) {
      account.tokens = tokens;
      this.save();
    } else {
      this.remove(account.id);
    }
  }

  /** Forget an account; if it was active, nothing is active afterwards. */
  remove(id: string): void {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    if (this.activeId === id) this.activeId = null;
    this.save();
  }
}

export const accounts = new AccountStore();
