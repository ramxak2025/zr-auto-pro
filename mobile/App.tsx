import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { colors } from './src/theme';
import { hydrateCache, attachPersistence } from './src/utils/persistentCache';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile: longer staleTime so revisiting a screen within 2 min doesn't
      // refetch — the user perceives the app as instant.
      staleTime: 2 * 60 * 1000,
      // Keep query data alive for 30 min after last unmount, so a tab swipe
      // back doesn't lose the cache.
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      // Global stale-while-revalidate: when a queryKey changes (eg. paging,
      // search, filters), keep showing the previous data until the new one
      // arrives instead of dropping back to a loading state. This is the
      // single biggest perceptible-perf win — search/pager swaps feel native.
      placeholderData: (prev: unknown) => prev,
    },
  },
});

export default function App() {
  const [cacheReady, setCacheReady] = useState(false);
  const persistenceCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    hydrateCache(queryClient).finally(() => {
      if (cancelled) return;
      // Attach AFTER hydration so we don't immediately re-write what we read.
      persistenceCleanup.current = attachPersistence(queryClient);
      setCacheReady(true);
    });
    return () => {
      cancelled = true;
      persistenceCleanup.current?.();
      persistenceCleanup.current = null;
    };
  }, []);

  // Render-blocking guard: tiny window (typically <50ms) — prevents the very
  // first useQuery from racing the hydration.
  if (!cacheReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider queryClient={queryClient}>
            <NavigationContainer>
              <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
              <AppNavigator />
            </NavigationContainer>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
