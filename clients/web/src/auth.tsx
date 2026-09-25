import type { AuthResult, LoginInput, Me, Permission, Preferences, RegisterInput } from '@ovl/shared';
import { applyTheme, getThemePreference, passkeyAssertion, syncLocale } from '@ovl/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { accounts, type StoredAccount } from './accounts';
import { api } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** All accounts signed in on this device. */
  accounts: StoredAccount[];
  /** True while the user is adding another account (the sign-in screen shows over the app). */
  addingAccount: boolean;
  startAddAccount: () => void;
  cancelAddAccount: () => void;
  login: (input: LoginInput) => Promise<Me>;
  /** Sign in with a passkey saved on this device or in a password manager. */
  loginWithPasskey: () => Promise<Me>;
  register: (input: RegisterInput) => Promise<Me>;
  switchAccount: (id: string) => void;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  updatePreferences: (patch: Preferences) => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** The provider sits outside the router; the app uses hash routing, so set the hash directly. */
function startAtHome() {
  window.location.hash = '#/home';
}

function useAccounts(): StoredAccount[] {
  const snapshot = useSyncExternalStore(
    (cb) => accounts.subscribe(cb),
    () => JSON.stringify(accounts.list().map((a) => [a.id, a.displayName, a.avatarUrl, a.theme])),
  );
  // The snapshot string changes whenever the list does; re-read the list then.
  return useMemo(() => (snapshot ? accounts.list() : []), [snapshot]);
}

/** Apply the account's synced theme and language unless this device already shows them. */
function syncTheme(theme: string | undefined, locale?: string) {
  if (theme && theme !== getThemePreference()) applyTheme(theme);
  syncLocale(locale);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingAccount, setAddingAccount] = useState(false);
  const [activeId, setActiveId] = useState(() => accounts.active()?.id ?? null);
  const list = useAccounts();
  const queryClient = useQueryClient();

  const reload = useCallback(async () => {
    if (!accounts.active()) {
      setMe(null);
      return;
    }
    try {
      const user = await api.me.get();
      accounts.updateProfile(user);
      syncTheme(user.preferences.theme, user.preferences.locale);
      setMe(user);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload, activeId]);

  useEffect(() => {
    const onSignedOut = () => {
      setMe(null);
      setActiveId(null);
      queryClient.clear();
    };
    window.addEventListener('ovl:signed-out', onSignedOut);
    return () => window.removeEventListener('ovl:signed-out', onSignedOut);
  }, [queryClient]);

  const finishSignIn = useCallback(
    (result: AuthResult) => {
      // Adding a second account switches identity: start it on its home screen. A first
      // sign-in keeps the current URL so deep links survive the login screen.
      const previous = accounts.active();
      if (previous && previous.id !== result.user.id) startAtHome();
      accounts.signIn(result.user, { accessToken: result.accessToken, refreshToken: result.refreshToken });
      queryClient.clear();
      syncTheme(result.user.preferences.theme, result.user.preferences.locale);
      setAddingAccount(false);
      setActiveId(result.user.id);
      setMe(result.user);
      return result.user;
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      accounts: list,
      addingAccount,
      startAddAccount: () => setAddingAccount(true),
      cancelAddAccount: () => setAddingAccount(false),
      reload,
      login: async (input) => finishSignIn(await api.request<AuthResult>('POST', '/auth/login', input)),
      loginWithPasskey: async () =>
        finishSignIn(await api.request<AuthResult>('POST', '/auth/passkey', await passkeyAssertion(api))),
      register: async (input) => finishSignIn(await api.request<AuthResult>('POST', '/auth/register', input)),
      switchAccount: (id) => {
        if (id === accounts.active()?.id) return;
        startAtHome();
        queryClient.clear();
        accounts.setActive(id);
        setAddingAccount(false);
        setLoading(true);
        setMe(null);
        setActiveId(id);
      },
      logout: async () => {
        await api.auth.logout();
        queryClient.clear();
        setMe(null);
        // Continue with another signed-in account if there is one.
        const next = accounts.list()[0];
        if (next) {
          accounts.setActive(next.id);
          startAtHome();
          setLoading(true);
        }
        setActiveId(next?.id ?? null);
      },
      updatePreferences: async (patch) => {
        setMe(await api.me.updatePreferences(patch));
      },
      can: (permission) => !!me?.permissions.includes(permission),
    }),
    [me, loading, list, addingAccount, reload, finishSignIn, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

const MeContext = createContext<Me | null>(null);

/**
 * Pins the signed-in user for an authenticated screen. A screen that is animating out after
 * a sign-out or an account switch keeps the user it was rendered with.
 */
export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** The signed-in user (only use below the authenticated shell). */
export function useMe(): Me {
  const pinned = useContext(MeContext);
  const { me } = useAuth();
  const user = pinned ?? me;
  if (!user) throw new Error('Not signed in');
  return user;
}
