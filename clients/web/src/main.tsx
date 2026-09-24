import '@ovl/ui/styles.css';
import './app.css';
import { applyTheme, getThemePreference, ToastProvider, watchSystemTheme } from '@ovl/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { RealtimeProvider } from './realtime';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

applyTheme(getThemePreference());
watchSystemTheme();

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
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
