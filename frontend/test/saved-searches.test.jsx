import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SavedDecisionSections } from '../components/saved-searches.jsx';
import ExplorePage from '../app/(workspace)/explore/page.jsx';
import { PlanningProvider } from '../components/planning-provider.jsx';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';

const { useAuthMock, routerReplaceMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ user: null, loading: false, configured: false })),
  routerReplaceMock: vi.fn(),
}));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/ui/number-ticker', () => ({ NumberTicker: ({ value }) => <span>{value}</span> }));
vi.mock('@/components/map-panel', () => ({ MapPanel: () => <div aria-label="Map" /> }));

const timestampOld = '2026-10-18T12:00:00+00:00';
const timestampNew = '2026-10-20T12:00:00+00:00';
const sourceRetrievedAt = '2026-10-17T09:00:00+00:00';
const schoolSourceRetrievedAt = '2026-10-16T08:30:00+00:00';
const placeId = '11111111-1111-4111-8111-111111111111';
const snapshotOld = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snapshotNew = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const weights = { school: 3, childcare: 1, care: 2, affordability: 0 };
const initialHome = { id: 'initial-home', address: 'Original result' };
const searchedHome = { id: 'searched-home', address: 'Filtered result' };
const rerunHomes = [
  { id: 'rerun-home-a', address: 'Fresh result A' },
  { id: 'rerun-home-b', address: 'Fresh result B' },
];

const sourceMetaOld = {
  dataMode: 'live',
  retrievedAt: timestampOld,
  sourceSummary: [
    { sourceId: 'hdb-resale', sourceVersion: '2026-10', retrievedAt: sourceRetrievedAt },
    { sourceId: 'moe-school', sourceVersion: '2026-09', retrievedAt: schoolSourceRetrievedAt },
  ],
  warnings: ['Historical records, not current listings.'],
  count: 1,
  total: 2,
  scorePolicyVersion: 'home-fit-v1',
};

const savedSearch = {
  id: 'saved-search-1',
  name: 'Near the office',
  mode: 'structured',
  criteria: { query: '', budget: 700000, priority_weights: weights, place_constraints: [] },
  places: [],
  scorePolicy: { priorityWeights: weights, scoringVersion: 'home-fit-v1' },
  createdAt: timestampOld,
  updatedAt: timestampOld,
  lastRunAt: timestampOld,
  lastSourceSnapshotIds: [snapshotOld],
  lastResultMeta: sourceMetaOld,
};

const historyEntry = {
  id: 'history-1',
  mode: 'structured',
  criteria: { query: 'Harbour Road', budget: 700000 },
  sourceSnapshotIds: [snapshotOld],
  scoringVersion: 'home-fit-v1',
  createdAt: timestampOld,
};

