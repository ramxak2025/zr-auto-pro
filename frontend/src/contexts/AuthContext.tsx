import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import {
  authApi,
  productsApi,
  servicesApi,
  clientsApi,
  carsApi,
  usersApi,
  warehouseCategoriesApi,
  subscriptionApi,
} from '../api/services';
import { User, UserPermissions, UserRole } from '../types';
import { clearPersistentCache } from '../utils/persistentCache';
import { purgeApiCache, purgeOfflineQueues } from '../utils/swCache';

/**
 * Warm the React Query cache with data the user is likely to open next.
 *
 * Runs in the background after login / session restore. Failures are silent —
 * this is a perf optimization, not a contract. Screens still fetch their own
 * data via useQuery if prefetch lost the race.
 *
 * Mirrors `prefetchAfterLogin` in `mobile/src/contexts/AuthContext.tsx` so
 * web and mobile feel equally fast on first navigation.
 *
 * ROLE HYGIENE (matches mobile's prod-incident fix 2026-06): this fan-out used
 * to fire owner-scoped requests (`/users`, `/clients`, `/suppliers`, …) for
 * EVERY role on every refresh. A master can't read those — the backend answers
 * 401/403 — and the resulting boot 401 was nuking an otherwise-valid session
 * on every refresh. Each prefetch below is now gated by the SAME permission
 * rules the screens use (`hasPermission`), so a master fires ZERO requests it
 * isn't allowed to make.
 */
function prefetchAfterLogin(qc: QueryClient, user: User): void {
  // Mirror of AuthContext.hasPermission: director & superadmin implicitly hold
  // every permission; admin/master fall back to the explicit permissions map.
  const can = (perm: keyof UserPermissions): boolean =>
    user.role === UserRole.SUPERADMIN || user.role === UserRole.DIRECTOR || !!user.permissions?.[perm];

  const limit = 50;
  type PrefetchPair = [unknown[], () => Promise<unknown>];
  const pairs: PrefetchPair[] = [];

  // Warehouse / products — gated by warehouse_access (masters that work the
  // cash screen typically have it; those that don't have no products screen).
  if (can('warehouse_access')) {
    pairs.push([
      ['products', { page: 1, limit, search: '' }],
      () => productsApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ]);
    pairs.push([
      ['warehouse-categories'],
      () => warehouseCategoriesApi.getAll().then((r: { data: unknown }) => r.data),
    ]);
  }

  // Services are read by the cash screen for everyone who can touch checks.
  if (can('checks_view') || can('checks_create')) {
    pairs.push([
      ['services', { page: 1, limit, search: '' }],
      () => servicesApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ]);
  }

  // Clients + cars — gated by clients_view (the Clients screen's own gate).
  if (can('clients_view')) {
    pairs.push([
      ['clients', { search: '', page: 1, limit: 20 }],
      () => clientsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ]);
    pairs.push([
      ['cars', { search: '', page: 1, limit: 20 }],
      () => carsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ]);
  }

  // Users list — owner-side only (user_management). A master never reads it.
  if (can('user_management')) {
    pairs.push([['users'], () => usersApi.getAll().then((r: { data: unknown }) => r.data)]);
  }

  // Subscription is read by Layout for every authenticated role.
  pairs.push([['subscription'], () => subscriptionApi.get().then((r: { data: unknown }) => r.data)]);

  for (const [key, fn] of pairs) {
    qc.prefetchQuery({ queryKey: key, queryFn: fn, staleTime: 60_000 }).catch(() => {
      // Silent — prefetch is best-effort.
    });
  }
}

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

