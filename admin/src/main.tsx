import '@ovl/ui/styles.css';
import './admin.css';
import { registerCurrencies } from '@ovl/shared';
import { applyTheme, getThemePreference, ToastProvider, watchSystemTheme } from '@ovl/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { api } from './api';
import { App } from './App';
import { AdminAuthProvider } from './auth';
import { DEFAULT_ADMIN_THEME } from './theme';

applyTheme(getThemePreference(DEFAULT_ADMIN_THEME), { persist: false });
watchSystemTheme(DEFAULT_ADMIN_THEME);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });

// Currencies issued by virtual countries are not in the built-in list: learn them before the
// first render (without waiting long for a slow network).
const currencies = Promise.race([
  api.currencies().then((list) => registerCurrencies(list.filter((c) => c.virtual))),
  new Promise((resolve) => setTimeout(resolve, 2500)),
]).catch(() => undefined);

void currencies.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AdminAuthProvider>
              <HashRouter>
                <App />
              </HashRouter>
            </AdminAuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </MotionConfig>
    </StrictMode>,
  ),
);
