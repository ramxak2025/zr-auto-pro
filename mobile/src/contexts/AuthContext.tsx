import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import {
  authApi,
  productsApi,
  servicesApi,
  usersApi,
  warehouseCategoriesApi,
  suppliersApi,
  clientsApi,
  carsApi,
  equipmentApi,
  checksApi,
  callsApi,
} from '../api/services';
import { onAuthExpired } from '../api/axios';
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

  qc.prefetchQuery({
    queryKey: ['warehouse-categories'],
    queryFn: async () => (await warehouseCategoriesApi.getAll()).data,
    staleTime: 10 * 60_000,
  }).catch(() => {});

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
  // slowly with a flash of empty. Match the EXACT default query key
  // that ChecksScreen uses for the first page with no filters:
  //   ['checks', page=1, search='', dateFrom='', dateTo='', masterId='']
  // so the prefetch result lands directly in the slot the screen
  // reads from. Persistent cache (PERSISTED_KEYS) takes over on
  // cold start; this prefetch warms the slot the first time.
  qc.prefetchQuery({
    queryKey: ['checks', 1, '', '', '', ''],
    queryFn: async () => {
      const res = await checksApi.getAll({ page: 1, limit: 20 });
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
}

export function AuthProvider({ children, queryClient, onAuthResolve }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load token on mount
  useEffect(() => {
    const finish = () => {
      setLoading(false);
      onAuthResolve?.();
    };
    AsyncStorage.getItem('token').then((stored) => {
      if (stored) {
        setToken(stored);
        authApi
          .me()
          .then((res: any) => {
            setUser(res.data);
            // Token still valid — kick off prefetch for warm session
            if (queryClient) prefetchAfterLogin(queryClient);
          })
          .catch(() => {
            AsyncStorage.removeItem('token');
            setToken(null);
          })
          .finally(finish);
      } else {
        finish();
      }
    });
    // onAuthResolve is captured intentionally — we only fire it for the
    // initial mount cycle, not on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  // Listen for 401 events from axios interceptor
  useEffect(() => {
    return onAuthExpired(() => {
      setToken(null);
      setUser(null);
      // Clear persistent cache so the next login starts fresh
      clearPersistentCache().catch(() => {});
      queryClient?.clear();
    });
  }, [queryClient]);

  const login = async (phone: string, password: string) => {
    const res = await authApi.login({ phone, password });
    const { token: t, user: u } = res.data;
    await AsyncStorage.setItem('token', t);
    setToken(t);
    setUser(u);
    if (queryClient) prefetchAfterLogin(queryClient);
  };

  const refreshUser = async () => {
    try {
      const res = await authApi.me();
      setUser(res.data);
    } catch {
      // ignore
    }
  };

  const logout = async () => {
    authApi.logout().catch(() => {});
    await AsyncStorage.removeItem('token');
    await clearPersistentCache().catch(() => {});
    queryClient?.clear();
    setToken(null);
    setUser(null);
  };

  const hasPermission = (perm: keyof UserPermissions): boolean => {
    if (!user) return false;
    if (user.role === 'superadmin' || user.role === 'director') return true;
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
