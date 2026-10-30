import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { defaultBrief } from '../lib/data.js';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(() => ({ client: null, user: null })) }));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));

const timestamp = '2026-10-18T12:00:00+00:00';
const liveMetadata = { dataMode: 'live', retrievedAt: timestamp, sourceSummary: [{ sourceId: 'hdb-resale' }], warnings: ['Historical records.'] };
const home = { id: 'live-1', address: 'Live record' };
const newerHome = { id: 'live-2', address: 'Newer record' };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function defaultFetch(path) {
  if (path.startsWith('/api/v1/homes')) return Promise.resolve(json({ items: [home], ...liveMetadata }));
  if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [{ id: 'resource-1' }], ...liveMetadata }));
  if (path.startsWith('/api/v1/sources')) return Promise.resolve(json({ items: [{ id: 'source-1' }], ...liveMetadata }));
  throw new Error(`Unexpected request: ${path}`);
}

function authenticatedProfileFetch(profile) {
  useAuthMock.mockReturnValue({
    client: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) } },
    user: { id: 'user-1' },
  });
  const fetchMock = vi.fn((path, options = {}) => {
    if (path === '/api/v1/shortlists') return Promise.resolve(json({ items: [] }));
    if (path === '/api/v1/profile' && options.method === 'PUT') return Promise.resolve(json({}));
    if (path === '/api/v1/profile') return Promise.resolve(json(profile));
    return defaultFetch(path);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Probe() {
  const workspace = useWorkspace();
  return <>
    <output data-testid="workspace">{JSON.stringify({
      homes: workspace.homes,
      resourceFeatures: workspace.resourceFeatures,
      sourceStatus: workspace.sourceStatus,
      brief: workspace.brief,
      homeState: workspace.homeState,
      resourceState: workspace.resourceState,
      sourceState: workspace.sourceState,
      fixtureMode: workspace.fixtureMode,
      busy: workspace.busy,
      notice: workspace.notice,
      query: workspace.query,
    })}</output>
    <button onClick={() => workspace.applySearch('')}>Search</button>
    <button onClick={() => workspace.setQuery('Current search')}>Set query</button>
    <button onClick={() => workspace.resetSearch()}>Reset</button>
    <button onClick={() => workspace.retryHomes()}>Retry homes</button>
    <button onClick={() => workspace.retryResources()}>Retry resources</button>
  </>;
}

function renderProvider() {
  render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
  return () => JSON.parse(screen.getByTestId('workspace').textContent);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ client: null, user: null });
});

