import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { QueryClient } from '@tanstack/react-query';
import {
  authApi,
  productsApi,
  servicesApi,
  usersApi,
  warehouseCategoriesApi,
  warehousesApi,
  suppliersApi,
  clientsApi,
  carsApi,
  equipmentApi,
  checksApi,
  callsApi,
  subscriptionApi,
  scheduleApi,
  pushApi,
} from '../api/services';
import { onAuthExpired, setAuthToken } from '../api/axios';
import { clearPersistentCache } from '../utils/persistentCache';
import type { User, UserPermissions, UserRole } from '../../../shared/types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// AsyncStorage slot for the persisted user object. Mirrored alongside the
// 'token' slot so a cold start can render the shell from cache before /me
// resolves (optimistic restore). MUST be wiped on logout / 401 (tenant safety
// — user B must never see user A's cached identity). The axios 401 handler
// already removes this key too; AuthContext keeps it in sync on its own paths.
const STORAGE_USER_KEY = 'user';

/** Persist the authenticated user object for optimistic cold-start restore. */
async function persistUser(u: User): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_USER_KEY, JSON.stringify(u));
  } catch {
    // best-effort — losing the cache only costs a network wait next cold start
  }
}

/** Read + parse the cached user, or null if absent / corrupt. */
async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return parsed as User;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when an axios error is a genuine 401 (session expired / revoked). */
function isAuthExpiry(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 401;
}

/**
 * Fetch the current user with a bounded retry. Retries up to 2 times
 * (~400ms, ~800ms backoff) but ONLY on non-401 failures — a genuine 401 is
 * a real expiry and must surface immediately so the caller can log out.
 * Network / timeout / 5xx are transient and worth a couple of retries before
 * we decide to keep the optimistically-restored session.
 */
