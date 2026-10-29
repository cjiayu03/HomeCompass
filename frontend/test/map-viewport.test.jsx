import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapViewportListener } from '../components/map-viewport-listener.jsx';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { defaultBrief } from '../lib/data.js';

const { useAuthMock, useMapMock, useMapEventsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ client: null, user: null })),
  useMapMock: vi.fn(),
  useMapEventsMock: vi.fn(),
}));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));
vi.mock('react-leaflet', () => ({ useMap: useMapMock, useMapEvents: useMapEventsMock }));

const metadata = {
  dataMode: 'live',
  retrievedAt: '2026-10-18T12:00:00+00:00',
  sourceSummary: [{ sourceId: 'hdb-resale' }],
  warnings: ['Historical records.'],
};
const initialHome = { id: 'home-1', address: 'First home' };
const secondHome = { id: 'home-2', address: 'Second home' };
const originalResource = { type: 'Feature', id: 'resource-1', properties: { resourceType: 'chas_clinic' } };

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function standardFetch(path) {
  if (path.startsWith('/api/v1/homes')) {
    return Promise.resolve(json({ items: [initialHome], count: 1, total: 3, nextCursor: 'page-2', hasMore: true, ...metadata }));
  }
  if (path.startsWith('/api/v1/resources')) {
    return Promise.resolve(json({ features: [originalResource], counts: [{ resourceType: 'chas_clinic', total: 8 }], hasMore: false, nextCursor: null, ...metadata }));
  }
  if (path.startsWith('/api/v1/sources')) return Promise.resolve(json({ items: [], ...metadata }));
  throw new Error(`Unexpected request: ${path}`);
}

function WorkspaceProbe() {
  const workspace = useWorkspace();
  return <>
    <output data-testid="workspace">{JSON.stringify({
      homes: workspace.homes,
      pagination: workspace.pagination,
      resourceFeatures: workspace.resourceFeatures,
      resourceState: workspace.resourceState,
      homeState: workspace.homeState,
      brief: workspace.brief,
      profileLoadState: workspace.profileLoadState,
    })}</output>
    <button onClick={() => workspace.refreshViewport({ west: 103.7, south: 1.2, east: 103.9, north: 1.4 })}>Refresh first viewport</button>
    <button onClick={() => workspace.refreshViewport({ west: 103.8, south: 1.25, east: 104, north: 1.45 })}>Refresh second viewport</button>
    <button onClick={() => workspace.refreshViewport({ west: 104, south: 1.2, east: 103, north: 1.4 })}>Refresh invalid viewport</button>
    <button onClick={() => workspace.setMapResourceTypes(['community_club', 'park_facility', 'eldercare'])}>Enable amenity layers</button>
    <button onClick={() => workspace.setMapResourceTypes([])}>Clear amenity layers</button>
    <button onClick={() => workspace.loadMoreHomes()}>Load more homes</button>
    <button onClick={() => workspace.applySearch('')}>Search homes</button>
  </>;
}

function renderWorkspace(fetchMock = vi.fn(standardFetch)) {
  vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
  vi.stubGlobal('fetch', fetchMock);
  render(<WorkspaceProvider><WorkspaceProbe /></WorkspaceProvider>);
  return {
    fetchMock,
    state: () => JSON.parse(screen.getByTestId('workspace').textContent),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ client: null, user: null });
  useMapMock.mockReset();
  useMapEventsMock.mockReset();
  window.localStorage.clear();
});