describe('WorkspaceProvider data state', () => {
  it('starts live with no fixture homes and exposes successful API homes and metadata', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn(defaultFetch));
    const state = renderProvider();

    expect(state().homes).toEqual([]);
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().homes).toEqual([home]);
    expect(state().homeState).toMatchObject({ status: 'success', ...liveMetadata });
    expect(state().resourceFeatures).toEqual([{ id: 'resource-1' }]);
    expect(state().resourceState).toMatchObject({ status: 'success', ...liveMetadata });
    expect(state().sourceState.status).toBe('success');
    expect(state().fixtureMode).toBe(false);
  });

  it('keeps retrieval time absent when a live success response omits metadata', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn((path) => path.startsWith('/api/v1/homes')
      ? Promise.resolve(json({ items: [home] }))
      : defaultFetch(path)));
    const state = renderProvider();

    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().homeState.retrievedAt).toBeNull();
  });

  it('keeps live homes empty and exposes an error when initial loading fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn((path) => path.startsWith('/api/v1/homes')
      ? Promise.resolve(json({ detail: { code: 'UNAVAILABLE' } }, 503))
      : defaultFetch(path)));
    const state = renderProvider();

    await waitFor(() => expect(state().homeState.status).toBe('error'));
    expect(state().homes).toEqual([]);
    expect(state().homeState.error).toMatchObject({ code: 'UNAVAILABLE', status: 503 });
    expect(state().resourceState.status).toBe('success');
  });

  it('retains earlier live homes after a failed search and allows retry', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let retryReturnsNewHome = false;
    vi.stubGlobal('fetch', vi.fn((path) => path === '/api/v1/search'
      ? retryReturnsNewHome
        ? Promise.resolve(json({ items: [newerHome], ...liveMetadata }))
        : Promise.resolve(json({ detail: { code: 'SEARCH_DOWN' } }, 503))
      : defaultFetch(path)));
    const state = renderProvider();
    await waitFor(() => expect(state().homeState.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(state().homeState.status).toBe('error'));
    expect(state().homes).toEqual([home]);
    expect(state().homeState.error.code).toBe('SEARCH_DOWN');
    expect(state().notice.text).toMatch(/unavailable|unable/i);

    retryReturnsNewHome = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry homes' }));
    await waitFor(() => expect(state().homes).toEqual([newerHome]));
    expect(state().homeState.status).toBe('success');
  });

  it('describes a paginated historical search as a loaded page, not as the total found', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn((path) => path === '/api/v1/search'
      ? Promise.resolve(json({ items: [home], total: 243500, hasMore: true, nextCursor: 'page-2', ...liveMetadata }))
      : defaultFetch(path)));
    const state = renderProvider();
    await waitFor(() => expect(state().homeState.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(state().notice.text).toBe('Showing 1 of 243,500 matching historical resale records. Load more for additional results; these are not current listings.'));
    expect(state().notice.tone).toBe('info');
  });

  it('rejects successful responses without result arrays and retains existing data', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let invalidHomes = false;
    let invalidResources = false;
    vi.stubGlobal('fetch', vi.fn((path) => {
      if (path === '/api/v1/search') return Promise.resolve(json({ ...liveMetadata }));
      if (path === '/api/v1/homes' && invalidHomes) return Promise.resolve(json({ ...liveMetadata }));
      if (path.startsWith('/api/v1/resources') && invalidResources) return Promise.resolve(json({ ...liveMetadata }));
      return defaultFetch(path);
    }));
    const state = renderProvider();
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    await waitFor(() => expect(state().resourceState.status).toBe('success'));

    invalidHomes = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry homes' }));
    await waitFor(() => expect(state().homeState.status).toBe('error'));
    expect(state().homes).toEqual([home]);
    expect(state().homeState.error.code).toBe('INVALID_RESPONSE');

    invalidHomes = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry homes' }));
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(state().homeState.status).toBe('error'));
    expect(state().homes).toEqual([home]);
    expect(state().homeState.error.code).toBe('INVALID_RESPONSE');

    invalidResources = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry resources' }));
    await waitFor(() => expect(state().resourceState.status).toBe('error'));
    expect(state().resourceFeatures).toEqual([{ id: 'resource-1' }]);
    expect(state().resourceState.error.code).toBe('INVALID_RESPONSE');
  });

  it('ignores an older search response that resolves after a newer one', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let resolveOlder;
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn((path) => {
      if (path === '/api/v1/search') {
        requests += 1;
        if (requests === 1) return new Promise((resolve) => { resolveOlder = resolve; });
        return Promise.resolve(json({ items: [newerHome], ...liveMetadata }));
      }
      return defaultFetch(path);
    }));
    const state = renderProvider();
    await waitFor(() => expect(state().homeState.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(state().homes).toEqual([newerHome]));
    await act(async () => resolveOlder(json({ items: [{ id: 'stale' }], ...liveMetadata })));
    expect(state().homes).toEqual([newerHome]);
  });

  it('uses fixture homes only with the explicit fixture switch', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'fixture');
    vi.stubGlobal('fetch', vi.fn());
    const state = renderProvider();

    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().fixtureMode).toBe(true);
    expect(state().homeState.dataMode).toBe('fixture');
    expect(state().homes.length).toBeGreaterThan(0);
    expect(state().homes[0].source).toMatch(/Illustrative fixture/);
    expect(state().resourceState.status).toBe('empty');
    expect(state().sourceState.status).toBe('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Retry homes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry resources' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(state().notice.text).toMatch(/fixture/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps successful homes when sources fail, and retries resources independently', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let resourceFails = true;
    vi.stubGlobal('fetch', vi.fn((path) => {
      if (path.startsWith('/api/v1/sources')) return Promise.reject(new TypeError('offline'));
      if (path.startsWith('/api/v1/resources') && resourceFails) return Promise.resolve(json({ detail: { code: 'RESOURCE_DOWN' } }, 503));
      return defaultFetch(path);
    }));
    const state = renderProvider();

    await waitFor(() => expect(state().sourceState.status).toBe('error'));
    await waitFor(() => expect(state().resourceState.status).toBe('error'));
    expect(state().sourceState.error.code).toBe('NETWORK_ERROR');
    expect(state().resourceState.error.code).toBe('RESOURCE_DOWN');
    expect(state().homes).toEqual([home]);
    expect(state().homeState.status).toBe('success');

    resourceFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry resources' }));
    await waitFor(() => expect(state().resourceState.status).toBe('success'));
    expect(state().resourceFeatures).toEqual([{ id: 'resource-1' }]);
    expect(state().sourceState.status).toBe('error');
  });

  it('preserves the live query until reset succeeds', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let deferReset = false;
    let resolveReset;
    vi.stubGlobal('fetch', vi.fn((path) => path === '/api/v1/homes' && deferReset
      ? new Promise((resolve) => { resolveReset = resolve; })
      : path === '/api/v1/search'
        ? Promise.resolve(json({ items: [newerHome], ...liveMetadata }))
        : defaultFetch(path)));
    const state = renderProvider();
    await waitFor(() => expect(state().homeState.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(state().homes).toEqual([newerHome]));
    fireEvent.click(screen.getByRole('button', { name: 'Set query' }));
    deferReset = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(resolveReset).toBeTypeOf('function'));
    expect(state().query).toBe('Current search');
    expect(state().homes).toEqual([newerHome]);

    await act(async () => resolveReset(json({ detail: { code: 'HOME_DOWN' } }, 503)));
    await waitFor(() => expect(state().homeState.status).toBe('error'));
    expect(state().homes).toEqual([newerHome]);
    expect(state().query).toBe('Current search');
    expect(state().notice.text).toMatch(/unable to reload/i);
    expect(state().notice.text).not.toMatch(/fixture|reset to/i);
    expect(fetch).toHaveBeenCalledWith('/api/v1/homes', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    deferReset = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().query).toBe('');
    expect(state().homes).toEqual([home]);
  });

  it('reports an empty live result without switching to fixtures', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn((path) => path === '/api/v1/homes'
      ? Promise.resolve(json({ items: [], ...liveMetadata }))
      : defaultFetch(path)));
    const state = renderProvider();

    await waitFor(() => expect(state().homeState.status).toBe('empty'));
    expect(state().homes).toEqual([]);
    expect(state().homeState).toMatchObject({ dataMode: 'live', retrievedAt: timestamp, warnings: ['Historical records.'], error: null });
  });

  it('aborts outstanding data requests when the provider unmounts', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const signals = [];
    vi.stubGlobal('fetch', vi.fn((_path, options) => {
      signals.push(options.signal);
      return new Promise(() => {});
    }));
    const { unmount } = render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
    await waitFor(() => expect(signals).toHaveLength(3));

    unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('hydrates saved profile priority weights before syncing the profile', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const priorityWeights = { school: 3, childcare: 1, care: 2.5, affordability: 0 };
    const fetchMock = authenticatedProfileFetch({
      adults: 2,
      children: 1,
      olderAdults: 1,
      budgetCents: 55000000,
      priorityWeights,
    });
    const state = renderProvider();

    let profileSync;
    await waitFor(() => {
      profileSync = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/profile' && options?.method === 'PUT');
      expect(profileSync).toBeTruthy();
    }, { timeout: 3000 });

    expect({
      briefWeights: state().brief.priorityWeights,
      syncedWeights: JSON.parse(profileSync[1].body).priority_weights,
    }).toEqual({ briefWeights: priorityWeights, syncedWeights: priorityWeights });
  });

  it.each([
    ['omits priorityWeights', {}],
    ['returns null priorityWeights', { priorityWeights: null }],
    ['returns an array instead of an object', { priorityWeights: [3, 1, 2, 0] }],
    ['returns incomplete weights', { priorityWeights: { school: 3, childcare: 1, care: 2 } }],
    ['returns a non-numeric weight', { priorityWeights: { school: 3, childcare: '1', care: 2, affordability: 0 } }],
  ])('preserves current weights when the profile %s', async (_description, weightFields) => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const currentWeights = { school: 1.5, childcare: 3, care: 0, affordability: 2 };
    window.localStorage.setItem('homecompass.account.user-1.workspace', JSON.stringify({
      brief: { ...defaultBrief, priorityWeights: currentWeights },
    }));
    const fetchMock = authenticatedProfileFetch({
      adults: 2,
      children: 1,
      olderAdults: 1,
      budgetCents: 55000000,
      ...weightFields,
    });
    const state = renderProvider();

    let profileSync;
    await waitFor(() => {
      profileSync = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/profile' && options?.method === 'PUT');
      expect(profileSync).toBeTruthy();
    }, { timeout: 3000 });

    expect(state().brief.priorityWeights).toEqual(currentWeights);
    expect(JSON.parse(profileSync[1].body).priority_weights).toEqual(currentWeights);
  });
});
