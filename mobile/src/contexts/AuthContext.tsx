import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../api/services';
import { onAuthExpired, initServerUrl, isServerConfigured, setServerUrl, getSavedServerUrl } from '../api/axios';
import type { User, UserPermissions, UserRole } from '../../../shared/types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  serverConfigured: boolean;
  serverUrl: string;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
  configureServer: (url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [serverUrl, setServerUrlState] = useState('');

  // Initialize server URL, then load token
  useEffect(() => {
    (async () => {
      const hasServer = await initServerUrl();
      const saved = await getSavedServerUrl();
      setServerUrlState(saved);
      setServerConfigured(hasServer);

      if (hasServer) {
        const stored = await AsyncStorage.getItem('token');
        if (stored) {
          setToken(stored);
          try {
            const res = await authApi.me();
            setUser(res.data);
          } catch {
            await AsyncStorage.removeItem('token');
            setToken(null);
          }
        }
      }
      setLoading(false);
    })();
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

  const configureServer = async (url: string) => {
    if (!url) {
      // Reset server config
      setServerUrlState('');
      setServerConfigured(false);
      setUser(null);
      setToken(null);
      return;
    }
    await setServerUrl(url);
    setServerUrlState(url);
    setServerConfigured(true);
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
    <AuthContext.Provider value={{ user, token, loading, serverConfigured, serverUrl, login, logout, refreshUser, hasPermission, isRole, configureServer }}>
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
