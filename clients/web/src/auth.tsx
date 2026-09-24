import type { LoginInput, Me, Permission, RegisterInput } from '@ovl/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const reload = useCallback(async () => {
    if (!api.isSignedIn) {
      setMe(null);
      return;
    }
    try {
      setMe(await api.me.get());
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
    const onSignedOut = () => {
      setMe(null);
      queryClient.clear();
    };
    window.addEventListener('ovl:signed-out', onSignedOut);
    return () => window.removeEventListener('ovl:signed-out', onSignedOut);
  }, [reload, queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      reload,
      login: async (input) => setMe(await api.auth.login(input)),
      register: async (input) => setMe(await api.auth.register(input)),
      logout: async () => {
        await api.auth.logout();
        queryClient.clear();
        setMe(null);
      },
      can: (permission) => !!me?.permissions.includes(permission),
    }),
    [me, loading, reload, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in user (only use below the authenticated shell). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Not signed in');
  return me;
}
