import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import toast, { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setupPersistence } from './utils/persistentCache';
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

// ─── Safety net: detect stuck body.overflow ──────────────────────────────────
// If body.style.overflow is 'hidden' but no modal overlay exists in the DOM,
// the modal's cleanup failed (e.g., navigated away while modal was open).
// This causes a "white screen" where nothing is scrollable or clickable.
setInterval(() => {
  if (
    document.body.style.overflow === 'hidden' &&
    !document.querySelector('.fixed.inset-0.z-50') // Modal overlay
  ) {
    document.body.style.overflow = '';
  }
}, 2000);

// ─── Глобальная видимость ошибок мутаций ────────────────────────────────────
// Часть мутаций в проекте не имеет собственного onError — раньше их ошибка
// умирала молча: пользователь думал, что запись сохранена, а связи не было.
// mutationCache.onError вызывается для КАЖДОЙ мутации (в отличие от
// defaultOptions.mutations.onError, который перекрывается локальным onError),
// поэтому анти-дубль: тост показываем ТОЛЬКО когда у мутации нет своего
// onError (локальные обработчики сами показывают toast/alert) и нет
// meta.silentError (осознанный opt-out для best-effort мутаций).
function describeMutationError(error: unknown): string {
  const err = error as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const serverMsg = err?.response?.data?.message;
  const msg = Array.isArray(serverMsg) ? serverMsg[0] : serverMsg;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (!err?.response) return 'нет соединения с сервером. Проверьте интернет и повторите';
  return 'ошибка сервера. Повторите попытку';
}

const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.options.onError) return; // локальный обработчик сам покажет ошибку
    if (mutation.meta?.silentError) return;
    // SW-офлайн-очередь отвечает 202 {queued:true} — это «поставлено в
    // очередь», НЕ ошибка. Axios резолвит 2xx как успех, так что сюда 202 не
    // попадает; guard — защита от будущих обёрток, бросающих не-2xx-подобное.
    const response = (error as { response?: { status?: number; data?: { queued?: boolean } } })?.response;
    if (response?.status === 202 && response?.data?.queued === true) return;
    toast.error(`Не сохранено: ${describeMutationError(error)}`, { duration: 5000 });
  },
});

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 2 * 60_000,
      // Longer gcTime so a tab switch / brief navigation doesn't drop the
      // cache — combined with persistence below it means data is essentially
      // never gone until staleTime expires.
      gcTime: 30 * 60_000,
      refetchOnMount: true,
      refetchOnReconnect: false,
      // Global stale-while-revalidate: when a queryKey changes (paging,
      // search, filters) keep the previous result on screen until the new
      // one arrives. Eliminates the blank-list flash on every list page.
      placeholderData: (prev: unknown) => prev,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Restore previously persisted query results from IndexedDB. Runs before the
// first paint so screens with cached data render instantly on cold start.
// Failures are silent — the app falls back to fetching everything fresh.
try {
  setupPersistence(queryClient);
} catch (err) {
  console.warn('Persistent cache setup failed:', err);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
            <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
