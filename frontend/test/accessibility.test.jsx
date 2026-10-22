import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { DataStatus } from '../components/data-status.jsx';
import { PlaceManager } from '../components/place-manager.jsx';
import { ScoreBreakdown } from '../components/score-breakdown.jsx';

expect.extend(toHaveNoViolations);

const { workspaceState } = vi.hoisted(() => ({
  workspaceState: {
    places: [],
    placeState: { status: 'empty' },
    suggestPlaces: vi.fn(),
    createPlace: vi.fn(),
    deletePlace: vi.fn(),
  },
}));

vi.mock('../components/workspace-provider.jsx', () => ({
  useWorkspace: () => workspaceState,
}));

const scoreDetails = {
  coverage: 0.8,
  components: [
    { name: 'school', normalizedValue: 75, weight: 2, contribution: 30, evidenceStatus: 'available' },
  ],
  missingEvidence: [],
  policyVersion: 'home-fit-v1',
};

const addressCandidate = {
  address: '8 Harbour Road, Singapore 098xxx',
  latitude: 1.2712,
  longitude: 103.8194,
  provider: 'OneMap',
  selection_token: 'a'.repeat(64),
};

beforeEach(() => {
  workspaceState.places = [];
  workspaceState.placeState = { status: 'empty' };
  workspaceState.suggestPlaces.mockReset();
  workspaceState.createPlace.mockReset();
  workspaceState.deletePlace.mockReset();
});

afterEach(() => cleanup());

describe('stateful workspace accessibility', () => {
  it('announces loading as a status', async () => {
    const { container } = render(<DataStatus state={{ status: 'loading' }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading data');
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it('announces an error and exposes a named retry button', async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <DataStatus
        state={{ status: 'error', error: { message: 'The source request failed.' } }}
        onRetry={onRetry}
        retryLabel="Retry home data"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The source request failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry home data' }));
    expect(onRetry).toHaveBeenCalledOnce();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it('announces a successful empty response as a status', async () => {
    const { container } = render(
      <DataStatus state={{ status: 'empty', dataMode: 'live' }} emptyMessage="No homes match these filters." />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No homes match these filters.');
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it('keeps score evidence behind a keyboard-operable disclosure', async () => {
    const { container } = render(<ScoreBreakdown score={76.4} scoreDetails={scoreDetails} />);
    const disclosure = screen.getByRole('button', { name: /view score evidence/i });

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(axe(container)).resolves.toHaveNoViolations();

    fireEvent.click(disclosure);

    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Score evidence' })).toBeInTheDocument();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it('labels and selects an address candidate before enabling save', async () => {
    workspaceState.suggestPlaces.mockResolvedValue([addressCandidate]);
    const { container } = render(<PlaceManager />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Place label' }), {
      target: { value: 'School pickup' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search an address' }), {
      target: { value: 'Harbour Road' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find address candidates' }));

    const candidate = await screen.findByRole('radio', {
      name: `Select ${addressCandidate.address}`,
    });
    expect(screen.getByRole('group', { name: 'OneMap address candidates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeDisabled();

    fireEvent.click(candidate);

    expect(candidate).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save selected place' })).toBeEnabled();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
