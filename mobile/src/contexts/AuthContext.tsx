import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
// Same alias style as CheckCreateScreen — expo-image is cross-platform, and
// its static cache-clear methods are the only thing this file needs.
import { Image as ExpoImage } from 'expo-image';
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
import api, {
  createCapturedAuthRequester,
  onApiRouteReady,
  onAuthExpired,
  onRequestSucceeded,
  reselectApiHost,
  setAuthToken,
} from '../api/axios';
import { captureException } from '../sentry';
import { clearWidgetData } from '../utils/widgetBridge';
import { clearPersistentCache } from '../utils/persistentCache';
import { clearOfflineCheckQueue } from '../utils/offlineCheckQueue';
import { toLocalISODate } from '../utils/dates';
import { PRODUCT_LIST_FIELDS } from '../constants/productFields';
import {
  commitAuthenticatedSession,
  createSessionEpochRuntime,
  createSessionRecoveryBackoff,
  runSessionRecoveryAttempt,
  type SessionEpochRuntime,
} from './authSessionRuntime';
import { createAuthSessionStorage } from './authSessionStorage';
import type { User, UserPermissions, UserRole } from '../../../shared/types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  /** Stored bearer exists, but /me is still waiting for a usable API route. */
  recoveringSession: boolean;
  /** A non-blocking /me recovery attempt is currently in flight. */
  sessionRecoveryPending: boolean;
  retrySessionRecovery: () => void;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
  /**
   * True while the superadmin is impersonating a tenant owner (a 30-min
   * director token is installed instead of the superadmin's own). Drives the
   * persistent «Вы вошли как …» banner.
   */
  isImpersonating: boolean;
  /**
   * Swap the stored auth token for the short-lived director token returned by
   * `tenantsApi.impersonate(id)` and set the session to that owner. The app
   * re-renders into the tenant's car-service tree because the role becomes
   * 'director'. Reuses the exact cross-tenant isolation flow `login()` uses.
   */
  beginImpersonation: (token: string, user: User) => Promise<void>;
  /**
   * End impersonation. The short-lived token has no superadmin credentials to
   * restore, so this is a hard logout back to the login screen — the
   * superadmin signs in again (stated in the confirm dialog before starting).
   */
  endImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const authSessionStorage = createAuthSessionStorage<User>(AsyncStorage, {
  isUser: (value): value is User =>
    !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
});

/**
 * Start both tenant-scoped durable clears in the same tick. allSettled keeps a
 * rejection handler attached immediately, but we still reject after both have
 * settled so a cross-tenant login never persists B after a failed A clear.
 */
async function clearPreviousTenantStorage(): Promise<void> {
  const start = (operation: () => Promise<unknown>): Promise<unknown> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const results = await Promise.allSettled([start(clearOfflineCheckQueue), start(clearPersistentCache)]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}

/** True when an axios error is a genuine 401 (session expired / revoked). */
function isAuthExpiry(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 401;
}

// One cold-start deadline for storage restore + the complete API-ring attempt.
// The axios layer already traverses every healthy candidate, so retrying /me
// here would multiply its worst case (3 manual attempts × 3 hosts). Fifteen
// seconds covers the observed 5–6s cold TLS path plus `/me`, while a total
// ring outage still cannot pin the native splash indefinitely.
export const AUTH_BOOTSTRAP_BUDGET_MS = 15_000;
const SESSION_RECOVERY_BACKOFF_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];
// Three physical /me attempts at 8s fit inside this total recovery window,
// with room for a manual fresh-route health pass (~9s) when needed.
export const SESSION_RECOVERY_BUDGET_MS = 35_000;
export const SESSION_RECOVERY_HOST_TIMEOUT_MS = 8_000;

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
 *
 * ROLE HYGIENE (prod incident 2026-06): this fan-out used to fire for EVERY
 * role identically. Under a master that meant a wave of owner-only requests
 * (`/checks/dashboard`, `/products/low-stock`, `/calls?date=…`) competing
 * with the queries the master dashboard actually needs (`/salary/my`,
 * `/shifts/my`) — and `/calls` is a guaranteed 400 on tenants without the
 * МоиЗвонки integration (a 4xx is deterministic, so the retry policy never
 * retries it — see utils/queryRetry.ts). Every prefetch below is now
 * gated by the same role/permission rules the screens themselves use
 * (mirrors `hasPermission` further down this file): a master session fires
 * ZERO requests it isn't allowed to make or has no screen for.
 */
