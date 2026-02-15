import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { User, UserPermissions } from '../types';
import { authApi } from '../api/services';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (perm: keyof UserPermissions) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  // Track whether login() just set the token to avoid double-fetch
  const loginInProgressRef = useRef(false);

  useEffect(() => {
    // If login() just set the token and user, skip the profile fetch
    if (loginInProgressRef.current) {
      loginInProgressRef.current = false;
      setIsLoading(false);
      return;
    }

    if (token) {
      authApi
        .getProfile()
        .then((res) => {
          setUser(res.data);
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token]);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await authApi.login({ phone, password });
    const { access_token, user: u } = res.data;

    // Mark that we're setting token from login (user data already available)
    loginInProgressRef.current = true;

    localStorage.setItem('token', access_token);
    localStorage.setItem('user', JSON.stringify(u));
    setToken(access_token);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const hasPermission = useCallback(
    (perm: keyof UserPermissions) => {
      if (!user) return false;
      if (user.role === 'superadmin' || user.role === 'director') return true;
      return !!user.permissions?.[perm];
    },
    [user],
  );

  const isSuperAdmin = user?.role === 'superadmin';

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isSuperAdmin, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
