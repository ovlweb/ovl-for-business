import '@ovl/ui/styles.css';
import './admin.css';
import { applyTheme, getThemePreference, ToastProvider, watchSystemTheme } from '@ovl/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AdminAuthProvider } from './auth';
import { DEFAULT_ADMIN_THEME } from './theme';

applyTheme(getThemePreference(DEFAULT_ADMIN_THEME), { persist: false });
watchSystemTheme(DEFAULT_ADMIN_THEME);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });

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
);