// Use null default instead of `{} as AuthContextType` — accessing the context
// outside of AuthProvider would silently return an empty object, causing
// runtime crashes when calling .login(), .logout() etc.
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (token) {
      authApi
        .me()
        .then((res: any) => {
          setUser(res.data);
          // Warm reference data immediately after session restore so the
          // first navigation feels instant. Gated by the restored user's role
          // so a master never fires owner-only boot requests.
          prefetchAfterLogin(queryClient, res.data as User);
        })
        .catch((err: any) => {
          // Only clear the token on a genuine auth failure (401/403).
          // Network errors, 5xx, or transient SW offline responses must NOT
          // log the user out — otherwise a 1-second network blip kicks them
          // back to the login screen.
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            localStorage.removeItem('token');
            setToken(null);
          } else {
            console.warn('Failed to fetch user (kept session):', status, err?.message);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, queryClient]);

  const login = async (phone: string, password: string) => {
    const res = await authApi.login({ phone, password });
    const { token: t, user: u } = res.data;

    // Cross-tenant safety: `logout()` is the normal off-boarding path, but a
    // crash / kill / 401 hard-redirect can leave the previous user's data in
    // the in-memory cache, the persist IndexedDB store, or the SW API cache.
    // Start every layer empty BEFORE we write user B's token and prefetch
    // B's data, so A's payloads can never bleed into B's session.
    await queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
    await clearPersistentCache();
    await purgeApiCache();
    // Ту же логику — офлайн-очереди мутаций SW: недоигранные POST'ы прошлой
    // сессии (после краша/убитой вкладки) нельзя переиграть под токеном
    // нового пользователя — это запись в чужой тенант.
    await purgeOfflineQueues();

    localStorage.setItem('token', t);
    setToken(t);
    setUser(u);
    // Prefetch dashboards/lists in the background — by the time the user
    // navigates to /products or /clients, the cache is already warm. Gated by
    // the logged-in user's role (mirrors mobile) so a master never fires
    // owner-only requests that would 401/403 right after login.
    prefetchAfterLogin(queryClient, u);
  };

  const refreshUser = async () => {
    try {
      const res = await authApi.me();
      setUser(res.data);
    } catch (err) {
      console.warn('Failed to refresh user:', err);
    }
  };

  const logout = () => {
    authApi.logout().catch(() => {});

    // ── Cross-tenant isolation ────────────────────────────────────────────
    // On a shared browser/kiosk the next user must not see ANY of this user's
    // data. We tear down every cache layer that could survive a logout:
    //
    //   1. cancelQueries() — abort in-flight refetches so a late response can't
    //      land after teardown and resurrect a stale entry under the next
    //      session (the same fix mobile shipped in commit 0a741a9).
    //   2. queryClient.clear() — drop the in-memory React Query cache.
    //   3. clearPersistentCache() — delete the dehydrated snapshot in the
    //      `@tanstack/react-query-persist-client` IndexedDB store, otherwise it
    //      rehydrates into the next session.
    //   4. purgeApiCache() — drop the service worker's `autexa-api-*` Cache
    //      Storage, which is keyed by URL only (ignores Authorization) and
    //      would otherwise serve tenant A's `/api` payloads to tenant B.
    //   5. purgeOfflineQueues() — drop the SW offline-mutation queue AND the
    //      failed-mutation archive in IndexedDB `autexa-sw`. Queued records
    //      carry no Authorization (SW v14): replay uses the CURRENT session's
    //      token, so a leftover queue would post this user's mutations into
    //      the NEXT user's tenant.
    //
    // Steps 1–2 are synchronous and run before we clear the token, so nothing
    // stale is in memory by the time the redirect to /login fires. Steps 3–5
    // are async best-effort; we run them but don't block the redirect.
    void queryClient.cancelQueries().catch(() => {});
    queryClient.clear();
    void clearPersistentCache();
    void purgeApiCache();
    void purgeOfflineQueues();

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  const hasPermission = (perm: keyof UserPermissions): boolean => {
    if (!user) return false;
    // Байпас ТОЛЬКО для superadmin/director («Директор всегда полные права»).
    // admin НЕ байпасит: он живёт по permissions из /auth/me — сервер отдаёт
    // эффективные права из матрицы назначенной роли (волна «права как в
    // Битрикс24»: admin снят и из серверного OWNER_CLASS_ROLES). После правки
    // роли клиент должен рефетчить /auth/me (см. refreshUser в RolesManagement).
    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.DIRECTOR) return true;
    return !!user.permissions?.[perm];
  };

  const isRole = (...roles: UserRole[]): boolean => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser, hasPermission, isRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
