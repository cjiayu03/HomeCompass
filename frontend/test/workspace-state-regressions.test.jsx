import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { defaultBrief } from '../lib/data.js';
import { briefValidationError, buildCriteria } from '../lib/planning.js';

const { auth } = vi.hoisted(() => ({ auth: vi.fn(() => ({ user: null, loading: false })) }));
vi.mock('../components/auth-provider.jsx', () => ({ useAuth: auth }));
const first = { id: 'one', address: 'First source home', lat: 1.3, lng: 103.8, score: 79 };
const second = { id: 'two', address: 'Second source home', lat: 1.4, lng: 103.9, score: 60 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
let workspace;
function Probe() { workspace = useWorkspace(); return null; }
function setup(handler = () => undefined, children = <Probe />) {
  vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path, options = {}) => {
    calls.push([path, options]);
    const override = handler(path, options);
    if (override !== undefined) return override;
    if (path.startsWith('/api/v1/homes')) return json({ items: [first] });
    if (path.startsWith('/api/v1/resources')) return json({ features: [] });
    if (path === '/api/v1/search') return json({ items: [second] });
    if (path === '/api/v1/sources') return json({ items: [] });
    if (path === '/api/v1/profile') return json({ ...defaultBrief, budgetCents: defaultBrief.budget * 100 });
    if (path === '/api/v1/sync/guest') return json({ accepted: {}, skipped: {}, conflicts: [] });
    return json({ items: [] });
  }));
  const mounted = render(<WorkspaceProvider>{children}</WorkspaceProvider>);
  return { calls, ...mounted };
}
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); auth.mockReturnValue({ user: null, loading: false }); });

function UrlRestoreProbe() {
  const value = useWorkspace();
  workspace = value;
  const restored = useRef(false);
  useEffect(() => {
    if (!value.workspaceReady || restored.current) return;
    restored.current = true;
    value.applySearch('', { ...defaultBrief, budget: 430000, requirements: { budget: true } });
  }, [value.workspaceReady]);
  return null;
}

