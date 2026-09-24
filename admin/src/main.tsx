import '@ovl/ui/styles.css';
import './admin.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AdminAuthProvider } from './auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AdminAuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
