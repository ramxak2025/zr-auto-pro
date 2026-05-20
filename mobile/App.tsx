import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Font from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import SplashOverlay from './src/components/SplashOverlay';
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
  const [authResolved, setAuthResolved] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
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

  // Pre-load vector-icon font families. The default `@expo/vector-icons`
  // wrapper renders an empty `<Text />` until each font finishes its own
  // lazy `Font.loadAsync` on mount. On Android (especially with Hermes +
  // New Architecture and on production builds where the async load can
  // race the first paint or silently no-op), that meant chevrons and
  // every other glyph rendered as blank squares — i.e. "icons gone".
  // Loading the fonts once at startup makes `Font.isLoaded(name)` true
  // for every Icon's first render — they appear immediately.
  useEffect(() => {
    let cancelled = false;
    Font.loadAsync({
      ...(Ionicons as any).font,
      ...(MaterialCommunityIcons as any).font,
    })
      .catch(() => {
        // Even if a single family fails, let the app continue rendering
        // rather than blocking the splash forever — individual icons
        // will retry their own load on mount.
      })
      .finally(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show the branded splash while either (a) the cache is still hydrating
  // or (b) the AuthProvider is still verifying the stored token, or (c)
  // the icon fonts haven't finished loading yet. Both windows are short
  // (~50 ms cache + 200–600 ms /me + ~50 ms fonts).
  const showSplash = !cacheReady || !authResolved || !fontsReady;

  return (
    <ErrorBoundary>
      <SafeAreaProvider style={{ backgroundColor: colors.gray[50] }}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider queryClient={queryClient} onAuthResolve={() => setAuthResolved(true)}>
            <NavigationContainer
              theme={{
                dark: false,
                colors: {
                  // Make every navigator's scene background match the
                  // screens' canvas — gray-50. This is the final fix for
                  // the "boxed app" effect: the underlying NativeStack /
                  // BottomTab containers stop drawing white behind each
                  // screen, so the visual surface is one continuous
                  // gray-50 from the status bar all the way under the
                  // floating glass tab bar. Per-screen `<View>` with
                  // gray-50 then layers harmlessly on top.
                  primary: colors.primary[600],
                  background: colors.gray[50],
                  card: 'transparent',
                  text: colors.gray[900],
                  border: colors.gray[200],
                  notification: colors.primary[600],
                },
                fonts: {
                  regular: { fontFamily: 'System', fontWeight: '400' },
                  medium: { fontFamily: 'System', fontWeight: '500' },
                  bold: { fontFamily: 'System', fontWeight: '700' },
                  heavy: { fontFamily: 'System', fontWeight: '900' },
                },
              }}
            >
              {/* Translucent status bar — on Android removes the default
                  opaque strip, so the SafeAreaProvider's gray-50 shows
                  underneath; on iOS this prop is a no-op (status bar
                  is always translucent over content). */}
              <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
              {/* Render the navigator immediately so its scene is mounted
                  and ready to display the moment the splash unmounts —
                  no second-pass layout flash. */}
              {cacheReady && fontsReady && <AppNavigator />}
              {showSplash && <SplashOverlay />}
            </NavigationContainer>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
