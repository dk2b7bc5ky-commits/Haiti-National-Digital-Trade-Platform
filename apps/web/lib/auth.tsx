'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthContext as AuthContextData, LoginResponse } from '@rezo/shared-types';
import { apiFetch } from './api';

const TOKEN_KEY = 'rezo_token';

interface AuthState {
  loading: boolean;
  token: string | null;
  auth: AuthContextData | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthContextData | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate from a stored token on first load.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    apiFetch<AuthContextData>('/auth/me', { token: stored })
      .then((data) => setAuth(data))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setAuth({ user: res.user, org: res.org, permissions: res.permissions });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAuth(null);
  }, []);

  const value = useMemo(
    () => ({ loading, token, auth, login, logout }),
    [loading, token, auth, login, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
