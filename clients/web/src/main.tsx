import '@ovl/ui/styles.css';
import './app.css';
import { registerCurrencies } from '@ovl/shared';
import { applyTheme, getThemePreference, ToastProvider, watchSystemTheme } from '@ovl/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { api } from './api';
import { App } from './App';
import { AuthProvider } from './auth';
import { RealtimeProvider } from './realtime';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

applyTheme(getThemePreference());
watchSystemTheme();

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
            <AuthProvider>
              <RealtimeProvider>
                <HashRouter>
                  <App />
                </HashRouter>
              </RealtimeProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </MotionConfig>
    </StrictMode>,
  ),
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
