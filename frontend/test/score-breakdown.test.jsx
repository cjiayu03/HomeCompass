import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreBreakdown } from '../components/score-breakdown.jsx';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(() => ({ client: null, user: null })) }));

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: useAuthMock }));

const scoreDetails = {
  coverage: 0.8,
  components: [],
  missingEvidence: [],
  policyVersion: 'home-fit-v1',
  scoredAt: '2026-10-20T00:00:00+00:00',
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ client: null, user: null });
});

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function ProviderProbe() {
  const { applySearch } = useWorkspace();
  return <button onClick={() => applySearch('')}>Search live homes</button>;
}

function successfulDataFetch(path) {
  if (path === '/api/v1/homes') return Promise.resolve(json({ items: [] }));
  if (path.startsWith('/api/v1/resources')) return Promise.resolve(json({ features: [] }));
  if (path === '/api/v1/sources') return Promise.resolve(json({ items: [] }));
  if (path === '/api/v1/search') return Promise.resolve(json({ items: [] }));
  throw new Error(`Unexpected request: ${path}`);
}

function saveBrief(weights, userId = null) {
  const brief = {
    adults: 2,
    children: 1,
    olderAdults: 1,
    budget: 550000,
    schoolDistance: 1000,
    careDistance: 1200,
    pinLabel: 'Workplace',
    pinLocation: 'Raffles Place',
    priorityWeights: weights,
  };
  const key = userId ? `homecompass.account.${encodeURIComponent(userId)}.workspace` : 'family-brief';
  window.localStorage.setItem(key, JSON.stringify(userId ? { brief } : brief));
}

