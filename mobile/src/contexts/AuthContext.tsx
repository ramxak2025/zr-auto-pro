import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../api/services';
import { onAuthExpired } from '../api/axios';
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

export function AuthProvider({ children }: { children: ReactNode }) {
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
          .then((res) => setUser(res.data))
          .catch(() => {
            AsyncStorage.removeItem('token');
            setToken(null);
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  // Listen for 401 events from axios interceptor
  useEffect(() => {
    return onAuthExpired(() => {
      setToken(null);
      setUser(null);
    });
  }, []);

  const login = async (phone: string, password: string) => {
    const res = await authApi.login({ phone, password });
    const { token: t, user: u } = res.data;
    await AsyncStorage.setItem('token', t);
    setToken(t);
    setUser(u);
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
    await AsyncStorage.removeItem('token');
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
