import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AccountPage from '../app/(workspace)/account/page.jsx';
import { PlanningProvider } from '../components/planning-provider.jsx';
import ComparePage from '../app/(workspace)/compare/page.jsx';
import { HomeCard } from '../components/home-card.jsx';
import { PlaceDistanceList, PlacePicker } from '../components/place-picker.jsx';
import { PlaceManager } from '../components/place-manager.jsx';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { defaultBrief, homes as fixtureHomes } from '../lib/data.js';

const { useAuthMock, routerReplaceMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ user: null })),
  routerReplaceMock: vi.fn(),
}));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: routerReplaceMock }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/components/ui/number-ticker', () => ({ NumberTicker: ({ value }) => <span>{value}</span> }));

const placeId = '11111111-1111-4111-8111-111111111111';
const otherPlaceId = '22222222-2222-4222-8222-222222222222';
const firstCandidate = {
  address: '8 Harbour Road, Singapore 098xxx',
  latitude: 1.2712,
  longitude: 103.8194,
  provider: 'OneMap',
  selection_token: 'a'.repeat(64),
};
const secondCandidate = {
  address: '18 Harbour Road, Singapore 098xxx',
  latitude: 1.2722,
  longitude: 103.8204,
  provider: 'OneMap',
  selection_token: 'b'.repeat(64),
};
const savedPlace = {
  id: placeId,
  label: 'Office',
  address: '8 Harbour Road, Singapore 098xxx',
  latitude: 1.2712,
  longitude: 103.8194,
  kind: 'workplace',
  geocodeSource: 'OneMap',
  geocodedAt: '2026-10-19T10:00:00+00:00',
  maximumDistanceM: 2500,
};
const secondSavedPlace = {
  ...savedPlace,
  id: otherPlaceId,
  label: 'B workplace',
  address: '18 Harbour Road, Singapore 098xxx',
};
const accountWorkspaceKey = 'homecompass.account.user-1.workspace';

function setAccountWorkspace(userId, workspace) {
  window.localStorage.setItem(`homecompass.account.${encodeURIComponent(userId)}.workspace`, JSON.stringify(workspace));
}

function setAccountBrief(brief) {
  window.localStorage.setItem(accountWorkspaceKey, JSON.stringify({ brief }));
}

function readAccountBrief() {
  return JSON.parse(window.localStorage.getItem(accountWorkspaceKey))?.brief;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function defaultFetch(path, options = {}) {
  if (path === '/api/v1/auth/session') return Promise.resolve(json({ user: useAuthMock().user ?? null }));
  if (path === '/api/v1/homes') return Promise.resolve(json({ items: [] }));
  if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [] }));
  if (path === '/api/v1/sources') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/shortlists') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/profile' && options.method === 'PUT') return Promise.resolve(json({}));
  if (path === '/api/v1/profile') return Promise.resolve(json({ adults: 2, children: 1, olderAdults: 1, budgetCents: 55000000 }));
  if (path === '/api/v1/places' && (!options.method || options.method === 'GET')) return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/search') return Promise.resolve(json({ items: [] }));
  throw new Error(`Unexpected request: ${path}`);
}

function authenticatedUser() {
  useAuthMock.mockReturnValue({
    user: { id: 'user-1', email: 'person@example.com' },
  });
}

function authenticatedAccount() {
  const refreshSession = vi.fn().mockResolvedValue(null);
  useAuthMock.mockReturnValue({ refreshSession, user: { id: 'user-1', email: 'person@example.com' } });
  return { refreshSession };
}

function renderWorkspace(children) {
  return render(<WorkspaceProvider>{children}</WorkspaceProvider>);
}

function SearchButton() {
  const { applySearch, brief } = useWorkspace();
  return <><button onClick={() => applySearch('')}>Search with saved places</button><output data-testid="brief">{JSON.stringify(brief)}</output></>;
}

