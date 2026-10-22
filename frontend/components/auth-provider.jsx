'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { requestJson } from '@/lib/api-client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const payload = await requestJson('/api/v1/auth/session');
      setUser(payload.user ?? null);
      return payload.user ?? null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshSession(); }, [refreshSession]);

  const signIn = useCallback(async (credentials) => {
    const payload = await requestJson('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    setUser(payload.user);
    return payload.user;
  }, []);

  const signUp = useCallback(async (credentials) => {
    const payload = await requestJson('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    setUser(payload.user);
    return payload.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await requestJson('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut, refreshSession }), [user, loading, signIn, signUp, signOut, refreshSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
