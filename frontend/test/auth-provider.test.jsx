import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../components/auth-provider';

const accountA = { id: 'account-a', email: 'a@example.com' };
const accountB = { id: 'account-b', email: 'b@example.com' };
let auth;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function Probe() {
  auth = useAuth();
  return <output>{JSON.stringify({ user: auth.user, loading: auth.loading, transitioning: auth.transitioning })}</output>;
}

function state() { return JSON.parse(screen.getByRole('status').textContent); }
function mount() { render(<AuthProvider><Probe /></AuthProvider>); }

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('does not let a delayed guest session read overwrite a successful login', async () => {
  const initial = deferred();
  const fetchMock = vi.fn(path => path.endsWith('/session') ? initial.promise : Promise.resolve(json({ user: accountA })));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  const initialSignal = fetchMock.mock.calls[0][1].signal;

  await act(() => auth.signIn({ email: accountA.email, password: 'test-password' }));
  expect(initialSignal.aborted).toBe(true);
  await act(async () => { initial.resolve(json({ user: null })); });

  expect(state()).toEqual({ user: accountA, loading: false, transitioning: false });
});

it('does not restore an old account when a mount-time read finishes after logout', async () => {
  const initial = deferred();
  vi.stubGlobal('fetch', vi.fn(path => path.endsWith('/session') ? initial.promise : Promise.resolve(json({ ok: true }))));
  mount();
  await act(() => auth.signOut());
  await act(async () => { initial.resolve(json({ user: accountA })); });
  expect(state()).toEqual({ user: null, loading: false, transitioning: false });
});

it('serializes login and logout so the last requested operation owns the cookie', async () => {
  const login = deferred();
  const fetchMock = vi.fn(path => {
    if (path.endsWith('/session')) return Promise.resolve(json({ user: null }));
    if (path.endsWith('/login')) return login.promise;
    return Promise.resolve(json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const transitions = [];
  const listener = event => transitions.push(event.detail.phase);
  window.addEventListener('homecompass:auth-transition', listener);
  try {
    mount();
    await waitFor(() => expect(state().loading).toBe(false));
    let loginPromise;
    let logoutPromise;
    act(() => {
      loginPromise = auth.signIn({ email: accountA.email, password: 'test-password' });
      logoutPromise = auth.signOut();
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/login'))).toBe(true));
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/logout'))).toBe(false);
    expect(state().transitioning).toBe(true);
    await act(async () => { login.resolve(json({ user: accountA })); await Promise.all([loginPromise, logoutPromise]); });
    expect(state().user).toBeNull();
    expect(state().transitioning).toBe(false);
    expect(transitions).toEqual(['start', 'end']);
  } finally { window.removeEventListener('homecompass:auth-transition', listener); }
});

it('retains a known account on connectivity failure and recovers on a later refresh', async () => {
  let offline = false;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (offline) throw new TypeError('offline');
    return json({ user: accountA });
  }));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  offline = true;
  await act(() => auth.refreshSession());
  expect(state().user).toEqual(accountA);
  offline = false;
  await act(() => auth.refreshSession());
  expect(state().loading).toBe(false);
});

it('retains a known account when a session response is incomplete', async () => {
  let malformed = false;
  vi.stubGlobal('fetch', vi.fn(async () => json(malformed ? {} : { user: accountA })));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  malformed = true;
  await act(() => auth.refreshSession());
  expect(state().user).toEqual(accountA);
});

it('reconciles an existing cookie when a failed early login interrupted initial hydration', async () => {
  const initial = deferred();
  let sessionReads = 0;
  vi.stubGlobal('fetch', vi.fn(path => {
    if (path.endsWith('/session')) return ++sessionReads === 1 ? initial.promise : Promise.resolve(json({ user: accountA }));
    return Promise.resolve(json({ detail: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }, 401));
  }));
  mount();
  await act(async () => {
    await expect(auth.signIn({ email: accountB.email, password: 'wrong-password' })).rejects.toThrow('Email or password is incorrect.');
  });
  expect(state()).toEqual({ user: accountA, loading: false, transitioning: false });
  await act(async () => { initial.resolve(json({ user: null })); });
  expect(state().user).toEqual(accountA);
});

it('rejects an incomplete login response without publishing an authenticated user', async () => {
  vi.stubGlobal('fetch', vi.fn(async path => json(path.endsWith('/session') ? { user: null } : {})));
  mount();
  await waitFor(() => expect(state().loading).toBe(false));
  await act(async () => {
    await expect(auth.signIn({ email: accountA.email, password: 'test-password' })).rejects.toThrow('The account response was incomplete.');
  });
  expect(state().user).toBeNull();
  expect(state().transitioning).toBe(false);
});

it('keeps the account when logout fails, releases the transition, and allows retry', async () => {
  let failLogout = true;
  vi.stubGlobal('fetch', vi.fn(async path => {
    if (path.endsWith('/session')) return json({ user: accountA });
    return failLogout ? json({ detail: { message: 'Storage unavailable.' } }, 503) : json({ ok: true });
  }));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  await act(async () => { await expect(auth.signOut()).rejects.toThrow('Storage unavailable.'); });
  expect(state().user).toEqual(accountA);
  expect(state().transitioning).toBe(false);
  failLogout = false;
  await act(() => auth.signOut());
  expect(state().user).toBeNull();
});

it('reconciles an account switch signaled by another tab without sharing account data in storage', async () => {
  let session = accountA;
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: session })));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  session = accountB;
  act(() => fireEvent(window, new StorageEvent('storage', { key: 'homecompass:auth-change', newValue: 'changed' })));
  await waitFor(() => expect(state().user).toEqual(accountB));
  expect(state().transitioning).toBe(false);
  expect(window.localStorage.getItem('homecompass:auth-change')).toBeNull();
});