const normalizedCriteria = {
  query: '',
  budget: 700000,
  town: null,
  flat_type: null,
  bounds: null,
  limit: 50,
  max_school_distance_m: 500,
  max_childcare_distance_m: null,
  max_care_distance_m: 1200,
  priority_weights: weights,
  place_constraints: [{ place_id: placeId, max_distance_m: 2500 }],
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function defaultFetch(path, options = {}) {
  const method = options.method || 'GET';
  if (path === '/api/v1/auth/session') return Promise.resolve(json({ user: useAuthMock().user ?? null }));
  if (path === '/api/v1/sync/guest') return Promise.resolve(json({ accepted: {}, skipped: {}, conflicts: [] }));
  if (path === '/api/v1/shortlists') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/profile' && method === 'PUT') return Promise.resolve(json({}));
  if (path === '/api/v1/profile') return Promise.resolve(json({ adults: 2, children: 1, olderAdults: 0, budgetCents: 70000000, priorityWeights: weights }));
  if (path === '/api/v1/homes') return Promise.resolve(json({ items: [initialHome], dataMode: 'live', retrievedAt: timestampOld }));
  if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [] }));
  if (path === '/api/v1/sources') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/planning/workspace') return Promise.resolve(json({ scenarios: [], decisions: {}, revision: 0 }));
  if (path === '/api/v1/search/options') return Promise.resolve(json({ towns: ['Queenstown'], flatTypes: ['3-room'] }));
  if (path === '/api/v1/places') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/history' && method === 'POST') {
    return Promise.resolve(json({ id: 'history-created', created: true, sourceSnapshotIds: [snapshotOld] }));
  }
  if (path === '/api/v1/history') return Promise.resolve(json({ items: [historyEntry] }));
  if (path === '/api/v1/saved-searches' && method === 'POST') {
    const body = JSON.parse(options.body);
    return Promise.resolve(json({ item: { ...savedSearch, id: 'saved-created', name: body.name, criteria: body.criteria } }, 201));
  }
  if (path === '/api/v1/saved-searches') return Promise.resolve(json({ items: [savedSearch] }));
  if (path === '/api/v1/search') {
    const requestCriteria = JSON.parse(options.body);
    return Promise.resolve(json({
      items: [searchedHome],
      criteria: { ...normalizedCriteria, ...requestCriteria, cursor: null },
      sourceSnapshotIds: [snapshotOld],
      ...sourceMetaOld,
    }));
  }
  if (path === `/api/v1/saved-searches/${savedSearch.id}` && method === 'PATCH') {
    const body = JSON.parse(options.body);
    return Promise.resolve(json({ item: { ...savedSearch, name: body.name } }));
  }
  if (path === `/api/v1/saved-searches/${savedSearch.id}` && method === 'DELETE') {
    return Promise.resolve(json({ status: 'deleted' }));
  }
  if (path === `/api/v1/saved-searches/${savedSearch.id}/run` && method === 'POST') {
    const metadata = {
      dataMode: 'live',
      retrievedAt: timestampNew,
      sourceSummary: [{ sourceId: 'hdb-resale', sourceVersion: '2026-11', retrievedAt: timestampNew }],
      warnings: ['Historical records, not current listings.'],
      count: 2,
      total: 3,
      scorePolicyVersion: 'home-fit-v2',
    };
    return Promise.resolve(json({
      items: rerunHomes,
      hasMore: true,
      nextCursor: 'rerun-next-page',
      metadata,
      sourceSnapshotIds: [snapshotNew],
      priorMetadata: {
        lastRunAt: timestampOld,
        sourceSnapshotIds: [snapshotOld],
        result: sourceMetaOld,
        scorePolicyVersion: 'home-fit-v1',
      },
      difference: {
        count: { previous: 1, current: 2, delta: 1 },
        pageCount: { previous: 1, current: 2, delta: 1 },
        total: { previous: 2, current: 3, delta: 1 },
        sourceSnapshots: { previous: [snapshotOld], current: [snapshotNew], added: [snapshotNew], removed: [snapshotOld] },
        scorePolicyVersion: { previous: 'home-fit-v1', current: 'home-fit-v2', changed: true },
      },
    }));
  }
  throw new Error(`Unexpected request: ${method} ${path}`);
}

function authenticatedUser() {
  useAuthMock.mockReturnValue({
    user: { id: 'user-1', email: 'person@example.com' },
    loading: false,
    configured: true,
  });
}

function WorkspaceProbe() {
  const workspace = useWorkspace();
  return <>
    <output data-testid="saved-decision-state">{JSON.stringify({
      history: workspace.history,
      savedSearches: workspace.savedSearches,
      savedSearchState: workspace.savedSearchState,
      homes: workspace.homes,
      homeState: workspace.homeState,
      pagination: workspace.pagination,
      shortlistIds: workspace.shortlistIds,
      compareIds: workspace.compareIds,
      shortlistHomes: workspace.shortlistHomes.map(({ id, address }) => ({ id, address })),
      selectedHomes: workspace.selectedHomes.map(({ id, address }) => ({ id, address })),
      historyState: workspace.historyState,
      brief: workspace.brief,
      profileLoadState: workspace.profileLoadState,
    })}</output>
    <button onClick={() => workspace.setBrief({
      ...workspace.brief,
      budget: 700000,
      requirements: { ...workspace.brief.requirements, budget: true },
      schoolDistance: 500,
      careDistance: 1200,
      priorityWeights: weights,
      placeConstraints: [{ placeId, maxDistanceM: 2500 }],
    })}>Set saved-search criteria</button>
    <button onClick={() => { workspace.toggleShortlist(initialHome); workspace.toggleCompare(initialHome); }}>Keep initial home in decisions</button>
    <button onClick={() => workspace.applySearch?.('')}>Run current search</button>
    <button onClick={() => workspace.saveSearch?.('  Harbour Road family search  ')}>Save current search</button>
    <button onClick={() => workspace.renameSavedSearch?.(savedSearch.id, 'Renamed search')}>Rename saved search</button>
    <button onClick={() => workspace.deleteSavedSearch?.(savedSearch.id)}>Delete saved search</button>
    <button onClick={() => workspace.rerunSavedSearch?.(savedSearch.id)}>Rerun saved search</button>
    <button onClick={() => workspace.loadMoreHomes?.()}>Load more homes</button>
    <button onClick={() => workspace.saveSearch?.('Guest search')}>Try saving while signed out</button>
  </>;
}

