import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EvidenceContext } from '../components/evidence-context.jsx';
import { HomeCard } from '../components/home-card.jsx';
import ComparePage from '../app/(workspace)/compare/page.jsx';
import ShortlistPage from '../app/(workspace)/shortlist/page.jsx';

const { useWorkspaceMock } = vi.hoisted(() => ({ useWorkspaceMock: vi.fn() }));

vi.mock('../components/workspace-provider.jsx', () => ({ useWorkspace: useWorkspaceMock }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));

const historicalHome = {
  id: 'hdb-1',
  address: '118 Jalan Bukit Merah',
  town: 'Bukit Merah',
  type: '4-room',
  price: 488000,
  score: null,
  scoreDetails: {
    coverage: 0.14,
    components: [],
    missingEvidence: ['school', 'childcare', 'care'],
    policyVersion: 'home-fit-v1',
  },
  source: 'data.gov.sg · hdb-resale',
  sourceUpdated: '2026-09',
  sourceSemantics: 'historical_transaction',
  observedOn: '2024-06-03',
  geocodeStatus: 'pending',
  geocodeSource: null,
  geocodedAt: null,
  school: null,
  childcare: null,
  care: null,
  placeDistances: [],
  risk: 'Location needed for cluster check',
  highlights: [],
  risks: ['Historical resale transaction; not a current listing'],
};

const fixtureHome = {
  id: 'fixture-1',
  address: '254 Serangoon Avenue 2',
  town: 'Serangoon',
  type: '5-room',
  price: 535000,
  score: null,
  source: 'Illustrative fixture · not official data',
  sourceUpdated: 'Illustrative only',
  distance: null,
  school: null,
  childcare: null,
  care: null,
  placeDistances: [],
  risk: 'Not assessed',
  highlights: [],
  risks: [],
};

function workspace(overrides = {}) {
  return {
    selectedHomes: [],
    compareIds: [],
    setCompareIds: vi.fn(),
    shortlistHomes: [],
    shortlistIds: [],
    toggleCompare: vi.fn(),
    toggleShortlist: vi.fn(),
    reorderShortlist: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EvidenceContext', () => {
  it('keeps transaction date, source date, and pending geocode attached to historical evidence', () => {
    render(<EvidenceContext home={historicalHome} />);

    expect(screen.getByText('Historical transaction · not a current listing')).toBeInTheDocument();
    expect(screen.getByText('Transaction date').nextElementSibling).toHaveTextContent('2024-06-03');
    expect(screen.getByText('Source date').nextElementSibling).toHaveTextContent('2026-09');
    expect(screen.getByText('Geocoding pending')).toBeInTheDocument();
    expect(screen.getByText('Source').nextElementSibling).toHaveTextContent('data.gov.sg · hdb-resale');
  });

  it('labels fixture values as illustrative and does not invent a source date or listing status', () => {
    render(<EvidenceContext home={fixtureHome} />);

    expect(screen.getByText('Illustrative sample · not verified source data')).toBeInTheDocument();
    const fixtureContext = within(screen.getByRole('region', { name: 'Evidence context for 254 Serangoon Avenue 2' }));
    expect(fixtureContext.getByText('Source date').nextElementSibling).toHaveTextContent('unavailable');
    expect(screen.getByText('Geocode status unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/^Available listing$/i)).not.toBeInTheDocument();
  });

  it('shows a null score as insufficient evidence while retaining coverage and missing evidence', () => {
    render(<EvidenceContext home={historicalHome} />);

    expect(screen.getByText('Insufficient evidence')).toBeInTheDocument();
    expect(screen.getByText('Coverage 14%')).toBeInTheDocument();
    expect(screen.getByText('Policy home-fit-v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view score evidence/i }));

    const missing = screen.getByRole('list', { name: 'Missing evidence' });
    expect(missing).toHaveTextContent('School');
    expect(missing).toHaveTextContent('Childcare');
    expect(missing).toHaveTextContent('Care');
  });
});

describe('decision surfaces', () => {
  it('shows the same historical semantics on home cards without presenting a listing claim', () => {
    render(<HomeCard home={historicalHome} saved={false} selected={false} onSave={vi.fn()} onCompare={vi.fn()} onInspect={vi.fn()} />);

    expect(screen.getByText('Historical transaction · not a current listing')).toBeInTheDocument();
    expect(screen.getByText('Transaction date').nextElementSibling).toHaveTextContent('2024-06-03');
    expect(screen.queryByText(/^Available listing$/i)).not.toBeInTheDocument();
  });

  it('keeps each selected home evidence context in the comparison table', () => {
    useWorkspaceMock.mockReturnValue(workspace({
      selectedHomes: [historicalHome, fixtureHome],
      shortlistHomes: [historicalHome, fixtureHome],
      compareIds: [historicalHome.id, fixtureHome.id],
    }));

    render(<ComparePage />);

    expect(screen.getByText('Historical transaction · not a current listing')).toBeInTheDocument();
    expect(screen.getByText('Illustrative sample · not verified source data')).toBeInTheDocument();
    const historicalContext = within(screen.getByRole('region', { name: 'Evidence context for 118 Jalan Bukit Merah' }));
    const fixtureContext = within(screen.getByRole('region', { name: 'Evidence context for 254 Serangoon Avenue 2' }));
    expect(historicalContext.getByText('Transaction date').nextElementSibling).toHaveTextContent('2024-06-03');
    expect(fixtureContext.getByText('Source date').nextElementSibling).toHaveTextContent('unavailable');
  });

  it('retains evidence context in the shortlist card and its detail view', () => {
    useWorkspaceMock.mockReturnValue(workspace({
      shortlistHomes: [historicalHome],
      shortlistIds: [historicalHome.id],
    }));

    render(<ShortlistPage />);

    expect(screen.getByText('Historical transaction · not a current listing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Historical transaction · not a current listing');
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Transaction date').nextElementSibling).toHaveTextContent('2024-06-03');
    expect(dialog.getByText('Geocoding pending')).toBeInTheDocument();
  });
});