describe('ScoreBreakdown', () => {
  it('labels a null score as insufficient evidence', () => {
    render(<ScoreBreakdown score={null} scoreDetails={{ coverage: 0, components: [], missingEvidence: [], policyVersion: 'home-fit-v1', scoredAt: '2026-10-20T00:00:00+00:00' }} />);

    expect(screen.getByText('Insufficient evidence')).toBeInTheDocument();
  });

  it('shows a finite score with its coverage and policy version', () => {
    render(<ScoreBreakdown score={76.4} scoreDetails={scoreDetails} />);

    expect(screen.getByText('76.4 / 100')).toBeInTheDocument();
    expect(screen.getByText('Source score')).toBeInTheDocument();
    expect(screen.getByText('Coverage 80%')).toBeInTheDocument();
    expect(screen.getByText('Policy home-fit-v1')).toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '76.4'])('does not display a non-finite or non-numeric score (%s)', (score) => {
    render(<ScoreBreakdown score={score} scoreDetails={scoreDetails} />);

    expect(screen.getByText('Insufficient evidence')).toBeInTheDocument();
    expect(screen.queryByText('76.4 / 100')).not.toBeInTheDocument();
  });

  it('shows component contributions and names missing evidence without assigning zero', () => {
    const details = {
      ...scoreDetails,
      coverage: 0.6,
      components: [
        { name: 'school', normalizedValue: null, weight: 2, contribution: null, evidenceStatus: 'missing' },
        { name: 'childcare', normalizedValue: 80, weight: 2, contribution: 24.5, evidenceStatus: 'available' },
        { name: 'care', normalizedValue: 70, weight: 2, contribution: 35.5, evidenceStatus: 'available' },
        { name: 'affordability', normalizedValue: null, weight: 1, contribution: null, evidenceStatus: 'missing' },
      ],
      missingEvidence: ['school', 'affordability'],
    };
    render(<ScoreBreakdown score={60} scoreDetails={details} />);

    fireEvent.click(screen.getByText('60 / 100'));

    expect(screen.getByText('24.5 points')).toBeInTheDocument();
    expect(screen.getByText('35.5 points')).toBeInTheDocument();
    expect(screen.getAllByText('No contribution · evidence missing')).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Missing evidence' })).toHaveTextContent('School');
    expect(screen.getByRole('list', { name: 'Missing evidence' })).toHaveTextContent('Affordability');
    expect(screen.queryByText('0 points')).not.toBeInTheDocument();
  });

  it.each([
    ['evidenceStatus', 'missing', []],
    ['missingEvidence', 'available', ['school']],
  ])('suppresses zero-valued component evidence when marked missing by %s', (_source, evidenceStatus, missingEvidence) => {
    const details = {
      ...scoreDetails,
      components: [
        { name: 'school', normalizedValue: 0, weight: 1, contribution: 0, evidenceStatus },
      ],
      missingEvidence,
    };
    render(<ScoreBreakdown score={0} scoreDetails={details} />);

    fireEvent.click(screen.getByText('0 / 100'));

    expect(screen.getByText('Normalized Unavailable · weight 1')).toBeInTheDocument();
    expect(screen.getByText('No contribution · evidence missing')).toBeInTheDocument();
    expect(screen.queryByText('Normalized 0 / 100 · weight 1')).not.toBeInTheDocument();
    expect(screen.queryByText('0 points')).not.toBeInTheDocument();
  });

  it('reports missing component evidence when the missingEvidence summary is empty', () => {
    const details = {
      ...scoreDetails,
      components: [
        { name: 'school', normalizedValue: 0, weight: 1, contribution: 0, evidenceStatus: 'missing' },
      ],
      missingEvidence: [],
    };
    render(<ScoreBreakdown score={0} scoreDetails={details} />);

    fireEvent.click(screen.getByText('0 / 100'));

    expect(screen.getByRole('list', { name: 'Missing evidence' })).toHaveTextContent('School');
    expect(screen.queryByText('No missing evidence reported.')).not.toBeInTheDocument();
  });

  it('exposes score evidence through an accessible disclosure in a card', () => {
    render(<article aria-label="Home detail"><ScoreBreakdown score={76.4} scoreDetails={scoreDetails} /></article>);

    const disclosure = screen.getByRole('button', { name: /view score evidence/i });
    expect(screen.queryByRole('heading', { name: 'Score evidence' })).not.toBeInTheDocument();
    fireEvent.click(disclosure);

    expect(screen.getByRole('heading', { name: 'Score evidence' })).toBeInTheDocument();
  });

  it('sends the current brief priority weights with a live search', async () => {
    const priorityWeights = { school: 3, childcare: 1, care: 2, affordability: 1 };
    saveBrief(priorityWeights);
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    const fetchMock = vi.fn(successfulDataFetch);
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkspaceProvider><ProviderProbe /></WorkspaceProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Search live homes' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path === '/api/v1/search')).toBe(true));

    const [, request] = fetchMock.mock.calls.find(([path]) => path === '/api/v1/search');
    expect(JSON.parse(request.body).priority_weights).toEqual(priorityWeights);
  });

  it('sends the current brief priority weights when syncing the profile', async () => {
    const priorityWeights = { school: 1, childcare: 3, care: 2, affordability: 3 };
    saveBrief(priorityWeights, 'user-1');
    vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'live');
    useAuthMock.mockReturnValue({
      client: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) } },
      user: { id: 'user-1' },
    });
    const fetchMock = vi.fn((path, options = {}) => {
      if (path === '/api/v1/shortlists') return Promise.resolve(json({ items: [] }));
      if (path === '/api/v1/profile' && options.method === 'PUT') return Promise.resolve(json({}));
      if (path === '/api/v1/profile') return Promise.resolve(json({ adults: 2, children: 1, olderAdults: 1, budgetCents: 55000000 }));
      return successfulDataFetch(path);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WorkspaceProvider><ProviderProbe /></WorkspaceProvider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([path, options]) => path === '/api/v1/profile' && options?.method === 'PUT')).toBe(true), { timeout: 3000 });

    const [, request] = fetchMock.mock.calls.find(([path, options]) => path === '/api/v1/profile' && options?.method === 'PUT');
    expect(JSON.parse(request.body).priority_weights).toEqual(priorityWeights);
  });
});
