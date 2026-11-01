import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataStatus } from '../components/data-status.jsx';
import ExplorePage from '../app/(workspace)/explore/page.jsx';
import { MapPanel } from '../components/map-panel.jsx';
import SourcesPage from '../app/(workspace)/sources/page.jsx';

const { useWorkspaceMock } = vi.hoisted(() => ({ useWorkspaceMock: vi.fn() }));

vi.mock('../components/workspace-provider.jsx', () => ({ useWorkspace: useWorkspaceMock }));
vi.mock('../components/planning-provider.jsx', () => ({ usePlanning: () => ({ scenarios: [], decisions: {}, photos: {} }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('../components/auth-provider.jsx', () => ({ useAuth: () => ({ client: null, user: null }) }));
vi.mock('next/dynamic', () => ({ default: () => function MapCanvas({ resources = [], denguePolicy }) { return <div data-testid="map-canvas" data-dengue-count={resources.filter(feature => feature.properties?.resourceType === 'dengue_cluster').length} data-dengue-state={denguePolicy?.state || ''} />; } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('../components/brief-ribbon.jsx', () => ({ BriefRibbon: () => <div /> }));
vi.mock('../components/home-card.jsx', () => ({ HomeCard: ({ home }) => <div data-testid="home-card">{home.address}</div> }));
vi.mock('../components/ui/blur-fade.jsx', () => ({ BlurFade: ({ children }) => <>{children}</> }));
vi.mock('../components/ui/number-ticker.jsx', () => ({ NumberTicker: ({ value, className }) => <span className={className}>{value}</span> }));

function dataState(overrides = {}) {
  return {
    status: 'success',
    dataMode: 'live',
    retrievedAt: null,
    sourceSummary: [],
    warnings: [],
    error: null,
    ...overrides,
  };
}

function workspace(overrides = {}) {
  const noop = vi.fn();
  return {
    brief: { adults: 2, children: 0, olderAdults: 0, budget: 500000, schoolDistance: 500, careDistance: 500, priorityWeights: {} },
    setBrief: noop,
    homes: [],
    homeState: dataState({ status: 'loading' }),
    resourceFeatures: [],
    resourceState: dataState({ status: 'loading' }),
    sourceStatus: null,
    sourceState: dataState({ status: 'loading' }),
    fixtureMode: false,
    query: '',
    setQuery: noop,
    selectedHomes: [],
    shortlistIds: [],
    shortlistHomes: [],
    workspaceReady: false,
    toggleShortlist: noop,
    toggleCompare: noop,
    applySearch: noop,
    resetSearch: noop,
    retryHomes: noop,
    retryResources: noop,
    busy: false,
    ...overrides,
  };
}

beforeEach(() => {
  useWorkspaceMock.mockReturnValue(workspace());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('DataStatus', () => {
  it('labels fixture data as illustrative preview data', () => {
    render(<DataStatus state={dataState({ dataMode: 'fixture' })} />);

    expect(screen.getByRole('status')).toHaveTextContent(/preview/i);
    expect(screen.getByRole('status')).toHaveTextContent(/illustrative/i);
    expect(screen.getByRole('status')).toHaveTextContent(/not verified/i);
  });

  it('shows a retry button for an error and calls the supplied callback', () => {
    const onRetry = vi.fn();
    render(<DataStatus state={dataState({ status: 'error', error: { message: 'The request failed.' } })} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The request failed.');
    fireEvent.click(screen.getByRole('button', { name: /retry data/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a successful live-empty message without describing fixtures', () => {
    render(<DataStatus state={dataState({ status: 'empty' })} emptyMessage="No source records match these filters." />);

    expect(screen.getByRole('status')).toHaveTextContent('No source records match these filters.');
    expect(screen.getByRole('status')).not.toHaveTextContent(/fixture|preview/i);
  });

  it('shows supplied source and retrieval metadata without claiming freshness', () => {
    const retrievedAt = '2026-10-18T12:00:00+00:00';
    render(<DataStatus state={dataState({
      retrievedAt,
      sourceSummary: [{ sourceId: 'hdb-resale', sourceVersion: '2026-09' }],
    })} />);

    expect(screen.getByRole('status')).toHaveTextContent('hdb-resale');
    expect(screen.getByRole('status')).toHaveTextContent(retrievedAt);
    expect(screen.getByRole('status')).toHaveTextContent(/retrieved/i);
    expect(screen.getByRole('status')).toHaveTextContent(/historical transaction records are not current listings/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/fresh|up to date/i);
  });

  it('omits the Retrieved-at line when retrieval time is absent', () => {
    render(<DataStatus state={dataState({ retrievedAt: null })} />);

    expect(screen.getByRole('status')).not.toHaveTextContent(/retrieved at/i);
    expect(screen.queryByText(/retrieved at/i)).not.toBeInTheDocument();
  });

  it('uses status semantics for loading and alert semantics for errors', () => {
    const { rerender } = render(<DataStatus state={dataState({ status: 'loading' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    rerender(<DataStatus state={dataState({ status: 'error', error: { message: 'Unavailable.' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unavailable.');
  });
});

describe('workspace status integration', () => {
  it('keeps existing home cards visible while a live refresh is loading', () => {
    useWorkspaceMock.mockReturnValue(workspace({
      homes: [{ id: 'previous-home', address: 'Previously loaded home' }],
      homeState: dataState({ status: 'loading' }),
      resourceState: dataState({ status: 'empty' }),
      busy: true,
    }));

    render(<ExplorePage />);

    expect(screen.getByText('Previously loaded home')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Searching…' })) {
      expect(button).toBeDisabled();
    }
  });

  it('shows and retries an initial live Explore error without installing fixture data', () => {
    const retryHomes = vi.fn();
    useWorkspaceMock.mockReturnValue(workspace({
      homeState: dataState({ status: 'error', error: { message: 'Live home data is unavailable.' } }),
      resourceState: dataState({ status: 'empty' }),
      retryHomes,
    }));

    render(<ExplorePage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Live home data is unavailable.');
    expect(screen.getByRole('region', { name: 'Movable OpenStreetMap view' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Historical transaction results' })).toHaveTextContent('Housing evidence unavailable');
    expect(screen.getByRole('region', { name: 'Historical transaction results' })).not.toHaveTextContent('No places found');
    expect(screen.queryByText(/illustrative fixture/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry home data/i }));
    expect(retryHomes).toHaveBeenCalledTimes(1);
  });

  it('keeps map resource counts visible and retries through the resource callback', () => {
    const retryResources = vi.fn();
    const resource = { id: 'resource-1', properties: { resourceType: 'silver_zone' } };
    render(<MapPanel
      homes={[]}
      resources={[resource]}
      sourceStatus={{ imported: 2, registered: 3 }}
      resourceState={dataState({ status: 'error', retrievedAt: '2026-10-18T12:00:00+00:00', error: { message: 'Resource refresh failed.' } })}
      retryResources={retryResources}
    />);

    expect(screen.getByRole('alert')).toHaveTextContent(/showing previous results/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Resource refresh failed.');
    expect(screen.getByText('Silver Zones')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry resource data/i }));
    expect(retryResources).toHaveBeenCalledTimes(1);
  });

  it('shows the fresh NEA red and yellow legend with the source timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-30T09:00:00.000Z'));
    const updated = '2026-10-30T08:00:00.000Z';
    const policy = { state: 'fresh', fresh: true, usable: true, complete: true, rows: 2, sourceUpdatedAt: updated, validUntil: '2026-11-01T08:00:00.000Z', checkedAt: '2026-10-30T09:00:00.000Z', reason: 'Complete current export.' };
    useWorkspaceMock.mockReturnValue(workspace({ sourceState: dataState({ status: 'success' }) }));
    render(<MapPanel homes={[]} resources={[]} sourceStatus={{ items: [{ resourceType: 'dengue_cluster', state: 'valid', dengue: policy }] }} visibleResourceTypes={['dengue_cluster']} resourceState={dataState({ status: 'empty', counts: [{ resourceType: 'dengue_cluster', total: 2, unlocated: 0 }] })} />);

    const legend = screen.getByRole('region', { name: 'NEA dengue map legend' });
    expect(legend).toHaveTextContent('Red · 10+ cases');
    expect(legend).toHaveTextContent('Yellow · 2–9 cases');
    expect(legend).toHaveTextContent('Updated 30 Oct 2026');
    expect(legend).toHaveTextContent('No clusters loaded here.');
    expect(legend).toHaveTextContent('NEA control boundaries, not an estimate of individual infection risk');
  });

  it('shows stale source state explicitly and never calls an empty view safe', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-30T09:00:00.000Z'));
    const updated = '2026-10-27T08:00:00.000Z';
    const policy = { state: 'stale', fresh: false, usable: false, complete: true, rows: 12, sourceUpdatedAt: updated, validUntil: '2026-10-29T08:00:00.000Z', checkedAt: '2026-10-30T09:00:00.000Z', reason: "The NEA active-cluster snapshot is older than the app's 48-hour display window." };
    useWorkspaceMock.mockReturnValue(workspace({ sourceState: dataState({ status: 'success' }) }));
    render(<MapPanel homes={[]} resources={[]} sourceStatus={{ items: [{ resourceType: 'dengue_cluster', state: 'valid', dengue: policy }] }} visibleResourceTypes={['dengue_cluster']} />);

    const legend = screen.getByRole('region', { name: 'NEA dengue map legend' });
    expect(legend).toHaveAttribute('data-state', 'stale');
    expect(legend).toHaveTextContent('Data expired. Overlay hidden.');
    expect(legend).not.toHaveTextContent('No clusters loaded here');
  });

  it('uses the newer resource policy when the separately cached source register is older', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-30T09:00:00.000Z'));
    const oldPolicy = { state: 'stale', fresh: false, usable: false, complete: true, rows: 12, sourceUpdatedAt: '2026-10-20T08:00:00.000Z', validUntil: '2026-10-22T08:00:00.000Z', checkedAt: '2026-10-30T08:00:00.000Z' };
    const currentPolicy = { state: 'fresh', fresh: true, usable: true, complete: true, rows: 1, sourceUpdatedAt: '2026-10-30T08:30:00.000Z', validUntil: '2026-11-01T08:30:00.000Z', checkedAt: '2026-10-30T08:59:00.000Z' };
    const feature = { type: 'Feature', id: 'new-cluster', geometry: { type: 'MultiPolygon', coordinates: [] }, properties: { resourceType: 'dengue_cluster', caseCount: 18, sourceUpdatedAt: currentPolicy.sourceUpdatedAt } };
    useWorkspaceMock.mockReturnValue(workspace({ sourceState: dataState({ status: 'success' }) }));
    render(<MapPanel homes={[]} resources={[feature]} sourceStatus={{ items: [{ resourceType: 'dengue_cluster', state: 'valid', dengue: oldPolicy }] }} visibleResourceTypes={['dengue_cluster']} resourceState={dataState({ status: 'success', dengue: currentPolicy, counts: [{ resourceType: 'dengue_cluster', total: 1, unlocated: 0 }] })} />);

    expect(screen.getByRole('region', { name: 'NEA dengue map legend' })).toHaveAttribute('data-state', 'fresh');
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-dengue-count', '1');
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-dengue-state', 'fresh');
    expect(screen.getByLabelText('Map options')).toBeInTheDocument();
  });

  it('shows a distinct symbol for each nearby data layer', () => {
    render(<MapPanel homes={[]} resources={[]} />);

    const layers = document.querySelector('[aria-labelledby="map-layers-heading"]');
    expect(layers.querySelectorAll('label svg[aria-hidden="true"]')).toHaveLength(11);
  });

  it('explains that unlocated loaded records cannot appear as map pins', () => {
    render(<MapPanel homes={[
      { id: 'located', lat: 1.35, lng: 103.85 },
      { id: 'missing', lat: null, lng: null },
      { id: 'partial', lat: 1.34, lng: null },
      { id: 'blank', lat: '', lng: '' },
      { id: 'outside', lat: 1.5, lng: 103.85 },
    ]} />);

    expect(screen.getByRole('status', { name: 'Map location coverage' })).toHaveTextContent('1 of 5 loaded records have map locations. 4 lack verified coordinates');
    expect(screen.getByText(/1 of 5 loaded records have map locations; 4 are omitted until verified coordinates are available/i)).toBeInTheDocument();
  });

  it('does not show a missing-location notice when every loaded record is mappable', () => {
    render(<MapPanel homes={[
      { id: 'one', lat: 1.35, lng: 103.85 },
      { id: 'two', lat: '1.36', lng: '103.86' },
    ]} />);

    expect(screen.queryByRole('status', { name: 'Map location coverage' })).not.toBeInTheDocument();
  });

  it('keeps the previous source register visible when refresh fails', () => {
    const source = { sourceId: 'hdb-resale', resourceType: 'hdb_resale', state: 'valid', rows: 42, retrievedAt: '2026-10-18T12:00:00+00:00' };
    useWorkspaceMock.mockReturnValue(workspace({
      sourceStatus: { items: [source], imported: 1, registered: 1 },
      sourceState: dataState({ status: 'error', error: { message: 'Source register request failed.' } }),
    }));

    render(<SourcesPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/showing previous results/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Source register request failed.');
    expect(screen.getByText('HDB resale transactions')).toBeInTheDocument();
    expect(screen.getByText('1 / 1 imported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload source status/i })).not.toBeInTheDocument();
  });

  it('shows a live-empty source register as empty, not as a fixture set', () => {
    useWorkspaceMock.mockReturnValue(workspace({
      sourceStatus: { items: [], imported: 0, registered: 0 },
      sourceState: dataState({ status: 'empty' }),
    }));

    render(<SourcesPage />);

    const emptyStatus = screen.getByText(/source register returned no entries/i).closest('[role="status"]');
    expect(emptyStatus).toHaveTextContent(/source register returned no entries/i);
    expect(emptyStatus).not.toHaveTextContent(/fixture|preview/i);
  });
});