function prefetchAfterLogin(qc: QueryClient, user: User): void {
  // Mirror of AuthContext.hasPermission (the canonical helper): director and
  // superadmin implicitly hold every permission; admin/master fall back to
  // the explicit permissions object from /auth/me.
  const can = (perm: keyof UserPermissions): boolean =>
    user.role === 'superadmin' || user.role === 'director' || !!user.permissions?.[perm];
  // Owner-side dashboard (AdminDashboard in DashboardScreen) mounts for
  // director / superadmin / admin — masters render MasterDashboard, which
  // never reads the owner widget keys prefetched under this flag.
  const isOwnerSide = user.role === 'director' || user.role === 'superadmin' || user.role === 'admin';

  // NOTE: there is deliberately NO un-scoped ['products', { search, limit }]
  // prefetch here. ProductsScreen's real key includes the resolved main
  // `warehouseId` (see the warehouse-scoped prefetch below, fired once
  // `['warehouses']` resolves) — the un-scoped slot was a structural MISS
  // nothing ever read, costing a full heavy products payload on every login.

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
        // (it defaults to the main warehouse). Warming the EXACT
        // warehouse-scoped key here makes the first Склад open instant.
        // `fields` mirrors the screen's slim `?fields=` projection (shared
        // PRODUCT_LIST_FIELDS constant) so the prefetched payload is
        // byte-identical to what the screen itself would fetch — without it
        // the prefetch pulled the heavy unprojected shape (bundle_items
        // JSONB, nested supplier) the list never renders.
        qc.prefetchQuery({
          queryKey: ['products', { search: '', limit: 500, warehouseId: main.id }],
          queryFn: async () => {
            const res = await productsApi.getAll({
              search: '',
              page: 1,
              limit: 500,
              warehouseId: main.id,
              fields: PRODUCT_LIST_FIELDS,
            } as Parameters<typeof productsApi.getAll>[0] & { fields: string });
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
  // perceives screens as instant when these are warm. Suppliers is
  // permission-gated in MoreScreen (`suppliers_access`) — a master without
  // it has no screen that reads this key, so don't burn the request.
  if (can('suppliers_access')) {
    qc.prefetchQuery({
      queryKey: ['suppliers', ''],
      queryFn: async () => {
        const res: any = await suppliersApi.getAll({ search: '' });
        return res.data?.data ?? res.data ?? [];
      },
      staleTime: 5 * 60_000,
    }).catch(() => {});
  }

  // ClientsScreen reads via `useInfiniteQuery` keyed
  //   ['clients-infinite', { search: '', filter: 'all', source: null }]
  // (defaults: empty search, «Все» filter, no source filter — see
  // ClientsScreen). The old plain ['clients', …] prefetch landed in a slot
  // nothing reads. Mirror the screen's EXACT key + page-1 request
  // (limit 20, `source: null` — NOT '') so the first open is a cache HIT.
  // Both keys feed the Clients screen, gated by `clients_view` in MoreScreen.
  if (can('clients_view')) {
    qc.prefetchInfiniteQuery({
      queryKey: ['clients-infinite', { search: '', filter: 'all', source: null }],
      initialPageParam: 1,
      queryFn: async ({ pageParam = 1 }) =>
        (await clientsApi.getAll({ search: '', page: pageParam as number, limit: 20 })).data,
      staleTime: 5 * 60_000,
    }).catch(() => {});

    qc.prefetchQuery({
      queryKey: ['cars', { search: '', page: 1, limit: 50 }],
      queryFn: async () => (await carsApi.getAll({ search: '', page: 1, limit: 50 })).data,
      staleTime: 5 * 60_000,
    }).catch(() => {});
  }

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

  // Owner-dashboard-only widgets (LowStockCard / CallsSnapshot in
  // DashboardScreen's AdminDashboard). Masters never mount these widgets and
  // never read these keys — prefetching under a master was pure waste, and
  // `/calls` is a guaranteed 400 on tenants without the МоиЗвонки
  // integration (a 4xx is never retried by the transient-retry policy),
  // polluting the master login.
  //
  // NOTE: the former ['checks-dashboard'] prefetch was removed entirely —
  // no `useQuery` anywhere in mobile/src reads that key any more (only
  // write-side invalidations reference it), so it was a dead request on
  // every login for every role.
  if (isOwnerSide) {
    qc.prefetchQuery({
      queryKey: ['low-stock'],
      queryFn: async () => (await productsApi.getLowStock()).data,
      staleTime: 60_000,
    }).catch(() => {});

    // LOCAL date — `toISOString()` is UTC and pointed the «Звонки сегодня»
    // prefetch at yesterday's slot after local midnight in RU timezones.
    const today = toLocalISODate();
    qc.prefetchQuery({
      queryKey: ['calls-summary', today],
      queryFn: async () => (await callsApi.getCalls({ date: today })).data.summary,
      staleTime: 60_000,
    }).catch(() => {});
  }

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
 * The Expo push token this device registered for the CURRENT session.
 * Cached at register time so logout() can unregister the exact same token —
 * otherwise the previous user keeps receiving pushes for their old tenant
 * after someone else signs in on this device.
 */
let registeredPushToken: string | null = null;

/**
 * Request push permission and register the Expo push token with the server.
 * Silently swallows all errors — push is non-critical.
 */
async function registerPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      // The local notification channel is FCM-independent and cheap — keep it
      // so any displayed notification keeps its importance settings.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
      // Android FCM не настроен (нет google-services.json), поэтому
      // getExpoPushTokenAsync падает «Default FirebaseApp is not initialized»
      // на каждом логине и заспамливает Sentry (issue REACT-NATIVE-7, 26
      // событий). Пропускаем и запрос permission'а (бессмысленный без FCM),
      // и регистрацию токена. Включить обратно после добавления
      // Firebase-проекта. iOS-путь ниже не тронут.
      return;
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;
    // The EAS projectId comes from app.json → extra.eas.projectId — the one
    // and only source of truth. NEVER hardcode it here: a stale hardcoded id
    // (from a deleted EAS project) silently produces tokens Expo can't
    // deliver to, which is exactly the bug this read replaced.
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) {
      console.warn('[push] EAS projectId missing from expo config — skipping push registration');
      return;
    }
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    await pushApi.register(tokenData.data, platform);
    registeredPushToken = tokenData.data;
  } catch (err) {
    // Push registration is best-effort and must never block login, but a
    // SILENT failure (missing APNs entitlement, denied permission, projectId
    // mismatch) leaves NO push_tokens row and makes "push never arrived"
    // impossible to diagnose. Surface it: console warning + Sentry breadcrumb.
    console.warn('[push] token registration failed', err);
    captureException(err, { context: 'registerPushToken' });
  }
}

export function AuthProvider({ children, queryClient, onAuthResolve }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [recoveringSession, setRecoveringSession] = useState(false);
  const [sessionRecoveryPending, setSessionRecoveryPending] = useState(false);
  const sessionRuntimeRef = useRef<SessionEpochRuntime | null>(null);
  if (!sessionRuntimeRef.current) sessionRuntimeRef.current = createSessionEpochRuntime();
  const sessionRuntime = sessionRuntimeRef.current;
  const recoveryAttemptRef = useRef<Promise<void> | null>(null);
  const recoveryWakeQueuedRef = useRef(false);
  const recoveryForceQueuedRef = useRef(false);
  const recoveryBackoffRef = useRef(createSessionRecoveryBackoff(SESSION_RECOVERY_BACKOFF_MS));
  const recoveryCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Network requests run outside the serial commit queue. Starting a newer
  // transition advances the epoch immediately and aborts tracked bootstrap /
  // recovery reads; a late login response can then only resolve to a no-op.
  const beginSessionTransition = useCallback(() => {
    recoveryWakeQueuedRef.current = false;
    recoveryForceQueuedRef.current = false;
    recoveryBackoffRef.current.reset();
    if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
    recoveryCooldownTimerRef.current = null;
    setSessionRecoveryPending(false);
    return sessionRuntime.begin();
  }, [sessionRuntime]);

  useEffect(
    () => () => {
      if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
      // Abort tracked bootstrap/recovery work and invalidate every late commit
      // before this provider's setters disappear.
      sessionRuntime.begin();
    },
    [sessionRuntime],
  );

  // Load token + cached user on mount (optimistic restore + status-aware
  // background revalidation).
  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    let budgetExpired = false;
    const bootstrapEpoch = sessionRuntime.capture();
    const bootstrapAbort = new AbortController();
    const untrackBootstrapAbort = sessionRuntime.trackAbort(bootstrapEpoch, bootstrapAbort);
    // `finish` flips the splash exactly once. With optimistic restore it
    // fires as soon as token+user are read from disk — the shell renders
    // from cache with NO network wait; /me revalidates in the background.
    const finish = () => {
      if (resolved || cancelled) return;
      resolved = true;
      setLoading(false);
      onAuthResolve?.();
    };

    // This timer starts before AsyncStorage, so the budget covers the WHOLE
    // bootstrap rather than only the HTTP portion. On expiry we cancel the
    // single /me request (including any remaining axios ring traversal) and
    // release the splash. Cancellation is a transient outcome: it must never
    // clear a stored token or an optimistically restored user.
    const deadlineTimer = setTimeout(() => {
      budgetExpired = true;
      bootstrapAbort.abort();
      finish();
    }, AUTH_BOOTSTRAP_BUDGET_MS);

    (async () => {
      // The versioned envelope is authoritative; legacy token/user/flag keys
      // are read only as a migration fallback by authSessionStorage.
      const storedSession = await authSessionStorage.read();
      const stored = storedSession.token;
      const cachedUser = storedSession.user;
      // A native storage bridge can itself stall. Never let a value captured
      // before the deadline overwrite a login/session established after the
      // splash was released.
      if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
      // Restore the impersonation banner state for the (short) life of the
      // director token. If the token has already expired, the /me below 401s
      // and the whole session — flag included — is wiped.
      if (storedSession.impersonating) setIsImpersonating(true);

      if (!stored) {
        // No token → logged out. Drop any stray cached user (tenant safety)
        // and the impersonation flag (it must never outlive its token).
        void authSessionStorage.write({ token: null, user: null, impersonating: false });
        setRecoveringSession(false);
        setIsImpersonating(false);
        clearTimeout(deadlineTimer);
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
        setRecoveringSession(false);
        finish();
      } else {
        // We know the bearer exists, but cannot safely enter the app until
        // /me identifies its tenant/user. If the first attempt times out the
        // navigator shows an explicit recovery surface, never a fake Login.
        setRecoveringSession(true);
      }

      // Background (or blocking, when no cached user) revalidation. This is
      // intentionally ONE request: axios owns traversal of the three-host
      // ring, while the AbortSignal enforces the single cold-start deadline.
      try {
        const res = await api.get<User>('/auth/me', { signal: bootstrapAbort.signal });
        const fresh = res.data;
        // The deadline and epoch are checked AFTER resolution as well: abort
        // is cooperative, so a response already queued on the JS microtask
        // queue may still win the transport race unless we reject it here.
        if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
        let applied = false;
        await sessionRuntime.commit(bootstrapEpoch, async (isCurrent) => {
          if (!isCurrent() || budgetExpired) return;
          setUser(fresh);
          setRecoveringSession(false);
          applied = true;
          await authSessionStorage.write({
            token: stored,
            user: fresh,
            impersonating: storedSession.impersonating,
          });
        });
        // Token still valid — kick off prefetch for a warm session.
        if (applied && !budgetExpired && sessionRuntime.isCurrent(bootstrapEpoch) && queryClient) {
          prefetchAfterLogin(queryClient, fresh);
        }
      } catch (err) {
        if (cancelled || budgetExpired || !sessionRuntime.isCurrent(bootstrapEpoch)) return;
        if (isAuthExpiry(err)) {
          // Genuine expiry (401) — clear token + cached user and fall back to
          // Login. A valid token is only ever wiped on a REAL 401. This also
          // covers an expired impersonation (30-min director) token: the
          // banner flag is cleared and the superadmin lands on Login.
          setAuthToken(null);
          void authSessionStorage.write({ token: null, user: null, impersonating: false });
          setToken(null);
          setUser(null);
          setRecoveringSession(false);
          setIsImpersonating(false);
        }
        // Non-401 (network / timeout / 5xx, or `!err.response`): DO NOTHING.
        // Keep the optimistically-restored cached session — a transient
        // failure must never log a user out. The token survives untouched.
      } finally {
        clearTimeout(deadlineTimer);
        untrackBootstrapAbort();
        // No-op if we already finished optimistically; otherwise (no cached
        // user) this is where the splash finally dismisses.
        finish();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(deadlineTimer);
      bootstrapAbort.abort();
      untrackBootstrapAbort();
    };
    // onAuthResolve is captured intentionally — we only fire it for the
    // initial mount cycle, not on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const attemptSessionRecovery = useCallback(
    (force = false) => {
      if (loading || !recoveringSession || !token || user) return;
      if (recoveryAttemptRef.current) {
        recoveryWakeQueuedRef.current = true;
        if (force) recoveryForceQueuedRef.current = true;
        return;
      }
      const cooldownRemaining = recoveryBackoffRef.current.remainingMs();
      if (!force && cooldownRemaining > 0) {
        if (!recoveryCooldownTimerRef.current) {
          recoveryCooldownTimerRef.current = setTimeout(() => {
            recoveryCooldownTimerRef.current = null;
            attemptSessionRecovery(false);
          }, cooldownRemaining);
        }
        return;
      }
      if (recoveryCooldownTimerRef.current) clearTimeout(recoveryCooldownTimerRef.current);
      recoveryCooldownTimerRef.current = null;

      const recoveryEpoch = sessionRuntime.capture();
      const recoveryAbort = new AbortController();
      const untrackRecoveryAbort = sessionRuntime.trackAbort(recoveryEpoch, recoveryAbort);
      let budgetExpired = false;
      let recovered = false;
      recoveryWakeQueuedRef.current = false;
      recoveryForceQueuedRef.current = false;
      setSessionRecoveryPending(true);

      const work = (async () => {
        const deadlineTimer = setTimeout(() => {
          budgetExpired = true;
          recoveryAbort.abort();
        }, SESSION_RECOVERY_BUDGET_MS);
        try {
          const res = await runSessionRecoveryAttempt({
            forceFreshRoute: force,
            reselectRoute: reselectApiHost,
            isCurrent: () => !budgetExpired && sessionRuntime.isCurrent(recoveryEpoch),
            loadUser: () =>
              api.get<User>('/auth/me', {
                signal: recoveryAbort.signal,
                timeout: SESSION_RECOVERY_HOST_TIMEOUT_MS,
              }),
          });
          if (!res) return;
          const fresh = res.data;
          if (budgetExpired || !sessionRuntime.isCurrent(recoveryEpoch)) return;

          let applied = false;
          await sessionRuntime.commit(recoveryEpoch, async (isCurrent) => {
            if (!isCurrent() || budgetExpired) return;
            setUser(fresh);
            setRecoveringSession(false);
            applied = true;
            recovered = true;
            recoveryBackoffRef.current.reset();
            await authSessionStorage.write({ token, user: fresh, impersonating: isImpersonating });
          });
          if (applied && !budgetExpired && sessionRuntime.isCurrent(recoveryEpoch) && queryClient) {
            prefetchAfterLogin(queryClient, fresh);
          }
        } catch {
          // 401 is handled by the axios auth-expiry event. Transport/timeout/5xx
          // deliberately leave the bearer and recovery surface intact for the
          // next route-success, foreground or explicit user retry.
        } finally {
          clearTimeout(deadlineTimer);
          untrackRecoveryAbort();
          // A second recovery cannot start while this ref is non-null; clear it
          // unconditionally before consuming a queued positive network signal.
          recoveryAttemptRef.current = null;
          const stillCurrent = sessionRuntime.isCurrent(recoveryEpoch);
          if (stillCurrent) setSessionRecoveryPending(false);
          if (!recovered && stillCurrent) {
            recoveryBackoffRef.current.recordFailure();
          }
          const retryQueued = recoveryWakeQueuedRef.current;
          const retryForce = recoveryForceQueuedRef.current;
          recoveryWakeQueuedRef.current = false;
          recoveryForceQueuedRef.current = false;
          if (retryQueued && !recovered && stillCurrent) {
            queueMicrotask(() => attemptSessionRecovery(retryForce));
          }
        }
      })();
      recoveryAttemptRef.current = work;
    },
    [isImpersonating, loading, queryClient, recoveringSession, sessionRuntime, token, user],
  );

  const retrySessionRecovery = useCallback(() => attemptSessionRecovery(true), [attemptSessionRecovery]);

  // Wake the unresolved stored session only on positive evidence: an axios
  // request succeeded, or App's existing NetInfo/AppState route controller
  // completed a healthy reselection. No second selector/listener is created.
  useEffect(() => {
    if (loading || !recoveringSession || !token || user) return;
    const retry = () => attemptSessionRecovery(false);
    const unsubscribeRoute = onApiRouteReady(retry);
    const unsubscribeRequest = onRequestSucceeded(retry);
    return () => {
      unsubscribeRoute();
      unsubscribeRequest();
    };
  }, [attemptSessionRecovery, loading, recoveringSession, token, user]);

  // Listen for 401 events from axios interceptor
  useEffect(() => {
    return onAuthExpired(() => {
      const expiredEpoch = beginSessionTransition();
      // Publish the logout boundary before any unbounded query cancellation.
      // These calls start synchronously: even if the runtime queue is wedged,
      // a killed process cannot reboot into the expired bearer plus live A
      // queue/cache. A newer login is protected by each storage generation.
      setAuthToken(null);
      setToken(null);
      setUser(null);
      setRecoveringSession(false);
      setSessionRecoveryPending(false);
      setIsImpersonating(false);
      const tombstoneWrite = authSessionStorage.write({ token: null, user: null, impersonating: false });
      const tenantDiskClear = clearPreviousTenantStorage().catch(() => {});

      void sessionRuntime.commit(expiredEpoch, async (isCurrent) => {
        if (!isCurrent()) return;
        await tombstoneWrite;
        if (!isCurrent()) return;
        await queryClient?.cancelQueries().catch(() => {});
        if (!isCurrent()) return;
        queryClient?.clear();
        clearWidgetData();
        await tenantDiskClear;
      });
    });
  }, [beginSessionTransition, queryClient, sessionRuntime]);

  // Stabilise the auth API surface — every consumer of `useAuth()` reads
  // these callbacks, and a fresh function identity on every AuthProvider
  // render would invalidate any `useMemo`/`useCallback` depending on
  // them downstream. Wrapping in `useCallback` keeps the identities
  // stable across renders, so re-renders only fire on actual auth-state
  // change (login, logout, 401, refreshUser).
  const login = useCallback(
    async (phone: string, password: string) => {
      const loginEpoch = beginSessionTransition();
      // Network stays outside the commit queue: a slow login A must not hold
      // up a newer login B or logout. Only its result is serialised below.
      const res = await authApi.login({ phone, password });
      const { token: t, user: u } = res.data;
      const applied = await commitAuthenticatedSession(sessionRuntime, loginEpoch, {
        clearPreviousTenant: () => {
          queryClient?.cancelQueries().catch(() => {});
          queryClient?.clear();
          clearWidgetData();
          // clearAll empties its in-memory queue before returning the promise.
          // Both durable tenant stores must be empty before token B is
          // persisted; otherwise a process kill can restore B beside A data.
          return clearPreviousTenantStorage();
        },
        applyInMemory: () => {
          setAuthToken(t);
          setToken(t);
          setUser(u);
          setRecoveringSession(false);
          setSessionRecoveryPending(false);
          setIsImpersonating(false);
        },
        persist: async () => {
          await authSessionStorage.write({ token: t, user: u, impersonating: false });
        },
      });
      if (applied && sessionRuntime.isCurrent(loginEpoch) && queryClient) prefetchAfterLogin(queryClient, u);
    },
    [beginSessionTransition, queryClient, sessionRuntime],
  );

  const refreshUser = useCallback(async () => {
    const refreshEpoch = sessionRuntime.capture();
    try {
      const res = await authApi.me();
      const fresh = res.data as User;
      await sessionRuntime.commit(refreshEpoch, async (isCurrent) => {
        if (!isCurrent()) return;
        setUser(fresh);
        await authSessionStorage.write({ token, user: fresh, impersonating: isImpersonating });
      });
    } catch {
      // ignore — a transient failure keeps the current session intact
    }
  }, [isImpersonating, sessionRuntime, token]);

  const logout = useCallback(async () => {
    const logoutEpoch = beginSessionTransition();
    const previousPushToken = registeredPushToken;
    registeredPushToken = null;

    // Capture A's bearer + epoch before publishing the local tombstone. The
    // server cleanup stays best-effort and never blocks local logout, but is
    // ordered so JWT revocation cannot beat push-token removal. A late result
    // is rejected at the axios session boundary and cannot affect session B.
    if (token) {
      const cleanupAsPreviousSession = createCapturedAuthRequester(token);
      void (async () => {
        if (previousPushToken) {
          await cleanupAsPreviousSession({
            method: 'delete',
            url: '/push/token',
            data: { token: previousPushToken },
          }).catch(() => {});
        }
        await cleanupAsPreviousSession({ method: 'post', url: '/auth/logout' }).catch(() => {});
      })();
    }

    setAuthToken(null);
    setToken(null);
    setUser(null);
    setRecoveringSession(false);
    setSessionRecoveryPending(false);
    setIsImpersonating(false);
    const tombstoneWrite = authSessionStorage.write({ token: null, user: null, impersonating: false });
    const tenantDiskClear = clearPreviousTenantStorage().catch(() => {});

    await sessionRuntime.commit(logoutEpoch, async (isCurrent) => {
      if (!isCurrent()) return;
      await tombstoneWrite;
      if (!isCurrent()) return;
      await queryClient?.cancelQueries().catch(() => {});
      if (!isCurrent()) return;
      queryClient?.clear();
      clearWidgetData();
      await tenantDiskClear;
      if (!isCurrent()) return;
      ExpoImage.clearDiskCache().catch(() => {});
      ExpoImage.clearMemoryCache().catch(() => {});
    });
  }, [beginSessionTransition, queryClient, sessionRuntime, token]);

  /**
   * beginImpersonation — install the short-lived (30-min) director token
   * returned by `tenantsApi.impersonate(id)` and become that tenant's owner.
   *
   * Mirrors `login()`'s cross-tenant isolation EXACTLY (cancel + clear
   * QueryClient, clear persistent cache, reset the bearer + ETag map, persist
   * the new token + user) so none of the superadmin's cached data bleeds into
   * the impersonated tenant's session. The only departure: we receive the
   * token + user directly (no /auth/login round-trip) and set the
   * impersonation flag so the persistent banner renders. When `user.role`
   * flips to 'director' the root navigator re-renders into the normal
   * car-service tree — no special-casing needed there.
   */
  const beginImpersonation = useCallback(
    async (t: string, u: User) => {
      const impersonationEpoch = beginSessionTransition();
      const applied = await commitAuthenticatedSession(sessionRuntime, impersonationEpoch, {
        clearPreviousTenant: () => {
          queryClient?.cancelQueries().catch(() => {});
          queryClient?.clear();
          ExpoImage.clearDiskCache().catch(() => {});
          ExpoImage.clearMemoryCache().catch(() => {});
          clearWidgetData();
          return clearPreviousTenantStorage();
        },
        applyInMemory: () => {
          setAuthToken(t);
          setToken(t);
          setUser(u);
          setRecoveringSession(false);
          setSessionRecoveryPending(false);
          setIsImpersonating(true);
        },
        persist: async () => {
          await authSessionStorage.write({ token: t, user: u, impersonating: true });
        },
      });
      if (applied && sessionRuntime.isCurrent(impersonationEpoch) && queryClient) prefetchAfterLogin(queryClient, u);
    },
    [beginSessionTransition, queryClient, sessionRuntime],
  );

  /**
   * endImpersonation — leave the impersonated session. The director token is
   * short-lived and carries no superadmin credentials to restore, so the only
   * safe exit is a full logout back to Login (the superadmin signs in again).
   * The confirm dialog before impersonating states this explicitly.
   */
  const endImpersonation = useCallback(() => {
    logout();
  }, [logout]);

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
    () => ({
      user,
      token,
      loading,
      recoveringSession,
      sessionRecoveryPending,
      retrySessionRecovery,
      login,
      logout,
      refreshUser,
      hasPermission,
      isRole,
      isImpersonating,
      beginImpersonation,
      endImpersonation,
    }),
    [
      user,
      token,
      loading,
      recoveringSession,
      sessionRecoveryPending,
      retrySessionRecovery,
      login,
      logout,
      refreshUser,
      hasPermission,
      isRole,
      isImpersonating,
      beginImpersonation,
      endImpersonation,
    ],
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
