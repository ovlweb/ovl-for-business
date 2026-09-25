import type { Me, Permission } from '@ovl/shared';
import { signInWithPasskey } from '@ovl/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface AdminAuth {
  me: Me | null;
  loading: boolean;
  login: (login: string, password: string, code?: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
  /** Why the last single sign-on did not work, if it did not. */
  ssoError: unknown;
  /** Load the account again (after turning on two-step verification). */
  reload: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const Ctx = createContext<AdminAuth | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ssoError, setSsoError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    // Coming back from the single sign-on provider: ?code=…&state=… on the admin URL.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (code && state) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      try {
        await api.auth.ssoCallback(code, state);
      } catch (error) {
        setSsoError(error);
      }
    }
    if (!api.isSignedIn) return setMe(null);
    try {
      const user = await api.me.get();
      setMe(user.permissions.includes('admin.panel') ? user : null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const out = () => {
      setMe(null);
      queryClient.clear();
    };
    window.addEventListener('ovl:signed-out', out);
    return () => window.removeEventListener('ovl:signed-out', out);
  }, [load, queryClient]);

  const value: AdminAuth = {
    me,
    loading,
    login: async (login, password, code) => {
      const user = await api.auth.login({ login, password, code });
      if (!user.permissions.includes('admin.panel')) {
        await api.auth.logout();
        throw new Error('This account has no access to the admin panel.');
      }
      setMe(user);
    },
    loginWithPasskey: async () => {
      const user = await signInWithPasskey(api);
      if (!user.permissions.includes('admin.panel')) {
        await api.auth.logout();
        throw new Error('This account has no access to the admin panel.');
      }
      setMe(user);
    },
    logout: async () => {
      await api.auth.logout();
      queryClient.clear();
      setMe(null);
    },
    reload: load,
    ssoError,
    can: (p) => !!me?.permissions.includes(p),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminAuth & { me: Me } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdmin outside provider');
  return ctx as AdminAuth & { me: Me };
}

export function useAdminAuth(): AdminAuth {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminAuth outside provider');
  return ctx;
}