describe('MapViewportListener', () => {
  it('emits clamped west, south, east, north bounds only after Leaflet moveend', () => {
    let handlers;
    let leafletBounds = { west: -181, south: -91, east: 181, north: 91 };
    useMapMock.mockReturnValue({
      getBounds: () => ({
        getWest: () => leafletBounds.west,
        getSouth: () => leafletBounds.south,
        getEast: () => leafletBounds.east,
        getNorth: () => leafletBounds.north,
      }),
    });
    useMapEventsMock.mockImplementation((events) => { handlers = events; });
    const onBoundsChange = vi.fn();

    render(<MapViewportListener onBoundsChange={onBoundsChange} />);

    expect(onBoundsChange).not.toHaveBeenCalled();
    act(() => handlers.moveend());
    expect(onBoundsChange).toHaveBeenLastCalledWith({ west: -180, south: -90, east: 180, north: 90 });

    leafletBounds = { west: 103.7, south: 1.2, east: 103.9, north: 1.4 };
    act(() => handlers.moveend());
    expect(onBoundsChange).toHaveBeenLastCalledWith({ west: 103.7, south: 1.2, east: 103.9, north: 1.4 });
    expect(onBoundsChange).toHaveBeenCalledTimes(2);
  });
});

describe('workspace viewport and pagination requests', () => {
  it('sends only bounded resource limits and refreshes resources for validated viewport bounds', async () => {
    const { fetchMock, state } = renderWorkspace();

    await waitFor(() => expect(state().resourceState.status).toBe('success'));
    const initialResourceCall = fetchMock.mock.calls.find(([path]) => path.startsWith('/api/v1/resources'));
    const initialParams = new URL(initialResourceCall[0], 'http://homecompass.test').searchParams;
    expect(Number(initialParams.get('limit'))).toBeGreaterThan(0);
    expect(Number(initialParams.get('limit'))).toBeLessThanOrEqual(2000);
    expect(initialParams.get('limit')).not.toBe('5000');
    expect(state().resourceState.counts).toEqual([{ resourceType: 'chas_clinic', total: 8 }]);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh invalid viewport' }));
    expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/resources'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh first viewport' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/resources'))).toHaveLength(2));
    const viewportCall = fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/resources'))[1];
    const params = new URL(viewportCall[0], 'http://homecompass.test').searchParams;
    expect(params.get('bounds')).toBe('103.7,1.2,103.9,1.4');
    expect(Number(params.get('limit'))).toBeLessThanOrEqual(2000);
  });

  it('cancels the prior viewport request and ignores a stale response that resolves last', async () => {
    let firstResolve;
    let secondResolve;
    const fetchMock = vi.fn((path) => {
      if (path.startsWith('/api/v1/resources') && path.includes('103.7%2C1.2')) {
        return new Promise((resolve) => { firstResolve = resolve; });
      }
      if (path.startsWith('/api/v1/resources') && path.includes('103.8%2C1.25')) {
        return new Promise((resolve) => { secondResolve = resolve; });
      }
      return standardFetch(path);
    });
    const { state } = renderWorkspace(fetchMock);
    await waitFor(() => expect(state().resourceFeatures).toEqual([originalResource]));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh first viewport' }));
    await waitFor(() => expect(firstResolve).toBeTypeOf('function'));
    const firstSignal = fetchMock.mock.calls.find(([path]) => path.startsWith('/api/v1/resources') && path.includes('103.7%2C1.2'))[1].signal;

    fireEvent.click(screen.getByRole('button', { name: 'Refresh second viewport' }));
    await waitFor(() => expect(secondResolve).toBeTypeOf('function'));
    expect(firstSignal.aborted).toBe(true);
    const currentResource = { type: 'Feature', id: 'resource-current', properties: { resourceType: 'chas_clinic' } };
    await act(async () => secondResolve(json({ features: [currentResource], hasMore: false, ...metadata })));
    await waitFor(() => expect(state().resourceFeatures).toEqual([currentResource]));

    const staleResource = { type: 'Feature', id: 'resource-stale', properties: { resourceType: 'chas_clinic' } };
    await act(async () => firstResolve(json({ features: [staleResource], hasMore: false, ...metadata })));
    expect(state().resourceFeatures).toEqual([currentResource]);
  });

  it('retains the last resource results when a viewport request fails', async () => {
    const fetchMock = vi.fn((path) => path.startsWith('/api/v1/resources') && path.includes('103.7%2C1.2')
      ? Promise.resolve(json({ detail: { code: 'RESOURCE_DOWN' } }, 503))
      : standardFetch(path));
    const { state } = renderWorkspace(fetchMock);
    await waitFor(() => expect(state().resourceState.status).toBe('success'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh first viewport' }));
    await waitFor(() => expect(state().resourceState.status).toBe('error'));
    expect(state().resourceFeatures).toEqual([originalResource]);
  });

  it('appends home pages by stable ID and stops requesting after hasMore becomes false', async () => {
    const fetchMock = vi.fn((path) => {
      if (path.startsWith('/api/v1/homes') && path.includes('cursor=page-2')) {
        return Promise.resolve(json({ items: [initialHome, secondHome], count: 2, total: 3, nextCursor: 'page-3', hasMore: true, ...metadata }));
      }
      if (path.startsWith('/api/v1/homes') && path.includes('cursor=page-3')) {
        return Promise.resolve(json({ items: [{ id: 'home-3', address: 'Third home' }], count: 1, total: 3, nextCursor: null, hasMore: false, ...metadata }));
      }
      return standardFetch(path);
    });
    const { fetchMock: calls, state } = renderWorkspace(fetchMock);
    await waitFor(() => expect(state().pagination?.hasMore).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    await waitFor(() => expect(state().homes.map((item) => item.id)).toEqual(['home-1', 'home-2']));
    expect(state().pagination).toMatchObject({ nextCursor: 'page-3', hasMore: true, total: 3 });
    const secondHomeRequest = calls.mock.calls.find(([path]) => path.startsWith('/api/v1/homes') && path.includes('cursor=page-2'));
    const secondHomeParams = new URL(secondHomeRequest[0], 'http://homecompass.test').searchParams;
    expect(secondHomeParams.get('limit')).toBe('50');
    expect(secondHomeParams.get('cursor')).toBe('page-2');

    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    await waitFor(() => expect(state().homes.map((item) => item.id)).toEqual(['home-1', 'home-2', 'home-3']));
    expect(state().pagination).toMatchObject({ nextCursor: null, hasMore: false, total: 3 });
    const homeRequestCount = calls.mock.calls.filter(([path]) => path.startsWith('/api/v1/homes')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    expect(calls.mock.calls.filter(([path]) => path.startsWith('/api/v1/homes'))).toHaveLength(homeRequestCount);
  });

  it('stops pagination when a page is empty even if the response contains a cursor', async () => {
    const fetchMock = vi.fn((path) => path.startsWith('/api/v1/homes') && path.includes('cursor=page-2')
      ? Promise.resolve(json({ items: [], count: 0, total: 3, nextCursor: 'page-3', hasMore: true, ...metadata }))
      : standardFetch(path));
    const { fetchMock: calls, state } = renderWorkspace(fetchMock);
    await waitFor(() => expect(state().pagination?.hasMore).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    await waitFor(() => expect(state().pagination?.hasMore).toBe(false));
    expect(state().pagination.nextCursor).toBeNull();
    const homeRequestCount = calls.mock.calls.filter(([path]) => path.startsWith('/api/v1/homes')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    expect(calls.mock.calls.filter(([path]) => path.startsWith('/api/v1/homes'))).toHaveLength(homeRequestCount);
  });

  it('reuses the active search, place constraints, and score weights for later home pages', async () => {
    const priorityWeights = { school: 2, childcare: 3, care: 1, affordability: 0 };
    const placeConstraints = [{ placeId: 'saved-place-1', maxDistanceM: 850 }];
    window.localStorage.setItem('homecompass.account.user-1.workspace', JSON.stringify({
      brief: { ...defaultBrief, priorityWeights, placeConstraints },
    }));
    useAuthMock.mockReturnValue({
      user: { id: 'user-1' }, loading: false,
    });
    const searchBodies = [];
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/sync/guest') return Promise.resolve(json({ accepted: {}, skipped: {}, conflicts: [] }));
      if (path === '/api/v1/history' || path === '/api/v1/saved-searches') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/shortlists') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/profile' && options.method === 'PUT') return Promise.resolve(json({}));
      if (path === '/api/v1/profile') return Promise.resolve(json({
        adults: defaultBrief.adults,
        children: defaultBrief.children,
        olderAdults: defaultBrief.olderAdults,
        budgetCents: defaultBrief.budget == null ? null : defaultBrief.budget * 100,
        priorityWeights,
      }));
      if (path === '/api/v1/places') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/search') {
        const body = JSON.parse(options.body);
        searchBodies.push(body);
        return Promise.resolve(json(body.cursor
          ? { items: [secondHome], total: 2, nextCursor: null, hasMore: false, ...metadata }
          : { items: [initialHome], total: 2, nextCursor: 'search-page-2', hasMore: true, ...metadata }));
      }
      return standardFetch(path);
    });
    const { state } = renderWorkspace(fetchMock);

    await waitFor(() => expect(state().profileLoadState).toBe('ready'));
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().brief.placeConstraints).toEqual(placeConstraints);
    const initialSearchCount = searchBodies.length;
    fireEvent.click(screen.getByRole('button', { name: 'Search homes' }));
    await waitFor(() => expect(searchBodies).toHaveLength(initialSearchCount + 1));
    await waitFor(() => expect(state().homeState.status).toBe('success'));
    expect(state().pagination?.hasMore).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    await waitFor(() => expect(state().homes.map((item) => item.id)).toEqual(['home-1', 'home-2']));

    expect(searchBodies).toHaveLength(initialSearchCount + 2);
    const [firstPage, nextPage] = searchBodies.slice(-2);
    expect(nextPage).toMatchObject({
      cursor: 'search-page-2',
      limit: 50,
      priority_weights: priorityWeights,
      place_constraints: [{ place_id: 'saved-place-1', max_distance_m: 850 }],
    });
    expect(nextPage.query).toBe(firstPage.query);
    const pageRequest = fetchMock.mock.calls.filter(([path]) => path === '/api/v1/search').at(-1)[1];
    expect(pageRequest.credentials).toBe('include');
    expect(pageRequest.headers.Authorization).toBeUndefined();
  });
});


it('loads enabled amenity layers independently and keeps availability after clearing', async () => {
  const counts = ['community_club', 'park_facility', 'eldercare'].map(resourceType => ({ resourceType, total: 600, unlocated: 0 }));
  const fetchMock = vi.fn(path => {
    if (!path.startsWith('/api/v1/resources')) return standardFetch(path);
    const type = new URL(path, 'http://homecompass.test').searchParams.get('resource_type');
    return Promise.resolve(json({ ...metadata, features: [{ type: 'Feature', id: type, properties: { resourceType: type } }], counts, hasMore: type === 'park_facility' }));
  });
  const { state } = renderWorkspace(fetchMock);
  await waitFor(() => expect(state().resourceState.status).toBe('success'));
  fetchMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Enable amenity layers' }));
  await waitFor(() => expect(state().resourceFeatures.map(feature => feature.id)).toEqual(['community_club', 'park_facility', 'eldercare']));
  const calls = fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/resources'));
  expect(calls).toHaveLength(3);
  calls.forEach(([path]) => expect(new URL(path, 'http://homecompass.test').searchParams.getAll('resource_type')).toHaveLength(1));
  expect(state().resourceState.hasMore).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear amenity layers' }));
  await waitFor(() => expect(state().resourceFeatures).toEqual([]));
  expect(state().resourceState.counts).toEqual(counts);
  expect(fetchMock.mock.calls.filter(([path]) => path.startsWith('/api/v1/resources'))).toHaveLength(3);
});
