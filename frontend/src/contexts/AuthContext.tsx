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

/**
 * Warm the React Query cache with data the user is likely to open next.
 *
 * Runs in the background after login / session restore. Failures are silent —
 * this is a perf optimization, not a contract. Screens still fetch their own
 * data via useQuery if prefetch lost the race.
 *
 * Mirrors `prefetchAfterLogin` in `mobile/src/contexts/AuthContext.tsx` so
 * web and mobile feel equally fast on first navigation.
 */
function prefetchAfterLogin(qc: QueryClient): void {
  const limit = 50;
  type PrefetchPair = [unknown[], () => Promise<unknown>];
  const pairs: PrefetchPair[] = [
    [
      ['products', { page: 1, limit, search: '' }],
      () => productsApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ],
    [
      ['services', { page: 1, limit, search: '' }],
      () => servicesApi.getAll({ page: 1, limit, search: '' }).then((r: { data: unknown }) => r.data),
    ],
    [
      ['clients', { search: '', page: 1, limit: 20 }],
      () => clientsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ],
    [
      ['cars', { search: '', page: 1, limit: 20 }],
      () => carsApi.getAll({ search: '', page: 1, limit: 20 }).then((r: { data: unknown }) => r.data),
    ],
    [['users'], () => usersApi.getAll().then((r: { data: unknown }) => r.data)],
    [['warehouse-categories'], () => warehouseCategoriesApi.getAll().then((r: { data: unknown }) => r.data)],
    [['subscription'], () => subscriptionApi.get().then((r: { data: unknown }) => r.data)],
  ];
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
          // first navigation feels instant.
          prefetchAfterLogin(queryClient);
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
    localStorage.setItem('token', t);
    setToken(t);
    setUser(u);
    // Prefetch dashboards/lists in the background — by the time the user
    // navigates to /products or /clients, the cache is already warm.
    prefetchAfterLogin(queryClient);
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
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const hasPermission = (perm: keyof UserPermissions): boolean => {
    if (!user) return false;
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
