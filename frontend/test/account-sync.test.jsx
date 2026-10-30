import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { defaultBrief } from '../lib/data.js';
import AccountPage from '../app/(workspace)/account/page.jsx';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(() => ({ user: null })) }));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/components/ui/number-ticker', () => ({ NumberTicker: ({ value }) => <span>{value}</span> }));

const homeA = {
  id: 'home-a',
  address: '10 Example Street',
  town: 'Bishan',
  price: 500000,
  type: '4-room',
  score: 76,
  source: 'Official source record',
  sourceUpdated: '2026-10-01',
  highlights: ['Near a school'],
  risks: [],
};
const homeB = { ...homeA, id: 'home-b', address: '20 Example Street', score: 82 };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

const mergedResult = {
  accepted: {
    briefFields: ['adults', 'budget_cents'],
    shortlistHomeIds: 1,
    compareHomeIds: ['home-b'],
    history: 1,
    places: 0,
  },
  skipped: {
    briefFields: ['children'],
    shortlistHomeIds: 0,
    history: 0,
    retryableHistoryIndexes: [],
    places: 0,
  },
  conflicts: [{ field: 'brief.children', resolution: 'account_preserved' }],
  syncKey: 'server-recorded-key',
};

function authenticatedFetch({ shortlist = [], sync, shortlistMutation, aiInterpret, search } = {}) {
  const auth = { user: { id: 'user-1', email: 'family@example.com' } };
  auth.refreshSession = vi.fn(async () => auth.user);
  useAuthMock.mockReturnValue(auth);

  const fetchMock = vi.fn(async (url, options = {}) => {
    const path = new URL(url, 'http://homecompass.test').pathname;
    if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return sync ? sync(url, options) : json(mergedResult);
    if (path === '/api/v1/ai/interpret') return aiInterpret ? aiInterpret(url, options) : json({ filters: { query: 'interpreted' } });
    if (path === '/api/v1/search') return search ? search(url, options) : json({ items: [] });
    if (path === '/api/v1/shortlists' && (!options.method || options.method === 'GET')) return json({ items: typeof shortlist === 'function' ? shortlist() : shortlist });
    if (path.startsWith('/api/v1/shortlists') && options.method !== 'GET') {
      return shortlistMutation ? shortlistMutation(url, options) : json({});
    }
    if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
    if (path === '/api/v1/profile') {
      return json({ adults: 2, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
    }
    if (path === '/api/v1/places') return json({ items: [] });
    if (path === '/api/v1/homes') return json({ items: [homeA, homeB] });
    if (path.startsWith('/api/v1/resources')) return json({ features: [] });
    if (path === '/api/v1/sources') return json({ items: [] });
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.auth = auth;
  return fetchMock;
}

function Probe({ snapshots }) {
  const workspace = useWorkspace();
  const state = {
      syncState: workspace.syncState,
      syncResult: workspace.syncResult,
      briefAdults: workspace.brief.adults,
      shortlistIds: workspace.shortlistIds,
      compareIds: workspace.compareIds,
      homes: workspace.homes.map((home) => home.id),
      query: workspace.query,
      homeState: workspace.homeState,
      pagination: workspace.pagination,
      busy: workspace.busy,
      places: workspace.places.map((place) => place.id),
      placeState: workspace.placeState,
      notice: workspace.notice,
  };
  snapshots?.push(state);
  return <>
    <output data-testid="workspace">{JSON.stringify(state)}</output>
    <button onClick={() => workspace.toggleShortlist(homeB)}>Toggle home B</button>
    <button onClick={() => workspace.toggleShortlist(homeA)}>Toggle home A</button>
    <button onClick={() => workspace.reorderShortlist(['home-b', 'home-a'])}>Move home B up</button>
    <button onClick={() => { workspace.setQuery('A query'); workspace.applySearch('A query'); }}>Search A query</button>
    <button onClick={() => workspace.syncGuestData()}>Retry sync</button>
    <button onClick={() => workspace.syncGuestData({ confirmPlaces: true })}>Confirm place sync</button>
  </>;
}

function readWorkspace() {
  return JSON.parse(screen.getByTestId('workspace').textContent);
}

function renderWorkspace() {
  render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
  return readWorkspace;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ user: null });
});

describe('guest account synchronization', () => {
  it('does not upload retained account A data while cookie ownership is unverified, then hydrates B separately', async () => {
    const history = [{ mode: 'structured', criteria: { query: 'Account A private query', limit: 20 } }];
    window.localStorage.setItem('homecompass.account.user-1.workspace', JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: [], compareIds: [], pendingHistory: history,
    }));
    const fetchMock = authenticatedFetch();
    useAuthMock.mockReturnValue({ ...fetchMock.auth, sessionVerified: false });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    expect(readWorkspace().briefAdults).toBe(defaultBrief.adults);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/v1/sync/guest'))).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);

    useAuthMock.mockReturnValue({ ...fetchMock.auth, user: { id: 'user-2', email: 'b@example.com' }, sessionVerified: true });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('synced'));
    const requests = fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/v1/sync/guest'));
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0][1].body).history).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);
    await waitFor(() => expect(readWorkspace().briefAdults).toBe(2));
  });

  it('silently aborts an old-owner sync on auth transition and starts a fresh retry', async () => {
    let firstSignal;
    let syncCalls = 0;
    authenticatedFetch({
      sync: (_url, options) => {
        syncCalls += 1;
        if (syncCalls > 1) return json(mergedResult);
        firstSignal = options.signal;
        return new Promise((_resolve, reject) => {
          firstSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
    });
    renderWorkspace();
    await waitFor(() => expect(firstSignal).toBeDefined());
    fireEvent(window, new CustomEvent('homecompass:auth-transition', { detail: { phase: 'start' } }));
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(readWorkspace().syncState).toBe('error'));
    expect(readWorkspace().notice?.text || '').not.toMatch(/session expired/i);

    fireEvent(window, new CustomEvent('homecompass:auth-transition', { detail: { phase: 'end' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => expect(readWorkspace().syncState).toBe('synced'));
    expect(syncCalls).toBe(2);
    expect(readWorkspace().notice?.text || '').not.toMatch(/session expired/i);
  });

  it('clears an account warning after logout while keeping guest data pending', async () => {
    const history = [{ mode: 'structured', criteria: { query: 'Bishan', limit: 20 } }];
    window.localStorage.setItem('homecompass.guest-sync-pending', JSON.stringify({
      brief: { adults: 3 },
      shortlistHomeIds: ['home-a'],
      compareHomeIds: [],
      history,
      places: [],
    }));
    authenticatedFetch({ sync: () => json({ detail: { code: 'INVALID_SESSION' } }, 401) });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('error'));
    expect(readWorkspace().notice.text).toMatch(/session expired/i);
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);
    expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).shortlistHomeIds).toEqual(['home-a']);

    useAuthMock.mockReturnValue({ user: null });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace()).toMatchObject({ syncState: 'local', notice: null }));
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);
    expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).shortlistHomeIds).toEqual(['home-a']);
  });

  it('does not carry account A workspace data or its warning into account B', async () => {
    window.localStorage.setItem('homecompass.account.user-1.workspace', JSON.stringify({
      brief: { ...defaultBrief, adults: 5, budget: 700000 },
      shortlistIds: ['home-a'],
      compareIds: [],
      decisionHomes: [homeA],
    }));
    let syncAttempts = 0;
    const fetchMock = authenticatedFetch({
      shortlist: () => useAuthMock().user?.id === 'user-1' ? [homeA] : [],
      sync: () => {
        syncAttempts += 1;
        return syncAttempts === 1 ? json({ detail: { code: 'INVALID_SESSION' } }, 401) : json(mergedResult);
      },
    });
    const accountA = fetchMock.auth;
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('error'));
    expect(readWorkspace().notice.text).toMatch(/session expired/i);

    const accountB = {
      ...accountA,
      user: { id: 'user-2', email: 'other-family@example.com' },
      refreshSession: vi.fn(async () => ({ id: 'user-2', email: 'other-family@example.com' })),
    };
    useAuthMock.mockReturnValue(accountB);
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('synced'));
    await waitFor(() => expect(readWorkspace().briefAdults).toBe(2));
    expect(readWorkspace().shortlistIds).toEqual([]);
    expect(readWorkspace().notice?.text || '').not.toMatch(/session expired/i);
    const syncRequests = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(syncRequests).toHaveLength(2);
    expect(JSON.parse(syncRequests[1][1].body).shortlistHomeIds).not.toContain('home-a');
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).shortlistIds).toEqual(['home-a']);
  });

  it('submits the pre-hydration guest snapshot once with a stable key and reports merge results', async () => {
    const guestBrief = {
      ...defaultBrief,
      adults: 3,
      children: 2,
      budget: 690000,
      requirements: { budget: true },
      priorityWeights: { school: 3, childcare: 1, care: 2, affordability: 0 },
    };
    const guestHistory = [{
      mode: 'structured',
      criteria: { query: 'Bishan', limit: 20 },
      sourceSnapshotIds: ['8f195e5d-a27f-4c16-9d6c-dc98f08b5e50'],
      scoringVersion: 'home-fit-v1',
    }];
    window.localStorage.setItem('family-brief', JSON.stringify(guestBrief));
    window.localStorage.setItem('shortlist', JSON.stringify(['home-b']));
    window.localStorage.setItem('compare-selection', JSON.stringify(['home-b']));
    window.localStorage.setItem('search-history', JSON.stringify(guestHistory));
    window.localStorage.setItem('personal-places', JSON.stringify([{
      label: 'Work', address: '1 Harbour Road', latitude: 1.29, longitude: 103.85,
    }]));
    const fetchMock = authenticatedFetch({ shortlist: [homeB] });
    const signedInAuth = fetchMock.auth;
    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).history).toEqual(guestHistory));
    useAuthMock.mockReturnValue(signedInAuth);
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);

    await waitFor(() => expect(state().syncState).toBe('synced'));
    const syncCalls = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(syncCalls).toHaveLength(1);
    const request = JSON.parse(syncCalls[0][1].body);
    expect(request).toMatchObject({
      brief: {
        adults: 3,
        children: 2,
        olderAdults: guestBrief.olderAdults,
        budgetCents: 69000000,
        priorityWeights: guestBrief.priorityWeights,
      },
      shortlistHomeIds: ['home-b'],
      compareHomeIds: ['home-b'],
      history: guestHistory,
      confirmPlaces: false,
      confirmBrief: false,
    });
    expect(request.sync_key).toMatch(/^guest-[A-Za-z0-9-]+$/);
    expect(window.localStorage.getItem('homecompass.guest-sync-key')).toBe(request.sync_key);
    expect(request).not.toHaveProperty('places');
    expect(state().notice.text).toMatch(/5 items accepted/i);
    expect(state().notice.text).toMatch(/1 item skipped/i);
    expect(state().notice.text).toMatch(/1 conflict|conflict.*1/i);
  });

  it('keeps a failed merge local and retries it with the same idempotency key', async () => {
    window.localStorage.setItem('shortlist', JSON.stringify(['home-a']));
    let attempts = 0;
    const fetchMock = authenticatedFetch({
      shortlist: [homeA],
      sync: () => {
        attempts += 1;
        return attempts === 1 ? json({ detail: { code: 'AUTH_REQUIRED' } }, 401) : json(mergedResult);
      },
    });
    const signedInAuth = fetchMock.auth;
    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).shortlistHomeIds).toEqual(['home-a']));
    useAuthMock.mockReturnValue(signedInAuth);
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);

    await waitFor(() => expect(state().syncState).toBe('error'));
    const failedRequest = fetchMock.mock.calls.find(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    const failedKey = JSON.parse(failedRequest[1].body).sync_key;
    expect(state().shortlistIds).toEqual(['home-a']);
    expect(state().notice.text).toMatch(/session expired|sign in again/i);
    expect(state().notice.text).toMatch(/retry/i);

    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => expect(state().syncState).toBe('synced'));
    const requests = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1][1].body).sync_key).toBe(failedKey);
  });

  it('keeps skipped history pending and gives the next completed attempt a new idempotency key', async () => {
    const history = [{ mode: 'structured', criteria: { query: 'Bishan', limit: 20 } }];
    window.localStorage.setItem('search-history', JSON.stringify(history));
    let attempts = 0;
    const fetchMock = authenticatedFetch({
      sync: () => {
        attempts += 1;
        return json(attempts === 1
          ? { ...mergedResult, accepted: { ...mergedResult.accepted, history: 0 }, skipped: { ...mergedResult.skipped, history: 1, retryableHistoryIndexes: [0] } }
          : { ...mergedResult, accepted: { ...mergedResult.accepted, history: 1 }, skipped: { ...mergedResult.skipped, history: 0, retryableHistoryIndexes: [] } });
      },
    });
    const signedInAuth = fetchMock.auth;
    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).history).toEqual(history));
    useAuthMock.mockReturnValue(signedInAuth);
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);

    await waitFor(() => expect(state().syncState).toBe('synced'));
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);
    expect(window.localStorage.getItem('homecompass.guest-sync-pending')).toBeNull();
    expect(window.localStorage.getItem('search-history')).toBeNull();
    const firstSync = fetchMock.mock.calls.find(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    const firstKey = JSON.parse(firstSync[1].body).sync_key;

    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
    await waitFor(() => expect(attempts).toBe(2));
    const syncRequests = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(JSON.parse(syncRequests[1][1].body).history).toEqual(history);
    expect(JSON.parse(syncRequests[1][1].body).sync_key).not.toBe(firstKey);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toBeUndefined());
  });

  it('keeps only retryable mixed history in A and restores it only for A after B signs in', async () => {
    const acceptedEntry = { mode: 'structured', criteria: { query: 'Bishan', limit: 20 } };
    const retryableEntry = {
      mode: 'structured',
      criteria: { query: 'near my saved place', place_constraints: [{ place_id: 'a-place', max_distance_m: 1000 }] },
    };
    const history = [acceptedEntry, retryableEntry, acceptedEntry];
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem('search-history', JSON.stringify(history));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    const syncPayloads = [];
    let accountAAttempts = 0;
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') {
        const payload = JSON.parse(options.body);
        const ownerId = useAuthMock().user?.id ?? null;
        syncPayloads.push({ ownerId, ...payload });
        if (ownerId === 'user-a' && accountAAttempts++ === 0) {
          return json({
            accepted: { history: 1 },
            skipped: { history: 2, retryableHistoryIndexes: [1] },
            conflicts: [],
          });
        }
        return json({
          accepted: { history: payload.history.length },
          skipped: { history: 0, retryableHistoryIndexes: [] },
          conflicts: [],
        });
      }
      if (path === '/api/v1/shortlists') return json({ items: [] });
      if (path === '/api/v1/profile') return json({ adults: 2, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') return json({ items: [] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).history).toEqual(history));

    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(syncPayloads.some((payload) => payload.ownerId === 'user-a')).toBe(true));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).pendingHistory).toEqual([retryableEntry]));
    expect(syncPayloads.find((payload) => payload.ownerId === 'user-a').history).toEqual(history);
    expect(readWorkspace().notice.text).toMatch(/2 items skipped/i);
    expect(window.localStorage.getItem('homecompass.guest-sync-pending')).toBeNull();
    expect(window.localStorage.getItem('search-history')).toBeNull();

    useAuthMock.mockReturnValue({ user: null });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('local'));

    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(syncPayloads.some((payload) => payload.ownerId === 'user-b')).toBe(true));
    expect(syncPayloads.find((payload) => payload.ownerId === 'user-b').history).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).pendingHistory).toEqual([retryableEntry]);

    useAuthMock.mockReturnValue({ user: null });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().syncState).toBe('local'));
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(syncPayloads.filter((payload) => payload.ownerId === 'user-a')).toHaveLength(2));
    const accountARetry = syncPayloads.filter((payload) => payload.ownerId === 'user-a')[1];
    expect(accountARetry.history).toEqual([retryableEntry]);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).pendingHistory).toBeUndefined());
  });

  it('uses cookie credentials when interpreting a signed-in natural-language search', async () => {
    let interpretationRequest;
    let searchRequest;
    authenticatedFetch({
      aiInterpret: (url, options) => {
        interpretationRequest = { url, options };
        return json({ filters: { query: 'Bishan' } });
      },
      search: (url, options) => {
        searchRequest = { url, options };
        return json({ items: [] });
      },
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    fireEvent.click(screen.getByRole('button', { name: 'Search A query' }));
    await waitFor(() => expect(searchRequest && JSON.parse(searchRequest.options.body).query).toBe('A query'));

    expect(interpretationRequest.options.credentials).toBe('include');
    expect(interpretationRequest.options.headers?.Authorization).toBeUndefined();
    expect(JSON.parse(interpretationRequest.options.body)).toEqual({ text: 'A query' });
    expect(JSON.parse(searchRequest.options.body).query).toBe('A query');
  });

  it('shows sign-in-again guidance when signed-in AI interpretation returns AUTH_REQUIRED', async () => {
    let interpretationRequest;
    let searches = 0;
    authenticatedFetch({
      aiInterpret: (url, options) => {
        interpretationRequest = { url, options };
        return json({ detail: { code: 'AUTH_REQUIRED' } }, 401);
      },
      search: () => {
        searches += 1;
        return json({ items: [] });
      },
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    await waitFor(() => expect(searches > 0 && !state().busy).toBe(true));
    const initialSearches = searches;
    fireEvent.click(screen.getByRole('button', { name: 'Search A query' }));
    await waitFor(() => expect(state().notice?.text).toMatch(/session expired|sign in again/i));

    expect(interpretationRequest.options.credentials).toBe('include');
    expect(interpretationRequest.options.headers?.Authorization).toBeUndefined();
    expect(searches).toBe(initialSearches);
  });

  it('shows sign-in-again guidance for a signed-in AI HTTP 401 without an error code', async () => {
    authenticatedFetch({
      aiInterpret: () => json({ detail: { message: 'Unauthorized' } }, 401),
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    fireEvent.click(screen.getByRole('button', { name: 'Search A query' }));
    await waitFor(() => expect(state().notice?.text).toMatch(/session expired|sign in again/i));
  });

  it('keeps the typed-word fallback for guests when AI interpretation requires authentication', async () => {
    let searchRequest;
    authenticatedFetch({
      aiInterpret: () => json({ detail: { code: 'AUTH_REQUIRED' } }, 401),
      search: (url, options) => {
        searchRequest = { url, options };
        return json({ items: [] });
      },
    });
    useAuthMock.mockReturnValue({ user: null });
    const state = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Search A query' }));
    await waitFor(() => expect(searchRequest).not.toBeUndefined());

    expect(JSON.parse(searchRequest.options.body).query).toBe('A query');
    expect(state().notice.text).toMatch(/phrase interpretation is unavailable/i);
  });

  it('hides A workspace state during switching and ignores A hydration JSON after B is active', async () => {
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountWorkspaceKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: ['home-a'], compareIds: ['home-a'],
    }));
    window.localStorage.setItem(accountWorkspaceKey('user-b'), JSON.stringify({
      brief: { ...defaultBrief, adults: 7 }, shortlistIds: ['home-b'], compareIds: ['home-b'],
    }));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    let resolveAShortlist;
    let aShortlistJsonStarted = false;
    const savedPlaceA = { id: 'place-a', label: 'A home', address: 'A address', latitude: 1.2, longitude: 103.8, kind: 'workplace' };
    const savedPlaceB = { id: 'place-b', label: 'B home', address: 'B address', latitude: 1.3, longitude: 103.9, kind: 'workplace' };
    const delayedJson = (start, setResolver) => ({
      ok: true,
      json: () => {
        start();
        return new Promise((resolve) => { setResolver(resolve); });
      },
    });
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
      if (path === '/api/v1/shortlists') {
        if (ownerId === 'user-a') {
          return delayedJson(() => { aShortlistJsonStarted = true; }, (resolve) => { resolveAShortlist = resolve; });
        }
        return json({ items: ownerId === 'user-b' ? [homeB] : [] });
      }
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile') {
        if (ownerId === 'user-a') return json({ adults: 5, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
        return json({ adults: 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      }
      if (path === '/api/v1/places') return json({ items: ownerId === 'user-a' ? [savedPlaceA] : [savedPlaceB] });
      if (path === '/api/v1/homes') return json({ items: [homeA, homeB] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const snapshots = [];
    const view = render(<WorkspaceProvider><Probe snapshots={snapshots} /></WorkspaceProvider>);
    await waitFor(() => expect(aShortlistJsonStarted).toBe(true));
    await waitFor(() => expect(readWorkspace().places).toEqual(['place-a']));
    expect(readWorkspace()).toMatchObject({ briefAdults: 5, shortlistIds: ['home-a'], compareIds: ['home-a'] });

    const beforeSwitch = snapshots.length;
    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe snapshots={snapshots} /></WorkspaceProvider>);
    expect(snapshots.slice(beforeSwitch)[0]).toMatchObject({
      briefAdults: defaultBrief.adults,
      shortlistIds: [],
      compareIds: [],
      places: [],
      placeState: { status: 'idle' },
    });

    await waitFor(() => expect(readWorkspace()).toMatchObject({
      briefAdults: 7, shortlistIds: ['home-b'], compareIds: ['home-b'], places: ['place-b'],
    }));
    await act(async () => resolveAShortlist({ items: [homeA] }));
    expect(readWorkspace()).toMatchObject({
      briefAdults: 7, shortlistIds: ['home-b'], compareIds: ['home-b'], places: ['place-b'],
    });
  });

  it('hides A homes and search state during an owner switch and ignores A search results after B loads', async () => {
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountWorkspaceKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: ['home-a'], compareIds: [],
    }));
    window.localStorage.setItem(accountWorkspaceKey('user-b'), JSON.stringify({
      brief: { ...defaultBrief, adults: 7 }, shortlistIds: ['home-b'], compareIds: [],
    }));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    let homeLoads = 0;
    let resolveASearch;
    let aSearchStarted = false;
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
      if (path === '/api/v1/shortlists') return json({ items: ownerId === 'user-a' ? [homeA] : ownerId === 'user-b' ? [homeB] : [] });
      if (path === '/api/v1/profile') return json({
        adults: ownerId === 'user-a' ? 5 : 7,
        children: 1,
        olderAdults: 0,
        budgetCents: 55000000,
        priorityWeights: defaultBrief.priorityWeights,
      });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') {
        homeLoads += 1;
        return homeLoads === 1
          ? json({ items: [homeA], total: 60, nextCursor: 'owner-a-next', hasMore: true, retrievedAt: 'owner-a' })
          : json({ items: [homeB], total: 1, nextCursor: null, hasMore: false, retrievedAt: 'owner-b' });
      }
      if (path === '/api/v1/ai/interpret') return json({ filters: { query: 'A query' } });
      if (path === '/api/v1/search') {
        if(JSON.parse(options.body).query !== 'A query') return ownerId === 'user-a'
          ? json({items:[homeA],total:60,nextCursor:'owner-a-next',hasMore:true,retrievedAt:'owner-a'})
          : json({items:[homeB],total:1,nextCursor:null,hasMore:false,retrievedAt:'owner-b'});
        aSearchStarted = true;
        return new Promise((resolve) => { resolveASearch = resolve; });
      }
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const snapshots = [];
    const view = render(<WorkspaceProvider><Probe snapshots={snapshots} /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace()).toMatchObject({
      homes: ['home-a'],
      homeState: { status: 'success', retrievedAt: 'owner-a' },
      pagination: { total: 60, nextCursor: 'owner-a-next', hasMore: true },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Search A query' }));
    await waitFor(() => expect(aSearchStarted).toBe(true));
    await waitFor(() => expect(readWorkspace().query).toBe('A query'));

    const beforeSwitch = snapshots.length;
    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe snapshots={snapshots} /></WorkspaceProvider>);
    expect(snapshots.slice(beforeSwitch)[0]).toMatchObject({
      homes: [],
      query: '',
      pagination: { total: 0, nextCursor: null, hasMore: false },
      homeState: { status: 'idle', retrievedAt: null, error: null },
      busy: false,
    });

    await waitFor(() => expect(readWorkspace()).toMatchObject({
      briefAdults: 7,
      homes: ['home-b'],
      homeState: { status: 'success', retrievedAt: 'owner-b' },
      pagination: { total: 1, nextCursor: null, hasMore: false },
      query: '',
    }));
    await act(async () => resolveASearch(json({ items: [homeA], total: 90, nextCursor: 'stale-a-next', hasMore: true, retrievedAt: 'stale-a' })));

    expect(readWorkspace()).toMatchObject({
      briefAdults: 7,
      homes: ['home-b'],
      homeState: { status: 'success', retrievedAt: 'owner-b' },
      pagination: { total: 1, nextCursor: null, hasMore: false },
      query: '',
    });
  });

  it('ignores profile JSON that arrives after the workspace owner changes', async () => {
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountWorkspaceKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: ['home-a'], compareIds: [],
    }));
    window.localStorage.setItem(accountWorkspaceKey('user-b'), JSON.stringify({
      brief: { ...defaultBrief, adults: 7 }, shortlistIds: ['home-b'], compareIds: [],
    }));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    let resolveAProfile;
    let aProfileJsonStarted = false;
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
      if (path === '/api/v1/shortlists') return { ok: false, json: async () => ({}) };
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile' && ownerId === 'user-a') {
        return {
          ok: true,
          json: () => {
            aProfileJsonStarted = true;
            return new Promise((resolve) => { resolveAProfile = resolve; });
          },
        };
      }
      if (path === '/api/v1/profile') return json({ adults: 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') return json({ items: [homeA, homeB] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(aProfileJsonStarted).toBe(true));

    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] }));
    await act(async () => resolveAProfile({ adults: 5, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights }));

    expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] });
  });

  it('restores a stale failed A shortlist toggle in A cache without changing B or guest state', async () => {
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountWorkspaceKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: ['home-a'], compareIds: [],
    }));
    window.localStorage.setItem(accountWorkspaceKey('user-b'), JSON.stringify({
      brief: { ...defaultBrief, adults: 7 }, shortlistIds: ['home-b'], compareIds: [],
    }));
    window.localStorage.setItem('shortlist', JSON.stringify(['guest-home']));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    let failAChange;
    const mutationCalls = [];
    const fetchMock = vi.fn((url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return Promise.resolve(json({ accepted: {}, skipped: {}, conflicts: [] }));
      if (path === '/api/v1/shortlists' && (!options.method || options.method === 'GET')) return Promise.resolve(json({ items: ownerId === 'user-a' ? [homeA] : [homeB] }));
      if (path.startsWith('/api/v1/shortlists') && options.method !== 'GET') {
        mutationCalls.push({ path, ownerId });
        if (ownerId === 'user-a') return new Promise((resolve) => { failAChange = resolve; });
        return Promise.resolve(json({}));
      }
      if (path === '/api/v1/profile') return Promise.resolve(json({ adults: ownerId === 'user-a' ? 5 : 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights }));
      if (path === '/api/v1/places') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/homes') return Promise.resolve(json({ items: [homeA, homeB] }));
      if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [] }));
      if (path === '/api/v1/sources') return Promise.resolve(json({ items: [] }));
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().shortlistIds).toEqual(['home-a']));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle home B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle home A' }));
    await waitFor(() => expect(mutationCalls).toHaveLength(1));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).shortlistIds).toEqual(['home-a', 'home-b']));
    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] }));

    await act(async () => failAChange(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    await waitFor(() => expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] }));
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].ownerId).toBe('user-a');
    expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).shortlistIds).toEqual(['home-a']);
    expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-b'))).shortlistIds).toEqual(['home-b']);
    expect(window.localStorage.getItem('shortlist')).toBe(JSON.stringify(['guest-home']));
  });

  it('restores a stale failed A reorder in A cache without changing B or guest state', async () => {
    const accountWorkspaceKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountWorkspaceKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 }, shortlistIds: ['home-a', 'home-b'], compareIds: [],
    }));
    window.localStorage.setItem(accountWorkspaceKey('user-b'), JSON.stringify({
      brief: { ...defaultBrief, adults: 7 }, shortlistIds: ['home-b'], compareIds: [],
    }));
    window.localStorage.setItem('shortlist', JSON.stringify(['guest-home']));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    let failAReorder;
    const mutationCalls = [];
    const fetchMock = vi.fn((url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return Promise.resolve(json({ accepted: {}, skipped: {}, conflicts: [] }));
      if (path === '/api/v1/shortlists' && (!options.method || options.method === 'GET')) {
        return Promise.resolve(json({ items: ownerId === 'user-a' ? [homeA, homeB] : ownerId === 'user-b' ? [homeB] : [] }));
      }
      if (path.startsWith('/api/v1/shortlists') && options.method !== 'GET') {
        mutationCalls.push({ path, ownerId });
        if (ownerId === 'user-a') return new Promise((resolve) => { failAReorder = resolve; });
        return Promise.resolve(json({}));
      }
      if (path === '/api/v1/profile') return Promise.resolve(json({
        adults: ownerId === 'user-a' ? 5 : 7,
        children: 1,
        olderAdults: 0,
        budgetCents: 55000000,
        priorityWeights: defaultBrief.priorityWeights,
      }));
      if (path === '/api/v1/places') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/homes') return Promise.resolve(json({ items: [homeA, homeB] }));
      if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [] }));
      if (path === '/api/v1/sources') return Promise.resolve(json({ items: [] }));
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace().shortlistIds).toEqual(['home-a', 'home-b']));

    fireEvent.click(screen.getByRole('button', { name: 'Move home B up' }));
    await waitFor(() => expect(mutationCalls).toHaveLength(1));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).shortlistIds).toEqual(['home-b', 'home-a']));
    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] }));

    await act(async () => failAReorder(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    expect(readWorkspace()).toMatchObject({ briefAdults: 7, shortlistIds: ['home-b'] });
    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0]).toMatchObject({ path: '/api/v1/shortlists/order', ownerId: 'user-a' });
    expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-a'))).shortlistIds).toEqual(['home-a', 'home-b']);
    expect(JSON.parse(window.localStorage.getItem(accountWorkspaceKey('user-b'))).shortlistIds).toEqual(['home-b']);
    expect(window.localStorage.getItem('shortlist')).toBe(JSON.stringify(['guest-home']));
  });

  it('keeps skipped history pending and offers Account a retry after a successful partial sync', async () => {
    const history = [{ mode: 'structured', criteria: { query: 'Jurong', limit: 10 } }];
    window.localStorage.setItem('search-history', JSON.stringify(history));
    window.localStorage.setItem('homecompass.guest-sync-pending', JSON.stringify({
      brief: null, shortlistHomeIds: [], compareHomeIds: [], history, places: [],
    }));
    let syncAttempts = 0;
    const fetchMock = vi.fn(async (path, options = {}) => {
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') {
        syncAttempts += 1;
        return json(syncAttempts === 1
          ? { accepted: { history: 0 }, skipped: { history: 1, retryableHistoryIndexes: [0] }, conflicts: [] }
          : { accepted: { history: 1 }, skipped: { history: 0, retryableHistoryIndexes: [] }, conflicts: [] });
      }
      if (path === '/api/v1/shortlists') return json({ items: [] });
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile') return json({ adults: 2, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') return json({ items: [] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', email: 'family@example.com' },
      configured: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkspaceProvider><AccountPage /></WorkspaceProvider>);

    const retry = await screen.findByRole('button', { name: 'Retry account sync' });
    expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toEqual(history);
    expect(window.localStorage.getItem('homecompass.guest-sync-pending')).toBeNull();
    expect(window.localStorage.getItem('search-history')).toBeNull();

    fireEvent.click(retry);
    await waitFor(() => expect(syncAttempts).toBe(2));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.account.user-1.workspace')).pendingHistory).toBeUndefined());
    expect(window.localStorage.getItem('search-history')).toBeNull();
  });

  it('refreshes an existing guest snapshot when more local choices are made before sign-in', async () => {
    window.localStorage.setItem('shortlist', JSON.stringify(['home-a']));
    const fetchMock = authenticatedFetch();
    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;

    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a']));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle home B' }));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a', 'home-b']));

    useAuthMock.mockReturnValue({
      user: { id: 'user-1', email: 'family@example.com' },
    });
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(state().syncState).toBe('synced'));

    const syncCall = fetchMock.mock.calls.find(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(JSON.parse(syncCall[1].body).shortlistHomeIds).toEqual(['home-a', 'home-b']);
  });

  it('keeps account hydration under Strict Mode without submitting the sign-in merge twice', async () => {
    const fetchMock = authenticatedFetch();
    fetchMock.mockImplementation(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') return json(mergedResult);
      if (path === '/api/v1/shortlists') return json({ items: [] });
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile') return json({ adults: 5, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') return json({ items: [] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    const state = render(<StrictMode><WorkspaceProvider><Probe /></WorkspaceProvider></StrictMode>);
    const readState = readWorkspace;

    await waitFor(() => expect(readState().briefAdults).toBe(5));
    const syncCalls = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(syncCalls).toHaveLength(1);
    const profileReads = fetchMock.mock.calls.filter(([url, options]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/profile' && options?.method !== 'PUT');
    expect(profileReads).toHaveLength(1);
  });

  it('keeps account A workspace data out of guest storage after sign-out and reload before account B signs in', async () => {
    const accountStorageKey = (id) => `homecompass.account.${encodeURIComponent(id)}.workspace`;
    window.localStorage.setItem(accountStorageKey('user-a'), JSON.stringify({
      brief: { ...defaultBrief, adults: 5 },
      shortlistIds: ['home-a'],
      compareIds: ['home-a'],
    }));
    const userFor = (id) => ({ id, email: `${id}@example.com` });
    useAuthMock.mockReturnValue({ user: userFor('user-a') });
    const syncPayloads = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = new URL(url, 'http://homecompass.test').pathname;
      const ownerId = useAuthMock().user?.id ?? null;
      if (path === '/api/v1/auth/session') return json({ user: useAuthMock().user ?? null });
    if (path === '/api/v1/sync/guest') {
        syncPayloads.push({ ownerId, ...JSON.parse(options.body) });
        return json({ accepted: {}, skipped: {}, conflicts: [] });
      }
      if (path === '/api/v1/shortlists') return json({ items: ownerId === 'user-a' ? [homeA] : [homeB] });
      if (path === '/api/v1/profile') return json({ adults: ownerId === 'user-a' ? 5 : 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places') return json({ items: [] });
      if (path === '/api/v1/homes') return json({ items: [homeA, homeB] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;

    await waitFor(() => expect(state().compareIds).toEqual(['home-a']));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a']));
    expect(state().briefAdults).toBe(5);
    expect(JSON.parse(window.localStorage.getItem(accountStorageKey('user-a')))).toMatchObject({
      brief: { adults: 5 }, shortlistIds: ['home-a'], compareIds: ['home-a'],
    });
    expect(window.localStorage.getItem('shortlist')).not.toBe(JSON.stringify(['home-a']));

    view.unmount();
    useAuthMock.mockReturnValue({ user: null });
    const guestState = renderWorkspace();
    await waitFor(() => expect(window.localStorage.getItem('shortlist')).toBe('[]'));
    expect(guestState().shortlistIds).toEqual([]);
    expect(guestState().compareIds).toEqual([]);
    expect(guestState().briefAdults).toBe(defaultBrief.adults);

    useAuthMock.mockReturnValue({ user: userFor('user-b') });
    cleanup();
    const accountBView = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-b']));
    const accountBSync = syncPayloads.find((payload) => payload.ownerId === 'user-b');
    expect(accountBSync).toMatchObject({ brief: null, shortlistHomeIds: [], compareHomeIds: [] });
    expect(accountBSync.brief?.adults).not.toBe(5);
    expect(accountBSync.shortlistHomeIds).not.toContain('home-a');
    expect(accountBSync.compareHomeIds).not.toContain('home-a');
    accountBView.unmount();
  });

  it('rolls back a failed shortlist save and lets the user retry', async () => {
    let saves = 0;
    let failFirstSave;
    const fetchMock = authenticatedFetch({
      shortlistMutation: () => {
        saves += 1;
        return saves === 1 ? new Promise((resolve) => { failFirstSave = resolve; }) : json({});
      },
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle home B' }));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-b']));
    await act(async () => failFirstSave(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    await waitFor(() => expect(state().shortlistIds).toEqual([]));
    expect(state().notice.text).toMatch(/restored|could not be saved/i);
    expect(state().notice.text).toMatch(/try again/i);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle home B' }));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-b']));
    expect(saves).toBe(2);
    expect(state().notice.text).toMatch(/saved to your account/i);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shortlists', expect.objectContaining({ method: 'POST' }));
  });

  it('serializes reorder and toggle so a failed reorder cannot erase a later successful save', async () => {
    let failFirstReorder;
    let completeSecondSave;
    const mutationCalls = [];
    authenticatedFetch({
      shortlist: [homeA, homeB],
      shortlistMutation: (url, options) => new Promise((resolve) => {
        mutationCalls.push({ url, options });
        if (mutationCalls.length === 1) failFirstReorder = resolve;
        else completeSecondSave = resolve;
      }),
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    fireEvent.click(screen.getByRole('button', { name: 'Move home B up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle home A' }));
    await waitFor(() => expect(mutationCalls).toHaveLength(1));
    expect(mutationCalls[0].url).toBe('/api/v1/shortlists/order');
    expect(JSON.parse(mutationCalls[0].options.body)).toEqual({ ordered_home_ids: ['home-b', 'home-a'] });

    await act(async () => failFirstReorder(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    await waitFor(() => expect(mutationCalls).toHaveLength(2));
    expect(mutationCalls[1].url).toBe('/api/v1/shortlists/home-a');
    expect(mutationCalls[1].options.method).toBe('DELETE');
    await act(async () => completeSecondSave(json({})));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-b']));
  });

  it('keeps session-expired guidance when an account shortlist mutation returns 401', async () => {
    const fetchMock = authenticatedFetch({ shortlistMutation: () => json({ detail: { code: 'AUTH_REQUIRED' } }, 401) });
    const state = renderWorkspace();
    await waitFor(() => expect(state().syncState).toBe('synced'));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle home B' }));
    await waitFor(() => expect(state().notice.text).toMatch(/session expired|sign in again/i));
    expect(state().notice.text).toMatch(/session expired|sign in again/i);
    await waitFor(() => expect(state().shortlistIds).toEqual([]));
    expect(state().notice.text).toMatch(/restored/i);
    expect(state().notice.text).toMatch(/retry|try again/i);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shortlists', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps session-expired guidance and restores the order after a 401 reorder', async () => {
    const fetchMock = authenticatedFetch({
      shortlist: [homeA, homeB],
      shortlistMutation: () => json({ detail: { code: 'AUTH_REQUIRED' } }, 401),
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a', 'home-b']));

    fireEvent.click(screen.getByRole('button', { name: 'Move home B up' }));
    await waitFor(() => expect(state().notice.text).toMatch(/session expired|sign in again/i));
    expect(state().shortlistIds).toEqual(['home-a', 'home-b']);
    expect(state().notice.text).toMatch(/restored/i);
    expect(state().notice.text).toMatch(/retry|try again/i);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shortlists/order', expect.objectContaining({ method: 'PATCH' }));
  });

  it('rolls back a failed shortlist removal to the confirmed selection', async () => {
    let failRemoval;
    const fetchMock = authenticatedFetch({
      shortlist: [homeA],
      shortlistMutation: () => new Promise((resolve) => { failRemoval = resolve; }),
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a']));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle home A' }));
    await waitFor(() => expect(state().shortlistIds).toEqual([]));
    await act(async () => failRemoval(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a']));
    expect(state().notice.text).toMatch(/restored|could not be removed/i);
    expect(state().notice.text).toMatch(/try again/i);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/shortlists/home-a', expect.objectContaining({ method: 'DELETE' }));
  });

  it('rolls a failed reorder back to its last confirmed order', async () => {
    let failReorder;
    authenticatedFetch({
      shortlist: [homeA, homeB],
      shortlistMutation: () => new Promise((resolve) => { failReorder = resolve; }),
    });
    const state = renderWorkspace();
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a', 'home-b']));

    fireEvent.click(screen.getByRole('button', { name: 'Move home B up' }));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-b', 'home-a']));
    await act(async () => failReorder(json({ detail: { code: 'UNAVAILABLE' } }, 503)));
    await waitFor(() => expect(state().shortlistIds).toEqual(['home-a', 'home-b']));
    expect(state().notice.text).toMatch(/order.*restored|could not be saved/i);
    expect(state().notice.text).toMatch(/try again/i);
  });

  it('does not auto-upload saved places and sends them only after explicit confirmation', async () => {
    window.localStorage.setItem('personal-places', JSON.stringify([{
      label: 'Work', address: '1 Harbour Road', latitude: 1.29, longitude: 103.85,
    }]));
    const fetchMock = authenticatedFetch({
      sync: (_url, options) => {
        const request = JSON.parse(options.body);
        return json(request.confirmPlaces
          ? { ...mergedResult, accepted: { ...mergedResult.accepted, places: 1 } }
          : mergedResult);
      },
    });
    const signedInAuth = fetchMock.auth;
    useAuthMock.mockReturnValue({ user: null });
    const view = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    const state = readWorkspace;
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('homecompass.guest-sync-pending')).places).toHaveLength(1));
    useAuthMock.mockReturnValue(signedInAuth);
    view.rerender(<WorkspaceProvider><Probe /></WorkspaceProvider>);

    await waitFor(() => expect(state().syncState).toBe('synced'));
    const firstRequest = fetchMock.mock.calls.find(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
    expect(JSON.parse(firstRequest[1].body)).not.toHaveProperty('places');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm place sync' }));
    await waitFor(() => {
      const requests = fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://homecompass.test').pathname === '/api/v1/sync/guest');
      expect(requests).toHaveLength(2);
      const confirmedPayload = JSON.parse(requests[1][1].body);
      expect(confirmedPayload.confirmPlaces).toBe(true);
      expect(confirmedPayload.places).toEqual([{
        label: 'Work', address: '1 Harbour Road', latitude: 1.29, longitude: 103.85, kind:'other', maximumDistanceM:null,
      }]);
      expect(confirmedPayload.sync_key).not.toBe(JSON.parse(requests[0][1].body).sync_key);
    });
  });
});
