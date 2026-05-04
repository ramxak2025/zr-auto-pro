import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import {
  authApi,
  productsApi,
  servicesApi,
  usersApi,
  warehouseCategoriesApi,
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
}

export function AuthProvider({ children, queryClient }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load token on mount
  useEffect(() => {
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
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
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
