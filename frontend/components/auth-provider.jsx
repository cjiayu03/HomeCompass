'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, requestJson } from '@/lib/api-client';

const AuthContext = createContext(null);
const AUTH_CHANGE_KEY = 'homecompass:auth-change';

function emitTransition(phase) {
  window.dispatchEvent(new CustomEvent('homecompass:auth-transition', { detail: { phase } }));
}

function publishAuthChange(phase, id) {
  try {
    window.localStorage.setItem(AUTH_CHANGE_KEY, JSON.stringify({ phase, id, at: Date.now() }));
  } catch { /* Authentication still works when browser storage is disabled. */ }
}

function responseUser(payload, allowGuest = false) {
  if (allowGuest && payload?.user === null) return null;
  const nextUser = payload?.user;
  if (!nextUser || typeof nextUser.id !== 'string' || !nextUser.id
    || typeof nextUser.email !== 'string' || !nextUser.email) {
    throw new ApiError('The account response was incomplete. Please try again.', { code: 'INVALID_RESPONSE' });
  }
  return nextUser;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [focusChecking, setFocusChecking] = useState(false);
  const [sessionVerified, setSessionVerified] = useState(false);
  const verifiedRef = useRef(false);
  const userRef = useRef(null);
  const epochRef = useRef(0);
  const sessionReadRef = useRef(null);
  const mutationQueueRef = useRef(Promise.resolve());
  const pendingMutationsRef = useRef(0);
  const transitionsRef = useRef(0);
  const mountedRef = useRef(true);
  const deferredRefreshRef = useRef(false);
  const localBatchRef = useRef(null);

  const updateVerification = useCallback((verified) => {
    verifiedRef.current = verified;
    if (mountedRef.current) setSessionVerified(verified);
  }, []);

  const updateUser = useCallback((nextUser) => {
    userRef.current = nextUser;
    if (mountedRef.current) setUser(nextUser);
    updateVerification(true);
  }, [updateVerification]);

  const invalidateSessionRead = useCallback(() => {
    epochRef.current += 1;
    sessionReadRef.current?.controller.abort();
    sessionReadRef.current = null;
  }, []);

  const beginTransition = useCallback(() => {
    transitionsRef.current += 1;
    if (transitionsRef.current === 1 && mountedRef.current) {
      setTransitioning(true);
      emitTransition('start');
    }
  }, []);

  const endTransition = useCallback(() => {
    transitionsRef.current -= 1;
    if (transitionsRef.current === 0 && mountedRef.current) {
      setTransitioning(false);
      emitTransition('end');
    }
  }, []);

  const refreshSession = useCallback(() => {
    // Auth mutations own the cookie until their responses finish, in order.
    if (pendingMutationsRef.current) {
      deferredRefreshRef.current = true;
      return Promise.resolve(userRef.current);
    }
    if (sessionReadRef.current) return sessionReadRef.current.promise;
    updateVerification(false);
    const epoch = epochRef.current;
    const controller = new AbortController();
    const read = { controller, promise: null };
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    read.promise = (async () => {
      try {
        const payload = await requestJson('/api/v1/auth/session', { cache: 'no-store', signal: controller.signal });
        const nextUser = responseUser(payload, true);
        if (mountedRef.current && epochRef.current === epoch && !controller.signal.aborted) {
          updateUser(nextUser);
        }
        return userRef.current;
      } catch {
        // Connectivity or storage failures do not prove that a session expired.
        return userRef.current;
      } finally {
        window.clearTimeout(timeout);
        if (sessionReadRef.current === read) sessionReadRef.current = null;
        if (mountedRef.current && epochRef.current === epoch) setLoading(false);
      }
    })();
    sessionReadRef.current = read;
    return read.promise;
  }, [updateUser, updateVerification]);

  useEffect(() => {
    mountedRef.current = true;
    const remoteTransitions = new Map();
    const reconcileSession = async () => {
      if (remoteTransitions.size) return;
      if (pendingMutationsRef.current) {
        deferredRefreshRef.current = true;
        return;
      }
      invalidateSessionRead();
      beginTransition();
      try { await refreshSession(); } finally { endTransition(); }
    };
    const finishRemoteTransition = async (id) => {
      if (!remoteTransitions.has(id)) return;
      window.clearTimeout(remoteTransitions.get(id));
      remoteTransitions.delete(id);
      try {
        if (!remoteTransitions.size) {
          invalidateSessionRead();
          await refreshSession();
        }
      } finally { endTransition(); }
    };
    const startRemoteTransition = (change) => {
      if (remoteTransitions.has(change.id)) return;
      invalidateSessionRead();
      beginTransition();
      // Recover if a tab closes before it can publish completion.
      const remaining = Math.max(0, Math.min(30_000, 30_000 - (Date.now() - change.at)));
      remoteTransitions.set(change.id, window.setTimeout(() => finishRemoteTransition(change.id), remaining));
    };
    const readChange = (value) => {
      try {
        const change = JSON.parse(value);
        return change && typeof change.id === 'string' && change.id.length < 128
          && Number.isFinite(change.at) && ['start', 'end'].includes(change.phase) ? change : null;
      } catch { return null; }
    };
    const onFocus = () => {
      // Browsers commonly emit both events for one return to the tab. Keep
      // the in-flight check instead of aborting and restarting it.
      if (document.visibilityState === 'visible' && !sessionReadRef.current && !remoteTransitions.size && !pendingMutationsRef.current) {
        setFocusChecking(true);
        reconcileSession().finally(() => { if (mountedRef.current) setFocusChecking(false); });
      }
    };
    const onStorage = (event) => {
      if (event.key !== AUTH_CHANGE_KEY) return;
      setFocusChecking(false);
      const change = readChange(event.newValue);
      if (change?.phase === 'start' && Date.now() - change.at < 30_000) {
        startRemoteTransition(change);
      } else if (change?.phase === 'end' && remoteTransitions.has(change.id)) {
        finishRemoteTransition(change.id);
      } else {
        reconcileSession();
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onFocus);
    let initialChange;
    try { initialChange = readChange(window.localStorage.getItem(AUTH_CHANGE_KEY)); } catch { /* Storage may be disabled. */ }
    if (initialChange?.phase === 'start' && Date.now() - initialChange.at < 30_000) startRemoteTransition(initialChange);
    else refreshSession();
    return () => {
      mountedRef.current = false;
      invalidateSessionRead();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onFocus);
      remoteTransitions.forEach(timer => { window.clearTimeout(timer); endTransition(); });
      remoteTransitions.clear();
    };
  }, [beginTransition, endTransition, invalidateSessionRead, refreshSession]);

  const mutateSession = useCallback((path, credentials) => {
    setFocusChecking(false);
    const interruptedSessionRead = Boolean(sessionReadRef.current);
    const previouslyVerified = verifiedRef.current;
    updateVerification(false);
    invalidateSessionRead();
    if (!pendingMutationsRef.current) {
      localBatchRef.current = `${Date.now()}:${Math.random()}`;
      publishAuthChange('start', localBatchRef.current);
    }
    pendingMutationsRef.current += 1;
    beginTransition();
    const operation = mutationQueueRef.current.catch(() => {}).then(async () => {
      const payload = await requestJson(path, {
        method: 'POST',
        ...(credentials ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) } : {}),
      });
      const nextUser = path.endsWith('/logout') ? null : responseUser(payload);
      updateUser(nextUser);
      return nextUser;
    }).catch(error => {
      // A rejected early login must not hide an existing cookie-backed account.
      if (previouslyVerified && !interruptedSessionRead && error.status >= 400) updateVerification(true);
      else deferredRefreshRef.current = true;
      throw error;
    }).finally(async () => {
      pendingMutationsRef.current -= 1;
      if (mountedRef.current) setLoading(false);
      if (!pendingMutationsRef.current) {
        // Only transition markers are shared; account data stays private.
        const batchId = localBatchRef.current;
        localBatchRef.current = null;
        publishAuthChange('end', batchId);
        if (deferredRefreshRef.current && mountedRef.current) {
          deferredRefreshRef.current = false;
          await refreshSession();
        }
      }
      endTransition();
    });
    mutationQueueRef.current = operation;
    return operation;
  }, [beginTransition, endTransition, invalidateSessionRead, refreshSession, updateUser, updateVerification]);

  const signIn = useCallback(credentials => mutateSession('/api/v1/auth/login', credentials), [mutateSession]);
  const signUp = useCallback(credentials => mutateSession('/api/v1/auth/register', credentials), [mutateSession]);
  const signOut = useCallback(() => mutateSession('/api/v1/auth/logout'), [mutateSession]);

  const value = useMemo(() => ({ user, loading, transitioning, focusChecking, sessionVerified, signIn, signUp, signOut, refreshSession }), [user, loading, transitioning, focusChecking, sessionVerified, signIn, signUp, signOut, refreshSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