function PlacesStateProbe() {
  const { places, placeState, brief } = useWorkspace();
  return <output data-testid="places-state">{JSON.stringify({ places, placeState, brief })}</output>;
}

function PlaceLifecycleProbe() {
  const { places, placeState, brief, createPlace, deletePlace } = useWorkspace();
  return <>
    <output data-testid="place-lifecycle-state">{JSON.stringify({ places, placeState, brief })}</output>
    <button onClick={() => createPlace({ ...firstCandidate, label: 'A new place', kind: 'workplace', maximumDistanceM: 2500 })}>Create A place</button>
    <button onClick={() => deletePlace(placeId)}>Delete A place</button>
  </>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ user: null });
});

describe('family place management and filtering', () => {
  it('clears typed address and candidate selection when the Account page owner changes', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'user-a', email: 'a@example.com' } });
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/auth/session') return Promise.resolve(json({ user: useAuthMock().user ?? null }));
  if (path === '/api/v1/sync/guest') return Promise.resolve(json({ accepted: {}, skipped: {}, conflicts: [] }));
      if (path.startsWith('/api/v1/places/suggest?')) return Promise.resolve(json({ items: [firstCandidate] }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWorkspace(<AccountPage />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Place label' }), { target: { value: 'A private label' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search an address' }), { target: { value: 'A private address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find address candidates' }));
    const candidate = await screen.findByRole('radio', { name: `Select ${firstCandidate.address}` });
    fireEvent.click(candidate);
    expect(candidate).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeEnabled();

    useAuthMock.mockReturnValue({ user: { id: 'user-b', email: 'b@example.com' } });
    view.rerender(<WorkspaceProvider><AccountPage /></WorkspaceProvider>);

    expect(screen.getByRole('textbox', { name: 'Place label' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Search an address' })).toHaveValue('');
    expect(screen.queryByRole('radio', { name: `Select ${firstCandidate.address}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeDisabled();
  });

  it('loads ambiguous address candidates with their provider label', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options) => {
      if (path.startsWith('/api/v1/places/suggest?')) return Promise.resolve(json({ items: [firstCandidate, secondCandidate] }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<PlaceManager />);

    const query = screen.getByRole('textbox', { name: 'Search an address' });
    fireEvent.change(query, { target: { value: 'Harbour Road' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find address candidates' }));

    expect(await screen.findByLabelText(`Select ${firstCandidate.address}`)).toBeInTheDocument();
    expect(screen.getByLabelText(`Select ${secondCandidate.address}`)).toBeInTheDocument();
    expect(screen.getAllByText('OneMap address candidate')).toHaveLength(2);
    const [, placesRequest] = fetchMock.mock.calls.find(([path]) => path === '/api/v1/places');
    expect(placesRequest.credentials).toBe('include');
    expect(placesRequest.headers?.Authorization).toBeUndefined();
    const [suggestionPath, suggestionRequest] = fetchMock.mock.calls.find(([path]) => path.startsWith('/api/v1/places/suggest?'));
    expect(suggestionPath).toBe('/api/v1/places/suggest?q=Harbour+Road');
    expect(suggestionRequest.credentials).toBe('include');
    expect(suggestionRequest.headers?.Authorization).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeDisabled();
  });

  it('creates only the explicitly selected candidate and adds the returned account place', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/places' && options.method === 'POST') {
        return Promise.resolve(json({ id: otherPlaceId, ...JSON.parse(options.body), geocoded_at: '2026-10-20T10:00:00+00:00' }));
      }
      if (path.startsWith('/api/v1/places/suggest?')) return Promise.resolve(json({ items: [firstCandidate, secondCandidate] }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<PlaceManager />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Place label' }), { target: { value: 'School pickup' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Place type' }), { target: { value: 'school' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search an address' }), { target: { value: 'Harbour Road' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find address candidates' }));
    const secondChoice = await screen.findByLabelText(`Select ${secondCandidate.address}`);
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeDisabled();
    fireEvent.click(secondChoice);

    fireEvent.click(screen.getByRole('button', { name: 'Save selected place' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/places' && options.method === 'POST')).toBe(true));
    const [, createRequest] = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/places' && options.method === 'POST');
    expect(createRequest.credentials).toBe('include');
    expect(createRequest.headers?.Authorization).toBeUndefined();
    expect(JSON.parse(createRequest.body)).toEqual({
      label: 'School pickup',
      kind: 'school',
      address: secondCandidate.address,
      latitude: secondCandidate.latitude,
      longitude: secondCandidate.longitude,
      maximum_distance_m: 2500,
      geocode_source: 'OneMap',
      selection_token: secondCandidate.selection_token,
    });
    expect(JSON.parse(createRequest.body).address).not.toBe(firstCandidate.address);
    expect(await screen.findByText('School pickup')).toBeInTheDocument();
  });

  it('deletes an account place through the authenticated route', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/places' && (!options.method || options.method === 'GET')) return Promise.resolve(json({ items: [savedPlace] }));
      if (path === `/api/v1/places/${placeId}` && options.method === 'DELETE') return Promise.resolve(json({ status: 'deleted' }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<PlaceManager />);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Office' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/v1/places/${placeId}`, expect.objectContaining({
      method: 'DELETE',
      credentials: 'include',
    })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Office' })).not.toBeInTheDocument());
  });

  it('does not add an A place when its create response arrives after switching to B', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    setAccountWorkspace('user-1', {
      brief: { ...defaultBrief, adults: 5, placeConstraints: [{ placeId, maxDistanceM: 2500 }] },
      shortlistIds: [], compareIds: [],
    });
    setAccountWorkspace('user-2', {
      brief: { ...defaultBrief, adults: 7, placeConstraints: [{ placeId: otherPlaceId, maxDistanceM: 1800 }] },
      shortlistIds: [], compareIds: [],
    });
    let finishCreate;
    const fetchMock = vi.fn(async (path, options = {}) => {
      const owner = useAuthMock().user?.id;
      if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
      if (path === '/api/v1/shortlists') return json({ items: [] });
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile') return json({ adults: owner === 'user-1' ? 5 : 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === '/api/v1/places' && options.method === 'POST') return new Promise((resolve) => { finishCreate = resolve; });
      if (path === '/api/v1/places') return json({ items: owner === 'user-1' ? [savedPlace] : [secondSavedPlace] });
      if (path === '/api/v1/homes') return json({ items: [] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: { id: 'user-1', email: 'a@example.com' } });
    const view = renderWorkspace(<PlaceLifecycleProbe />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent).places.map((place) => place.id)).toEqual([placeId]));
    fireEvent.click(screen.getByRole('button', { name: 'Create A place' }));
    await waitFor(() => expect(finishCreate).toBeTypeOf('function'));

    useAuthMock.mockReturnValue({ user: { id: 'user-2', email: 'b@example.com' } });
    view.rerender(<WorkspaceProvider><PlaceLifecycleProbe /></WorkspaceProvider>);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent).places.map((place) => place.id)).toEqual([otherPlaceId]));
    await act(async () => finishCreate(json({ ...savedPlace, id: 'created-for-a', label: 'A new place' })));

    expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent)).toMatchObject({
      places: [secondSavedPlace],
      brief: { adults: 7, placeConstraints: [{ placeId: otherPlaceId, maxDistanceM: 1800 }] },
    });
  });

  it('does not apply an A place deletion response to B places or constraints', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    setAccountWorkspace('user-1', {
      brief: { ...defaultBrief, adults: 5, placeConstraints: [{ placeId, maxDistanceM: 2500 }] },
      shortlistIds: [], compareIds: [],
    });
    setAccountWorkspace('user-2', {
      brief: { ...defaultBrief, adults: 7, placeConstraints: [{ placeId: otherPlaceId, maxDistanceM: 1800 }] },
      shortlistIds: [], compareIds: [],
    });
    let finishDelete;
    const fetchMock = vi.fn(async (path, options = {}) => {
      const owner = useAuthMock().user?.id;
      if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
      if (path === '/api/v1/shortlists') return json({ items: [] });
      if (path === '/api/v1/profile' && options.method === 'PUT') return json({});
      if (path === '/api/v1/profile') return json({ adults: owner === 'user-1' ? 5 : 7, children: 1, olderAdults: 0, budgetCents: 55000000, priorityWeights: defaultBrief.priorityWeights });
      if (path === `/api/v1/places/${placeId}` && options.method === 'DELETE') return new Promise((resolve) => { finishDelete = resolve; });
      if (path === '/api/v1/places') return json({ items: owner === 'user-1' ? [savedPlace] : [secondSavedPlace] });
      if (path === '/api/v1/homes') return json({ items: [] });
      if (path.startsWith('/api/v1/resources')) return json({ features: [] });
      if (path === '/api/v1/sources') return json({ items: [] });
      throw new Error(`Unexpected request: ${options.method || 'GET'} ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    useAuthMock.mockReturnValue({ user: { id: 'user-1', email: 'a@example.com' } });
    const view = renderWorkspace(<PlaceLifecycleProbe />);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent).places.map((place) => place.id)).toEqual([placeId]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete A place' }));
    await waitFor(() => expect(finishDelete).toBeTypeOf('function'));

    useAuthMock.mockReturnValue({ user: { id: 'user-2', email: 'b@example.com' } });
    view.rerender(<WorkspaceProvider><PlaceLifecycleProbe /></WorkspaceProvider>);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent).places.map((place) => place.id)).toEqual([otherPlaceId]));
    await act(async () => finishDelete(json({ status: 'deleted' })));

    expect(JSON.parse(screen.getByTestId('place-lifecycle-state').textContent)).toMatchObject({
      places: [secondSavedPlace],
      placeState: { status: 'success' },
      brief: { adults: 7, placeConstraints: [{ placeId: otherPlaceId, maxDistanceM: 1800 }] },
    });
  });

  it('ignores an account A places response that arrives after switching to B', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    let finishA;
    vi.stubGlobal('fetch', vi.fn((path, options = {}) => {
      if (path === '/api/v1/places') {
        const ownerId = useAuthMock().user?.id;
        if (ownerId === 'user-1') return new Promise((resolve) => { finishA = resolve; });
        return Promise.resolve(json({ items: [secondSavedPlace] }));
      }
      return defaultFetch(path, options);
    }));
    useAuthMock.mockReturnValue({ user: { id: 'user-1', email: 'a@example.com' } });
    const view = renderWorkspace(<PlacesStateProbe />);
    await waitFor(() => expect(finishA).toBeTypeOf('function'));
    useAuthMock.mockReturnValue({ user: { id: 'user-2', email: 'b@example.com' } });
    view.rerender(<WorkspaceProvider><PlacesStateProbe /></WorkspaceProvider>);
    await waitFor(() => expect(JSON.parse(screen.getByTestId('places-state').textContent).places.map(place => place.id)).toEqual([otherPlaceId]));
    await act(async () => finishA(json({ items: [savedPlace] })));
    expect(JSON.parse(screen.getByTestId('places-state').textContent).places.map(place => place.id)).toEqual([otherPlaceId]);
  });

  it('shows provider errors without exposing a candidate or submitting coordinates', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options) => {
      if (path.startsWith('/api/v1/places/suggest?')) return Promise.resolve(json({ detail: { code: 'ONEMAP_UNAVAILABLE' } }, 502));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<PlaceManager />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Place label' }), { target: { value: 'Office' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search an address' }), { target: { value: 'Harbour Road' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find address candidates' }));

    expect(await screen.findByText('Unable to load this information. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/places' && options.method === 'POST')).toBe(false);
  });

  it('keeps place management safe while signed out', async () => {
    useAuthMock.mockReturnValue({ user: null });
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn(defaultFetch);
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<PlaceManager />);

    expect(await screen.findByText('Add a browser place')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/places' || path.startsWith('/api/v1/places/suggest?'))).toBe(false);
    fireEvent.change(screen.getByRole('textbox',{name:'Search an address'}),{target:{value:'Harbour Road'}});
    expect(screen.getByRole('button', { name: 'Find address candidates' })).toBeEnabled();
  });

  it('does not turn saved brief IDs into local places when the server list fails', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    setAccountBrief({
      placeConstraints: [{ placeId, maxDistanceM: 1000 }],
    });
    const fetchMock = vi.fn((path, options) => {
      if (path === '/api/v1/places') return Promise.resolve(json({ detail: { code: 'PLACES_DOWN' } }, 503));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<><PlaceManager /><PlacesStateProbe /></>);

    await waitFor(() => expect(JSON.parse(screen.getByTestId('places-state').textContent).placeState.status).toBe('error'));
    const state = JSON.parse(screen.getByTestId('places-state').textContent);
    expect(state.places).toEqual([]);
    expect(state.placeState.error.code).toBe('PLACES_DOWN');
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
  });

  it('serializes selected place IDs and distances into the saved brief and search request', async () => {
    authenticatedUser();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/places' && (!options.method || options.method === 'GET')) return Promise.resolve(json({ items: [savedPlace] }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<><PlacePicker /><SearchButton /></>);

    const includePlace = await screen.findByRole('checkbox', { name: 'Use Office in this search' });
    fireEvent.click(includePlace);
    const distanceInput = screen.getByRole('spinbutton', { name: 'Office maximum straight-line distance in metres' });
    fireEvent.change(distanceInput, { target: { value: '1800' } });

    await waitFor(() => expect(JSON.parse(screen.getByTestId('brief').textContent).placeConstraints).toEqual([
      { placeId, maxDistanceM: 1800 },
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'Search with saved places' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/search' && options.method === 'POST')).toBe(true));
    await waitFor(()=>expect(fetchMock.mock.calls.some(([path,options={}])=>path==='/api/v1/search' && options.method==='POST' && JSON.parse(options.body).place_constraints.some(c=>c.place_id===placeId&&c.max_distance_m===1800))).toBe(true));
    const [, searchRequest] = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/search' && options.method === 'POST' && JSON.parse(options.body).place_constraints.some(c=>c.place_id===placeId&&c.max_distance_m===1800));
    expect(JSON.parse(searchRequest.body).place_constraints).toEqual([{ place_id: placeId, max_distance_m: 1800 }]);
    expect(searchRequest.credentials).toBe('include');
    expect(searchRequest.headers?.Authorization).toBeUndefined();
    await waitFor(() => expect(readAccountBrief().placeConstraints).toEqual([
      { placeId, maxDistanceM: 1800 },
    ]));
    expect(screen.getByText(/straight-line distance estimate/i)).toBeInTheDocument();
  });

  it('labels returned place distances as straight-line estimates and keeps missing values unavailable', () => {
    render(<PlaceDistanceList distances={[
      { placeId, label: 'Office', distanceM: 425, maximumDistanceM: 1000, method: 'straight-line' },
      { placeId: otherPlaceId, label: 'School', distanceM: null, maximumDistanceM: 1500, method: 'straight-line' },
    ]} />);

    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('425 m')).toBeInTheDocument();
    expect(screen.getByText('School')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText(/Straight-line distance estimate/)).toHaveLength(2);
    expect(screen.queryByText(/commute|transit/i)).not.toBeInTheDocument();
  });

  it('shows straight-line place distances in reusable HomeCard without turning missing values into zero', () => {
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE','fixture');
    renderWorkspace(<HomeCard
      home={{
        ...fixtureHomes[0],
        placeDistances: [
          { placeId, label: 'Office', distanceM: 425, maximumDistanceM: 1000, method: 'straight-line' },
          { placeId: otherPlaceId, label: 'School', distanceM: null, maximumDistanceM: 1500, method: 'straight-line' },
        ],
      }}
      saved={false}
      selected={false}
      onSave={() => {}}
      onCompare={() => {}}
      onInspect={() => {}}
      compact
    />);

    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('425 m')).toBeInTheDocument();
    expect(screen.getByText('School')).toBeInTheDocument();
    expect(screen.getByText('Unavailable', { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText(/Straight-line distance estimate/)).toHaveLength(2);
    expect(screen.queryByText('0 m', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/commute|transit/i)).not.toBeInTheDocument();
  });

  it('shows returned straight-line place distances in Compare and preserves unavailable values', async () => {
    const compareHomes = [
      {
        ...fixtureHomes[0],
        placeDistances: [{ placeId, label: 'Office', distanceM: 425, maximumDistanceM: 1000, method: 'straight-line' }],
      },
      {
        ...fixtureHomes[1],
        placeDistances: [{ placeId: otherPlaceId, label: 'School', distanceM: null, maximumDistanceM: 1500, method: 'straight-line' }],
      },
    ];
    window.localStorage.setItem('compare-selection', JSON.stringify(compareHomes.map((home) => home.id)));
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    vi.stubGlobal('fetch', vi.fn((path, options = {}) => path === '/api/v1/search' && options.method === 'POST'
      ? Promise.resolve(json({ items: compareHomes }))
      : defaultFetch(path, options)));
    renderWorkspace(<PlanningProvider><SearchButton /><ComparePage /></PlanningProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Search with saved places' }));

    const table=await screen.findByRole('table',{name:'Candidate evidence comparison'});
    await waitFor(() => expect(within(table).getAllByText(/Straight-line distance estimate/)).toHaveLength(2));
    expect(within(table).getByText('Office')).toBeInTheDocument();
    expect(within(table).getByText('425 m')).toBeInTheDocument();
    expect(within(table).getByText('School')).toBeInTheDocument();
    expect(within(table).getAllByText('Unavailable', { exact: true }).length).toBeGreaterThan(0);
    expect(within(table).queryByText('0 m', { exact: true })).not.toBeInTheDocument();
    expect(within(table).queryByText(/commute|transit/i)).not.toBeInTheDocument();
  });

  it('clears deleted place constraints from persisted brief state before later searches', async () => {
    const client = authenticatedAccount();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    setAccountBrief({
      ...defaultBrief,
      placeConstraints: [{ placeId, maxDistanceM: 1000 }],
    });
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/account' && options.method === 'DELETE') return Promise.resolve(json({ status: 'deleted' }));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<><AccountPage /><SearchButton /></>);

    await waitFor(() => expect(readAccountBrief().placeConstraints).toEqual([
      { placeId, maxDistanceM: 1000 },
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account', exact: true }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(client.refreshSession).toHaveBeenCalled());
    expect(window.localStorage.getItem(accountWorkspaceKey)).toBeNull();
    expect((JSON.parse(screen.getByTestId('brief').textContent).placeConstraints || [])).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Search with saved places' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/search' && options.method === 'POST')).toBe(true));
    const [, searchRequest] = fetchMock.mock.calls.filter(([path, options]) => path === '/api/v1/search' && options.method === 'POST').at(-1);
    expect(JSON.parse(searchRequest.body).place_constraints).toEqual([]);
  });

  it('keeps place constraints when account deletion fails', async () => {
    const client = authenticatedAccount();
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const savedConstraints = [{ placeId, maxDistanceM: 1000 }];
    setAccountBrief({ ...defaultBrief, placeConstraints: savedConstraints });
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/account' && options.method === 'DELETE') return Promise.resolve(json({ detail: { message: 'Deletion unavailable.' } }, 503));
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWorkspace(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete account', exact: true }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/account', expect.objectContaining({ method: 'DELETE' })));
    expect(client.refreshSession).not.toHaveBeenCalled();
    expect(readAccountBrief().placeConstraints).toEqual(savedConstraints);
  });
});