async function fetchMeWithRetry(): Promise<User> {
  const delays = [400, 800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await authApi.me();
      return res.data as User;
    } catch (err) {
      lastErr = err;
      // Don't burn retries on a real expiry — propagate the 401 now.
      if (isAuthExpiry(err) || attempt === delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastErr;
}

interface AuthProviderProps {
  children: ReactNode;
  /**
   * Optional QueryClient. When provided we kick off prefetches for the
   * heavy reference data (warehouse, services, users) right after a
   * successful login so the user perceives subsequent screens as instant.
   */
  queryClient?: QueryClient;
  /**
   * Fired once when the initial auth check finishes — regardless of
   * outcome. Lets `App.tsx` time the splash dismissal precisely instead
   * of relying on an in-tree spinner.
   */
  onAuthResolve?: () => void;
}

/**
 * Fire-and-forget prefetch of cacheable reference data.
 * Errors are swallowed — they'll surface naturally when the screen mounts.
 */
function prefetchAfterLogin(qc: QueryClient): void {
  // Unscoped fallback slot. ProductsScreen's real key includes the resolved
  // main `warehouseId` (see the warehouse-scoped prefetch below, fired once
  // `['warehouses']` resolves), so this slot alone was a structural MISS for
  // the screen. We keep it as a cheap fallback for any caller that reads the
  // un-scoped key, but the screen-matching warm-up happens in the
  // warehouses `.then()` so the Склад tab is an actual cache hit.
  qc.prefetchQuery({
    queryKey: ['products', { search: '', limit: 500 }],
    queryFn: async () => {
      const res = await productsApi.getAll({ search: '', page: 1, limit: 500 });
      return res.data;
    },
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Mirror key for the cash-side product picker. `ProductPickerModal`
  // reads `['all-products-check']` so opening the picker is a cache hit
  // on the first try right after login. Different shape (flat array)
  // than the warehouse `['products', ...]` key, so a separate prefetch
  // is needed instead of aliasing.
  qc.prefetchQuery({
    queryKey: ['all-products-check'],
    queryFn: async () => {
      const res = await productsApi.getAll({ search: '', page: 1, limit: 500 });
      return (res.data as { data?: unknown }).data ?? res.data;
    },
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Legacy / fallback cache slot — server falls back to main warehouse
  // when no warehouseId is provided, so this prefetch covers callers
  // that haven't migrated to the warehouse-scoped key yet.
  qc.prefetchQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => (await warehouseCategoriesApi.getAll()).data,
    staleTime: 10 * 60_000,
  }).catch(() => {});

  // Warehouses (3 rows: main/defect/used). Warehouse switcher in
  // ProductsScreen reads this — prefetch so the picker can render
  // synchronously even on a cold start. Once the warehouses list
  // resolves we also pre-warm the main-warehouse categories key so
  // `ProductsScreen` / `CheckCreateScreen` hit cache on first render.
  qc.prefetchQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 10 * 60_000,
  })
    .then(() => {
      const warehouses = qc.getQueryData<Array<{ id: string; kind: 'main' | 'defect' | 'used' }>>(['warehouses']);
      const main = warehouses?.find((w) => w.kind === 'main');
      if (main?.id) {
        qc.prefetchQuery({
          queryKey: ['warehouse-categories', { warehouseId: main.id }],
          queryFn: async () => (await warehouseCategoriesApi.getAll(main.id)).data,
          staleTime: 10 * 60_000,
        }).catch(() => {});

        // Склад first-open cache HIT. ProductsScreen reads
        //   ['products', { search: '', limit: 500, warehouseId: <main.id> }]
        // (it defaults to the main warehouse). The earlier un-scoped
        // ['products', { search:'', limit:500 }] prefetch never matched that
        // slot, so the screen still flashed empty + refetched. Warming the
        // EXACT warehouse-scoped key here makes the first Склад open instant.
        qc.prefetchQuery({
          queryKey: ['products', { search: '', limit: 500, warehouseId: main.id }],
          queryFn: async () => {
            const res = await productsApi.getAll({ search: '', page: 1, limit: 500, warehouseId: main.id });
            return res.data;
          },
          staleTime: 5 * 60_000,
        }).catch(() => {});
      }
    })
    .catch(() => {});

  qc.prefetchQuery({
    queryKey: ['all-services'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 500 });
      return res.data?.data || res.data;
    },
    staleTime: 10 * 60_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['all-users'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Mirror key 'users' since some screens use it instead of 'all-users'
  qc.prefetchQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Suppliers / clients / cars / equipment — heavy reference lists; user
  // perceives screens as instant when these are warm.
  qc.prefetchQuery({
    queryKey: ['suppliers', ''],
    queryFn: async () => {
      const res: any = await suppliersApi.getAll({ search: '' });
      return res.data?.data ?? res.data ?? [];
    },
    staleTime: 5 * 60_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['clients', { search: '', page: 1, limit: 50 }],
    queryFn: async () => (await clientsApi.getAll({ search: '', page: 1, limit: 50 })).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['cars', { search: '', page: 1, limit: 50 }],
    queryFn: async () => (await carsApi.getAll({ search: '', page: 1, limit: 50 })).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['eq-summary'],
    queryFn: async () => (await equipmentApi.getSummary()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ── Journal (Чеки) — owner explicitly reported this list opens
  // slowly with a flash of empty. ChecksScreen reads via
  // `useInfiniteQuery`, NOT `useQuery`, so the previous `['checks', …]`
  // prefetch landed in a slot nothing reads (React Query compares keys
  // structurally → a dead slot). Match the EXACT default infinite key
  // the screen uses for the first page with no filters:
  //   ['checks-infinite', search='', dateFrom='', dateTo='', masterId='']
  // with `prefetchInfiniteQuery` + the same `initialPageParam` and a
  // queryFn that mirrors the screen's page-1 request (limit=20). This
  // way the screen's first render is a cache HIT. Persistent cache
  // ('checks-infinite' is in PERSISTED_KEYS) carries it across cold
  // starts; this prefetch warms the slot on the first login.
  qc.prefetchInfiniteQuery({
    queryKey: ['checks-infinite', '', '', '', ''],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const res = await checksApi.getAll({ page: pageParam as number, limit: 20 });
      return res.data;
    },
    staleTime: 60_000,
  }).catch(() => {});

  // ChecksScreen's master-filter dropdown uses a separate key so the
  // dropdown opens populated even before the user touches anything.
  qc.prefetchQuery({
    queryKey: ['users-for-filter'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // EmployeesScreen uses 'users-all' (separate key from 'users' /
  // 'all-users' to avoid invalidation cross-talk). Prefetch so the
  // More → Сотрудники screen is instant.
  qc.prefetchQuery({
    queryKey: ['users-all'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ServicesScreen first page (default filters: search='', page=1, limit=30).
  qc.prefetchQuery({
    queryKey: ['services', { search: '', page: 1, limit: 30 }],
    queryFn: async () => (await servicesApi.getAll({ search: '', page: 1, limit: 30 })).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // Dashboard widgets — owners see TodayQuickStats / LowStockWidget /
  // MissedCallsWidget. Tiny endpoints, prefetch always (master role
  // simply won't render the widgets, no cost on render).
  qc.prefetchQuery({
    queryKey: ['checks-dashboard'],
    queryFn: async () => (await checksApi.getDashboard()).data,
    staleTime: 30_000,
  }).catch(() => {});

  qc.prefetchQuery({
    queryKey: ['low-stock'],
    queryFn: async () => (await productsApi.getLowStock()).data,
    staleTime: 60_000,
  }).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  qc.prefetchQuery({
    queryKey: ['calls-summary', today],
    queryFn: async () => (await callsApi.getCalls({ date: today })).data.summary,
    staleTime: 60_000,
  }).catch(() => {});

  // Subscription gates the entire app (FeatureGate paywall). Prefetch it
  // so the first protected screen doesn't flash the loading state.
  qc.prefetchQuery({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60_000,
  }).catch(() => {});

  // ScheduleScreen's first paint shows "today's shifts". Prefetch the
  // current week so even the schedule tab is instant on open.
  qc.prefetchQuery({
    queryKey: ['schedule-today'],
    queryFn: async () => (await scheduleApi.getToday()).data,
    staleTime: 60_000,
  }).catch(() => {});

  // Push token registration — fire-and-forget, never blocks login.
  registerPushToken().catch(() => {});
}

/**
 * Request push permission and register the Expo push token with the server.
 * Silently swallows all errors — push is non-critical.
 */
async function registerPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '2d08b9be-9503-4e31-9198-8ec7093e44d7',
    });
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await pushApi.register(tokenData.data, platform);
  } catch {
    // Silent fail — push registration is best-effort.
  }
}

export function AuthProvider({ children, queryClient, onAuthResolve }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load token + cached user on mount (optimistic restore + status-aware
  // background revalidation).
  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    // `finish` flips the splash exactly once. With optimistic restore it
    // fires as soon as token+user are read from disk — the shell renders
    // from cache with NO network wait; /me revalidates in the background.
    const finish = () => {
      if (resolved || cancelled) return;
      resolved = true;
      setLoading(false);
      onAuthResolve?.();
    };

    (async () => {
      // Read token AND the cached user together so we can restore the whole
      // session optimistically before the first /me round-trip.
      const [stored, cachedUser] = await Promise.all([
        AsyncStorage.getItem('token').catch(() => null),
        readCachedUser(),
      ]);
      if (cancelled) return;

      if (!stored) {
        // No token → logged out. Drop any stray cached user (tenant safety).
        AsyncStorage.removeItem(STORAGE_USER_KEY).catch(() => {});
        finish();
        return;
      }

      // Prime the axios in-memory token cache so the very first wave of
      // post-mount requests (the `me()` below + any eager screen queries)
      // skip the per-request AsyncStorage bridge read.
      setAuthToken(stored);
      setToken(stored);

      // Optimistic restore: if we also have a cached user, render the shell
      // immediately from cache. This kills the "flash of Login" on cold
      // start — the user sees their app instantly while /me revalidates.
      if (cachedUser) {
        setUser(cachedUser);
        finish();
      }

      // Background (or blocking, when no cached user) revalidation of /me
      // with a bounded, 401-aware retry.
      try {
        const fresh = await fetchMeWithRetry();
        if (cancelled) return;
        setUser(fresh);
        persistUser(fresh).catch(() => {});
        // Token still valid — kick off prefetch for a warm session.
        if (queryClient) prefetchAfterLogin(queryClient);
      } catch (err) {
        if (cancelled) return;
        if (isAuthExpiry(err)) {
          // Genuine expiry (401) — clear token + cached user and fall back to
          // Login. A valid token is only ever wiped on a REAL 401.
          setAuthToken(null);
          AsyncStorage.removeItem('token').catch(() => {});
          AsyncStorage.removeItem(STORAGE_USER_KEY).catch(() => {});
          setToken(null);
          setUser(null);
        }
        // Non-401 (network / timeout / 5xx, or `!err.response`): DO NOTHING.
        // Keep the optimistically-restored cached session — a transient
        // failure must never log a user out. The token survives untouched.
      } finally {
        // No-op if we already finished optimistically; otherwise (no cached
        // user) this is where the splash finally dismisses.
        finish();
      }
    })();

    return () => {
      cancelled = true;
    };
    // onAuthResolve is captured intentionally — we only fire it for the
    // initial mount cycle, not on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  // Listen for 401 events from axios interceptor
  useEffect(() => {
    return onAuthExpired(() => {
      // Cancel every in-flight refetch BEFORE clearing the cache —
      // otherwise a still-pending request lands after we've cleared
      // state and resurrects a stale `queryClient` entry under a
      // re-authenticated session (mixing tenants A and B briefly).
      queryClient?.cancelQueries().catch(() => {});
      // Clear the in-memory token + ETag cache (the axios 401 handler already
      // called setAuthToken(null), but this listener also fires for the
      // coalesced/secondary paths — idempotent and cheap).
      setAuthToken(null);
      setToken(null);
      setUser(null);
      // Wipe the cached user identity too — tenant safety. (The axios 401
      // handler already removes it, but this listener also covers the
      // coalesced/secondary paths; idempotent and cheap.)
      AsyncStorage.removeItem(STORAGE_USER_KEY).catch(() => {});
      // Clear persistent cache so the next login starts fresh
      clearPersistentCache().catch(() => {});
      queryClient?.clear();
    });
  }, [queryClient]);

  // Stabilise the auth API surface — every consumer of `useAuth()` reads
  // these callbacks, and a fresh function identity on every AuthProvider
  // render would invalidate any `useMemo`/`useCallback` depending on
  // them downstream. Wrapping in `useCallback` keeps the identities
  // stable across renders, so re-renders only fire on actual auth-state
  // change (login, logout, 401, refreshUser).
  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await authApi.login({ phone, password });
      const { token: t, user: u } = res.data;
      // Cross-tenant safety: even though `logout()` is the normal path
      // off-board user A's data, a crash/kill mid-session can leave
      // `rqcache:v1:*` entries belonging to A in AsyncStorage. When user
      // B then logs in on the same device, we MUST start with an empty
      // QueryClient + empty persistent cache before persisting B's data.
      queryClient?.cancelQueries().catch(() => {});
      queryClient?.clear();
      await clearPersistentCache().catch(() => {});
      // Drop tenant A's bearer + ETag cache BEFORE priming B's token, so a
      // 304 against an A-era ETag can never resurrect A's body into B's
      // session. setAuthToken(null) clears the ETag map; setAuthToken(t)
      // installs B's bearer for every subsequent request without an
      // AsyncStorage read on the prefetch fan-out.
      setAuthToken(null);
      await AsyncStorage.setItem('token', t);
      // Persist B's user AFTER clearPersistentCache() above (which only wipes
      // 'rqcache:v1:*', not the 'user' slot) so the next cold start restores
      // B — never a leftover A. Part of the same cross-tenant isolation as the
      // token / QueryClient / ETag resets above.
      await persistUser(u);
      setAuthToken(t);
      setToken(t);
      setUser(u);
      if (queryClient) prefetchAfterLogin(queryClient);
    },
    [queryClient],
  );

  const refreshUser = useCallback(async () => {
    try {
      const res = await authApi.me();
      const fresh = res.data as User;
      setUser(fresh);
      // Keep the cold-start cache in sync so the next optimistic restore
      // reflects the latest profile (role / permissions / name changes).
      persistUser(fresh).catch(() => {});
    } catch {
      // ignore — a transient failure keeps the current session intact
    }
  }, []);

  const logout = useCallback(async () => {
    authApi.logout().catch(() => {});
    // Cancel in-flight queries first so a stale request can't land
    // after we've torn down state and revive an entry under the next
    // user's session.
    queryClient?.cancelQueries().catch(() => {});
    // Drop in-memory bearer + ETag cache so subsequent requests are
    // unauthenticated and no stale 304 body survives into the next session.
    setAuthToken(null);
    await AsyncStorage.removeItem('token');
    // Wipe the cached user identity — tenant safety: user B logging in on the
    // same device must never restore user A optimistically.
    await AsyncStorage.removeItem(STORAGE_USER_KEY).catch(() => {});
    await clearPersistentCache().catch(() => {});
    queryClient?.clear();
    setToken(null);
    setUser(null);
  }, [queryClient]);

  const hasPermission = useCallback(
    (perm: keyof UserPermissions): boolean => {
      if (!user) return false;
      if (user.role === 'superadmin' || user.role === 'director') return true;
      return !!user.permissions?.[perm];
    },
    [user],
  );

  const isRole = useCallback(
    (...roles: UserRole[]): boolean => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  );

  // Memoise the context value so AuthContext.Provider doesn't broadcast a
  // fresh object reference on every AuthProvider render (e.g. when only
  // `loading` flips). With the memo, consumers see a stable value as
  // long as user/token/loading don't actually change.
  const value = useMemo<AuthContextType>(
    () => ({ user, token, loading, login, logout, refreshUser, hasPermission, isRole }),
    [user, token, loading, login, logout, refreshUser, hasPermission, isRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
