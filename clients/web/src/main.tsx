import '@ovl/ui/styles.css';
import './app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { isNativeShell } from './config';
import { RealtimeProvider } from './realtime';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

try {
  const theme = localStorage.getItem('ovl.theme');
  if (theme) document.documentElement.dataset.theme = theme;
} catch {
  /* ignore */
}

// Hash routing works identically on the web, in Capacitor (Android/iOS) and in Tauri (desktop).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