it('holds old account work from the remote mutation start until its cookie change is reconciled', async () => {
  let session = accountA;
  const fetchMock = vi.fn(async () => json({ user: session }));
  vi.stubGlobal('fetch', fetchMock);
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  const signal = phase => fireEvent(window, new StorageEvent('storage', {
    key: 'homecompass:auth-change',
    newValue: JSON.stringify({ phase, id: 'other-tab-login', at: Date.now() }),
  }));
  act(() => signal('start'));
  expect(state().transitioning).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  session = accountB;
  act(() => signal('end'));
  await waitFor(() => expect(state().user).toEqual(accountB));
  expect(state().transitioning).toBe(false);
});

it.each(['storage', 'network', 'malformed'])('keeps account ownership unverified after a failed remote %s check until retry succeeds', async failure => {
  let response = 'initial';
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response === 'initial') return json({ user: accountA });
    if (response === 'recovered') return json({ user: accountB });
    if (failure === 'network') throw new TypeError('offline');
    if (failure === 'malformed') return json({});
    return json({ detail: { code: 'DATABASE_UNAVAILABLE' } }, 503);
  }));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  expect(auth.sessionVerified).toBe(true);
  response = 'failed';
  act(() => fireEvent(window, new StorageEvent('storage', { key: 'homecompass:auth-change', newValue: 'changed-cookie' })));
  await waitFor(() => expect(state().transitioning).toBe(false));
  expect(state().user).toEqual(accountA);
  expect(auth.sessionVerified).toBe(false);
  response = 'recovered';
  await act(() => auth.refreshSession());
  expect(state().user).toEqual(accountB);
  expect(auth.sessionVerified).toBe(true);
});

it('broadcasts the start before sending credentials and completion after receiving the cookie', async () => {
  const order = [];
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
    if (key === 'homecompass:auth-change') order.push(JSON.parse(value).phase);
  });
  vi.stubGlobal('fetch', vi.fn(async path => {
    if (path.endsWith('/session')) return json({ user: null });
    order.push('request');
    return json({ user: accountA });
  }));
  mount();
  await waitFor(() => expect(state().loading).toBe(false));
  await act(() => auth.signIn({ email: accountA.email, password: 'test-password' }));
  expect(order).toEqual(['start', 'request', 'end']);
  expect(storage.mock.calls.every(([, value]) => !value.includes(accountA.email) && !value.includes('test-password'))).toBe(true);
});

it('rechecks the session on focus after another tab signs out', async () => {
  let session = accountA;
  vi.stubGlobal('fetch', vi.fn(async () => json({ user: session })));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  session = null;
  act(() => fireEvent.focus(window));
  await waitFor(() => expect(state().user).toBeNull());
});

it('pauses account work during a focus check until the shared cookie owner is known', async () => {
  const refreshed = deferred();
  let initial = true;
  vi.stubGlobal('fetch', vi.fn(() => {
    if (!initial) return refreshed.promise;
    initial = false;
    return Promise.resolve(json({ user: accountA }));
  }));
  mount();
  await waitFor(() => expect(state().user).toEqual(accountA));
  act(() => fireEvent.focus(window));
  expect(state().transitioning).toBe(true);
  await act(async () => { refreshed.resolve(json({ user: accountB })); });
  expect(state().user).toEqual(accountB);
  expect(state().transitioning).toBe(false);
});

it('reconciles a remote change received during login before ending the transition', async () => {
  const login = deferred();
  let session = null;
  vi.stubGlobal('fetch', vi.fn(path => path.endsWith('/login') ? login.promise : Promise.resolve(json({ user: session }))));
  mount();
  await waitFor(() => expect(state().loading).toBe(false));
  let operation;
  act(() => { operation = auth.signIn({ email: accountA.email, password: 'test-password' }); });
  act(() => fireEvent(window, new StorageEvent('storage', { key: 'homecompass:auth-change', newValue: 'remote' })));
  session = accountB;
  await act(async () => { login.resolve(json({ user: accountA })); await operation; });
  expect(state().user).toEqual(accountB);
  expect(state().transitioning).toBe(false);
});

it('allows login when browser storage is unavailable and never stores account details', async () => {
  vi.stubGlobal('fetch', vi.fn(async path => json({ user: path.endsWith('/session') ? null : accountA })));
  mount();
  await waitFor(() => expect(state().loading).toBe(false));
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage blocked'); });
  await act(() => auth.signIn({ email: accountA.email, password: 'test-password' }));
  expect(state().user).toEqual(accountA);
  expect(storage).toHaveBeenCalledWith('homecompass:auth-change', expect.not.stringContaining(accountA.email));
});