function renderWorkspace(children = <WorkspaceProbe />, { authenticated = true, route = () => undefined } = {}) {
  if (authenticated) authenticatedUser();
  else useAuthMock.mockReturnValue({ user: null, loading: false, configured: false });
  window.history.replaceState({}, '', '/explore');
  vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
  const fetchMock = vi.fn((path, options = {}) => route(path, options) ?? defaultFetch(path, options));
  vi.stubGlobal('fetch', fetchMock);
  render(<WorkspaceProvider><PlanningProvider>{children}</PlanningProvider></WorkspaceProvider>);
  const state = () => JSON.parse(screen.getByTestId('saved-decision-state').textContent);
  return { fetchMock, state };
}

function requestFor(fetchMock, path, method = 'GET') {
  return fetchMock.mock.calls.find(([requestPath, options = {}]) => requestPath === path && (options.method || 'GET') === method)?.[1];
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/explore');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ user: null, loading: false, configured: false });
});

describe('workspace saved searches and history', () => {
  it('loads non-empty account history and saved searches with authenticated requests', async () => {
    const { fetchMock, state } = renderWorkspace();

    await waitFor(() => expect(state().history).toEqual([historyEntry]));
    expect(state().savedSearches).toEqual([savedSearch]);
    expect(state().savedSearchState.status).toBe('success');
    const historyRequest = requestFor(fetchMock, '/api/v1/history');
    const searchesRequest = requestFor(fetchMock, '/api/v1/saved-searches');
    expect(historyRequest.credentials).toBe('include');
    expect(historyRequest.headers?.Authorization).toBeUndefined();
    expect(searchesRequest.credentials).toBe('include');
    expect(searchesRequest.headers?.Authorization).toBeUndefined();
  });

  it('keeps saved searches visible when history fails to load', async () => {
    renderWorkspace(<SavedDecisionSections />, {
      route: (path) => path === '/api/v1/history'
        ? Promise.resolve(json({ detail: { code: 'HISTORY_UNAVAILABLE', message: 'Search history is temporarily unavailable.' } }, 503))
        : undefined,
    });

    expect(await screen.findByRole('heading', { name: 'Near the office' })).toBeInTheDocument();
    expect(screen.getByText('Search history is unavailable until the request succeeds.')).toBeInTheDocument();
  });

  it('keeps history visible when saved searches fail to load', async () => {
    renderWorkspace(<SavedDecisionSections />, {
      route: (path) => path === '/api/v1/saved-searches'
        ? Promise.resolve(json({ detail: { code: 'SAVED_SEARCHES_UNAVAILABLE', message: 'Saved searches are temporarily unavailable.' } }, 503))
        : undefined,
    });

    expect(await screen.findByRole('heading', { name: 'Harbour Road' })).toBeInTheDocument();
    expect(screen.getByText('Saved searches are temporarily unavailable.')).toBeInTheDocument();
  });

  it('renders saved searches while the independent history request is still loading', async () => {
    const pendingHistory = [];
    let historyReleased = false;
    renderWorkspace(<SavedDecisionSections />, {
      route: (path, options) => path === '/api/v1/history' && (options.method || 'GET') === 'GET' && !historyReleased
        ? new Promise(resolve => pendingHistory.push(resolve))
        : undefined,
    });

    await waitFor(() => expect(pendingHistory.length).toBeGreaterThan(0));
    expect(await screen.findByRole('heading', { name: 'Near the office' })).toBeInTheDocument();
    expect(screen.getByText('Loading search history…')).toBeInTheDocument();
    await act(async () => {
      historyReleased = true;
      pendingHistory.forEach(resolve => resolve(json({ items: [historyEntry] })));
    });
    expect(await screen.findByRole('heading', { name: 'Harbour Road' })).toBeInTheDocument();
  });

  it('represents empty account history and saved searches as a successful empty state', async () => {
    const { state } = renderWorkspace(<WorkspaceProbe />, {
      route: (path) => path === '/api/v1/history' || path === '/api/v1/saved-searches'
        ? Promise.resolve(json({ items: [] }))
        : undefined,
    });

    await waitFor(() => expect(state().savedSearchState.status).toBe('empty'));
    expect(state().history).toEqual([]);
    expect(state().savedSearches).toEqual([]);
    expect(state().savedSearchState.error).toBeNull();
  });

  it('saves normalized current criteria and the policy/source metadata from a successful search', async () => {
    const { fetchMock } = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Set saved-search criteria' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run current search' }));
    await waitFor(() => expect(requestFor(fetchMock, '/api/v1/search', 'POST')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save current search' }));

    await waitFor(() => expect(requestFor(fetchMock, '/api/v1/saved-searches', 'POST')).toBeTruthy());
    const request = requestFor(fetchMock, '/api/v1/saved-searches', 'POST');
    expect(request.credentials).toBe('include');
    expect(request.headers?.Authorization).toBeUndefined();
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      name: 'Harbour Road family search',
      mode: 'structured',
      criteria: {
        ...normalizedCriteria,
        query: '',
      },
      priority_weights: weights,
      place_constraints: [{ place_id: placeId, max_distance_m: 2500 }],
      scoring_version: 'home-fit-v1',
      last_result_meta: sourceMetaOld,
      last_source_snapshot_ids: [snapshotOld],
    });
    expect(Number.isFinite(Date.parse(body.last_run_at))).toBe(true);
  });

  it('renames and deletes a saved search through owner-authenticated requests', async () => {
    const { fetchMock, state } = renderWorkspace();
    await waitFor(() => expect(state().savedSearches).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Rename saved search' }));
    await waitFor(() => expect(state().savedSearches[0].name).toBe('Renamed search'));
    const renameRequest = requestFor(fetchMock, `/api/v1/saved-searches/${savedSearch.id}`, 'PATCH');
    expect(renameRequest.credentials).toBe('include');
    expect(renameRequest.headers?.Authorization).toBeUndefined();
    expect(JSON.parse(renameRequest.body)).toEqual({ name: 'Renamed search' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete saved search' }));
    await waitFor(() => expect(state().savedSearches).toEqual([]));
    const deleteRequest = requestFor(fetchMock, `/api/v1/saved-searches/${savedSearch.id}`, 'DELETE');
    expect(deleteRequest.credentials).toBe('include');
    expect(deleteRequest.headers?.Authorization).toBeUndefined();
  });

  it('keeps current results until rerun succeeds, then retains source and result differences', async () => {
    let finishRerun;
    const { fetchMock, state } = renderWorkspace(<WorkspaceProbe />, {
      route: (path, options) => path === `/api/v1/saved-searches/${savedSearch.id}/run`
        ? new Promise((resolve) => { finishRerun = () => resolve(defaultFetch(path, options)); })
        : undefined,
    });
    await waitFor(() => expect(state().savedSearches).toHaveLength(1));
    await waitFor(() => expect(state().homes).toEqual([searchedHome]));

    fireEvent.click(screen.getByRole('button', { name: 'Rerun saved search' }));
    await waitFor(() => expect(state().savedSearchState.action).toBe('rerunning'));
    expect(state().homes).toEqual([searchedHome]);
    await waitFor(() => expect(finishRerun).toBeTypeOf('function'));
    finishRerun();

    await waitFor(() => expect(state().homes).toEqual(rerunHomes));
    expect(state().homeState).toMatchObject({ status: 'success', retrievedAt: timestampNew, sourceSummary: [{ sourceId: 'hdb-resale', sourceVersion: '2026-11', retrievedAt: timestampNew }] });
    expect(state().pagination).toMatchObject({ total: 3, hasMore: true, nextCursor: 'rerun-next-page' });
    expect(state().savedSearchState.reruns[savedSearch.id]).toMatchObject({
      priorMetadata: { sourceSnapshotIds: [snapshotOld], scorePolicyVersion: 'home-fit-v1' },
      metadata: { retrievedAt: timestampNew, scorePolicyVersion: 'home-fit-v2' },
      difference: {
        total: { previous: 2, current: 3, delta: 1 },
        sourceSnapshots: { added: [snapshotNew], removed: [snapshotOld] },
        scorePolicyVersion: { changed: true },
      },
    });
    const rerunRequest = requestFor(fetchMock, `/api/v1/saved-searches/${savedSearch.id}/run`, 'POST');
    expect(rerunRequest.credentials).toBe('include');
    expect(rerunRequest.headers?.Authorization).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Load more homes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options = {}]) => path === '/api/v1/search'
      && options.method === 'POST' && JSON.parse(options.body).cursor === 'rerun-next-page')).toBe(true));
    await waitFor(() => expect(state().homes).toEqual([...rerunHomes, searchedHome]));
  });

  it('preserves shortlist and compare home records when a rerun replaces the current page', async () => {
    const { state } = renderWorkspace();
    await waitFor(() => expect(state().homes).toEqual([searchedHome]));
    fireEvent.click(screen.getByRole('button', { name: 'Keep initial home in decisions' }));
    await waitFor(() => expect(state().shortlistIds).toContain(initialHome.id));
    expect(state().compareIds).toContain(initialHome.id);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun saved search' }));
    await waitFor(() => expect(state().homes).toEqual(rerunHomes));

    expect(state().shortlistHomes).toEqual([initialHome]);
    expect(state().selectedHomes).toEqual([initialHome]);
  });

  it('does not let a late rerun overwrite a newer live search', async () => {
    let finishRerun;
    let finishSearch;
    const { state } = renderWorkspace(<WorkspaceProbe />, {
      route: (path, options) => path === `/api/v1/saved-searches/${savedSearch.id}/run`
        ? new Promise((resolve) => { finishRerun = () => resolve(defaultFetch(path, options)); })
        : path === '/api/v1/search'
          ? new Promise((resolve) => { finishSearch = () => resolve(defaultFetch(path, options)); })
          : undefined,
    });
    await waitFor(() => expect(state().savedSearches).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Rerun saved search' }));
    await waitFor(() => expect(finishRerun).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Run current search' }));
    await waitFor(() => expect(finishSearch).toBeTypeOf('function'));
    finishSearch();
    await waitFor(() => expect(state().homes).toEqual([searchedHome]));
    finishRerun();

    await waitFor(() => expect(state().savedSearchState.action).toBeNull());
    expect(state().homes).toEqual([searchedHome]);
    expect(state().savedSearchState.reruns[savedSearch.id]).toBeUndefined();
  });

  it('keeps current results and exposes a missing-place error without broadening the rerun', async () => {
    const { fetchMock, state } = renderWorkspace(<WorkspaceProbe />, {
      route: (path, options) => path === `/api/v1/saved-searches/${savedSearch.id}/run`
        ? Promise.resolve(json({ detail: {
          code: 'SAVED_SEARCH_PLACE_UNAVAILABLE',
          message: 'One or more saved places are unavailable. Update the saved search before rerunning it.',
          missingPlaceIds: [placeId],
        } }, 409))
        : undefined,
    });
    await waitFor(() => expect(state().savedSearches).toHaveLength(1));
    await waitFor(() => expect(state().homes).toEqual([searchedHome]));
    const priorSearchCount = fetchMock.mock.calls.filter(([path]) => path === '/api/v1/search').length;

    fireEvent.click(screen.getByRole('button', { name: 'Rerun saved search' }));

    await waitFor(() => expect(state().savedSearchState.status).toBe('missing_place'));
    expect(state().homes).toEqual([searchedHome]);
    expect(state().savedSearchState.error).toMatchObject({ code: 'SAVED_SEARCH_PLACE_UNAVAILABLE', missingPlaceIds: [placeId] });
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/search')).toHaveLength(priorSearchCount);
  });

  it('requires authentication for saved-search operations without calling account endpoints', async () => {
    const { fetchMock, state } = renderWorkspace(<WorkspaceProbe />, { authenticated: false });

    await waitFor(() => expect(state().savedSearchState.status).toBe('signed_out'));
    fireEvent.click(screen.getByRole('button', { name: 'Try saving while signed out' }));
    await waitFor(() => expect(state().savedSearchState.error.code).toBe('AUTH_REQUIRED'));
    expect(state().history).toEqual([]);
    expect(state().savedSearches).toEqual([]);
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/history' || path.startsWith('/api/v1/saved-searches'))).toBe(false);
  });
});