describe('durable decision workspace', () => {
  it('lets an explicit child URL restoration take precedence over the initial source request', async () => {
    const { calls } = setup(undefined, <UrlRestoreProbe />);
    await waitFor(() => expect(workspace.homeState.status).toBe('success'));
    expect(workspace.homes).toEqual([second]);
    expect(workspace.appliedBrief.budget).toBe(430000);
    expect(calls.filter(([path]) => path.startsWith('/api/v1/homes'))).toHaveLength(0);
  });

  it('applies restored structured preferences on the first request', async () => {
    window.localStorage.setItem('family-brief', JSON.stringify({ ...defaultBrief, budget: 420000, requirements: { budget: true }, preferredTowns: ['Bedok'], minStorey: 5 }));
    const { calls } = setup();
    await waitFor(() => expect(workspace.homeState.status).toBe('success'));
    const body = JSON.parse(calls.find(([path]) => path === '/api/v1/search')[1].body);
    expect(body).toMatchObject({ budget: 420000, towns: ['Bedok'], min_storey: 5 });
    expect(workspace.appliedBrief.budget).toBe(420000);
  });

  it('keeps saved and comparison objects across unrelated search, refresh and browser reload', async () => {
    let mounted = setup();
    await waitFor(() => expect(workspace.homes).toEqual([first]));
    await act(async () => { await workspace.ensureSaved(first, true); await workspace.ensureSaved(first, true); workspace.toggleCompare(first); });
    await act(async () => { await workspace.applySearch(''); await workspace.retryHomes(); });
    expect(workspace.shortlistIds).toEqual(['one']);
    expect(workspace.shortlistHomes).toEqual([first]);
    expect(workspace.selectedHomes).toEqual([first]);
    mounted.unmount();
    mounted = setup();
    await waitFor(() => expect(workspace.shortlistHomes).toEqual([first]));
    expect(workspace.selectedHomes).toEqual([first]);
  });

  it('submits an override atomically, tracks the applied snapshot, and retries that request', async () => {
    let failed = true;
    const { calls } = setup((path) => path === '/api/v1/search' && failed ? json({ detail: 'Offline' }, 503) : undefined);
    await waitFor(() => expect(workspace.homeState.status).toBe('success'));
    const draft = { ...defaultBrief, budget: 420000, requirements: { budget: true }, minFloorArea: 80 };
    await act(async () => { await workspace.applySearch('', draft); });
    expect(workspace.homeState.status).toBe('error');
    expect(workspace.appliedBrief.budget).toBe(defaultBrief.budget);
    act(() => workspace.setBrief(current => ({ ...current, budget: 700000 })));
    failed = false;
    await act(async () => { await workspace.retryHomes(); });
    const bodies = calls.filter(([path]) => path === '/api/v1/search').map(([, options]) => JSON.parse(options.body));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toMatchObject({ budget: 420000, min_floor_area_sqm: 80 });
    expect(workspace.appliedBrief.budget).toBe(420000);
    expect(workspace.searchDirty).toBe(true);
  });

  it('restores neutral defaults on reset and only applies geography when explicitly requested', async () => {
    const { calls } = setup();
    await waitFor(() => expect(workspace.homeState.status).toBe('success'));
    const bounds = { west: 103.7, south: 1.2, east: 103.9, north: 1.4 };
    await act(async () => { await workspace.refreshViewport(bounds); await workspace.applySearch(''); });
    expect(JSON.parse(calls.filter(([path]) => path === '/api/v1/search').at(-1)[1].body)).not.toHaveProperty('bounds');
    await act(async () => { await workspace.searchBounds(bounds); });
    expect(JSON.parse(calls.filter(([path]) => path === '/api/v1/search').at(-1)[1].body).bounds).toEqual(bounds);
    await act(async () => { await workspace.resetSearch(); });
    expect(workspace.brief).toEqual(defaultBrief);
    expect(workspace.appliedBrief).toEqual(defaultBrief);
    expect(workspace.appliedBounds).toBeNull();
    expect(workspace.searchDirty).toBe(false);
    expect(defaultBrief.children).toBe(0);
    expect(defaultBrief.olderAdults).toBe(0);
    expect(buildCriteria(defaultBrief)).toEqual({});
  });

  it('keeps explicit guest pins local, filters by straight-line evidence and clears browser data', async () => {
    const { calls } = setup();
    await waitFor(() => expect(workspace.homeState.status).toBe('success'));
    let place;
    await act(async () => { place = await workspace.createPlace({ provider: 'user-entered', address: 'Private home', label: 'My pin', kind: 'other', latitude: 1.4, longitude: 103.9 }); });
    expect(place.geocodeSource).toBe('user-entered');
    expect(workspace.placeState.status).toBe('local');
    await act(async () => { await workspace.applySearch('', { ...workspace.brief, placeConstraints: [{ placeId: place.id, maxDistanceM: 100 }] }); });
    expect(workspace.homes[0].placeDistances[0]).toMatchObject({ distanceM: 0, method: 'straight-line', localOnly: true });
    expect(JSON.parse(calls.find(([path]) => path === '/api/v1/search')[1].body).place_constraints).toEqual([]);
    const event = vi.fn(); window.addEventListener('homecompass:clear-local-data', event);
    await act(async () => { await workspace.clearLocalData(); });
    expect(workspace.places).toEqual([]);
    expect(workspace.shortlistHomes).toEqual([]);
    expect(workspace.history).toEqual([]);
    expect(workspace.brief).toEqual(defaultBrief);
    expect(event).toHaveBeenCalledOnce();
    expect(calls.some(([path, options]) => path.startsWith('/api/v1/places') && options.method)).toBe(false);
    window.removeEventListener('homecompass:clear-local-data', event);
  });

  it('surfaces rejected profile synchronization and supports retry', async () => {
    auth.mockReturnValue({ user: { id: 'test-account' }, loading: false });
    let rejectProfile = true;
    setup((path, options) => path === '/api/v1/profile' && options.method === 'PUT' ? json({}, rejectProfile ? 503 : 200) : undefined);
    await waitFor(() => expect(workspace.profileSyncState.status).toBe('error'), { timeout: 3000 });
    expect(workspace.profileSyncState.error).toBeTruthy();
    rejectProfile = false;
    await act(async () => { await workspace.retryProfileSync(); });
    expect(workspace.profileSyncState.status).toBe('synced');
  });
});

describe('search validation', () => {
  it.each([
    [{ budget: -1 }, /budget/i], [{ budget: 1.5 }, /budget/i],
    [{ minFloorArea: 'not a number' }, /area/i], [{ minFloorArea: -1 }, /area/i],
    [{ minFloorArea: 100, maxFloorArea: 80 }, /minimum.*maximum/i],
    [{ minLease: 100 }, /lease/i], [{ maxPricePerSqm: Infinity }, /price/i],
    [{ schoolDistance: 100001 }, /distance/i], [{ careDistance: 1.5 }, /distance/i],
    [{ observedAfter: '2026-02-31' }, /date/i], [{ children: -1 }, /children/i],
  ])('rejects invalid numeric and cross-field values %j', (patch, expected) => {
    expect(briefValidationError({ ...defaultBrief, ...patch })).toMatch(expected);
  });
});
