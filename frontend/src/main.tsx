import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import InstallPrompt from './components/InstallPrompt';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// ─── Global error handlers ──────────────────────────────────────────────────
// Catch unhandled promise rejections (e.g. chunk load failures outside React tree)
// and uncaught errors that escape ErrorBoundary.
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason);
  const isChunkError =
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module');

  if (isChunkError) {
    event.preventDefault();
    const reloadKey = 'global_chunk_reload';
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, Date.now().toString());
      window.location.reload();
    }
  }
});

// Clear chunk reload guards on successful page load so future errors can trigger reload
window.addEventListener('load', () => {
  sessionStorage.removeItem('eb_chunk_reload');
  sessionStorage.removeItem('lazy_chunk_reload');
  sessionStorage.removeItem('global_chunk_reload');
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Data considered fresh for 2 minutes — no refetch during this window.
      // Individual queries can override with shorter staleTime where real-time data matters.
      staleTime: 2 * 60_000,
      // Keep unused data in memory for 10 minutes (reduces re-fetches on back-navigation)
      gcTime: 10 * 60_000,
      // Show stale data instantly while refetching in the background
      refetchOnMount: 'always',
      // On reconnect after offline, refresh stale queries
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
            <InstallPrompt />
            <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