describe('saved-search decision surfaces', () => {
  it('shows explicit empty states for account history and saved searches', async () => {
    renderWorkspace(<SavedDecisionSections />, {
      route: (path) => path === '/api/v1/history' || path === '/api/v1/saved-searches'
        ? Promise.resolve(json({ items: [] }))
        : undefined,
    });

    expect(await screen.findByText('No saved searches yet.')).toBeInTheDocument();
    expect(screen.getByText('No search history yet.')).toBeInTheDocument();
  });

  it('offers saving the current live search from Explore', async () => {
    const { fetchMock } = renderWorkspace(<ExplorePage />);

    const searchButton = await screen.findByRole('button', { name: 'Search', exact: true });
    await waitFor(() => expect(searchButton).toBeEnabled());
    fireEvent.click(searchButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search', exact: true })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Search presets' }));
    const saveButton = await screen.findByRole('button', { name: 'Save evidence search' });
    expect(saveButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Saved evidence search name' }), { target: { value: 'Workplace options' } });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(await screen.findByRole('heading', { name: 'Workplace options' })).toBeInTheDocument();
    expect(JSON.parse(requestFor(fetchMock, '/api/v1/saved-searches', 'POST').body).name).toBe('Workplace options');
  });

  it('shows source provenance in the Explore record sidebar', async () => {
    const detailHome = {
      ...initialHome,
      source: 'HDB resale transactions',
      sourceSemantics: 'historical_transaction',
      observedOn: '2026-07-01',
      sourceUpdated: '2026-10-10',
      geocodeStatus: 'resolved',
      highlights: [],
      risks: [],
      type: '3-room',
      price: 500000,
      town: 'Queenstown',
      risk: 'Historical record',
    };
    renderWorkspace(<ExplorePage />, {
      route: (path) => path === '/api/v1/homes' || path === '/api/v1/search'
        ? Promise.resolve(json({ items: [detailHome], dataMode: 'live', retrievedAt: timestampOld }))
        : undefined,
    });

    await screen.findByRole('button', { name: 'Details' });
    fireEvent.click(screen.getByText('Evidence & sources'));
    expect(screen.getAllByRole('region', { name: `Evidence context for ${detailHome.address}` })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('complementary', { name: detailHome.address });
    const evidence = within(dialog).getByRole('region', { name: `Evidence context for ${detailHome.address}` });
    fireEvent.click(within(evidence).getByText('Source and location provenance'));
    expect(within(evidence).getByText('HDB resale transactions')).toBeInTheDocument();
    expect(within(evidence).getByText('2026-10-10')).toBeInTheDocument();
  });

  it('shows sourceSummary retrieval times instead of the response timestamp', async () => {
    renderWorkspace(<SavedDecisionSections />);

    const searchHeading = await screen.findByRole('heading', { name: 'Near the office' });
    const searchRow = searchHeading.closest('article');
    const freshness = within(searchRow).getByText('Source freshness').parentElement;
    expect(freshness).toHaveTextContent('hdb-resale');
    expect(freshness).toHaveTextContent(new Date(sourceRetrievedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }));
    expect(freshness).toHaveTextContent('moe-school');
    expect(freshness).toHaveTextContent(new Date(schoolSourceRetrievedAt).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }));
    expect(freshness).not.toHaveTextContent(new Date(timestampOld).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }));
  });

  it('renders missing-place rerun failures in the account saved-search list', async () => {
    renderWorkspace(<SavedDecisionSections />, {
      route: (path) => path === `/api/v1/saved-searches/${savedSearch.id}/run`
        ? Promise.resolve(json({ detail: {
          code: 'SAVED_SEARCH_PLACE_UNAVAILABLE',
          message: 'One or more saved places are unavailable. Update the saved search before rerunning it.',
          missingPlaceIds: [placeId],
        } }, 409))
        : undefined,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Rerun Near the office' }));

    expect(await screen.findByText(/No search was run\. Use.*Edit criteria \/ repair places/i)).toBeInTheDocument();
    expect(screen.getByText(/Score policy/i)).toBeInTheDocument();
    expect(screen.getByText(/Source freshness/i)).toBeInTheDocument();
  });
});
