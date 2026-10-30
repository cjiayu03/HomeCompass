import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HomeCard } from '../components/home-card.jsx';

const { useWorkspaceMock, candidateReasonsMock } = vi.hoisted(() => ({
  useWorkspaceMock: vi.fn(),
  candidateReasonsMock: vi.fn(() => ({ matches: [], tradeoff: 'Check details.' })),
}));

vi.mock('../components/workspace-provider.jsx', () => ({ useWorkspace: useWorkspaceMock }));
vi.mock('../components/evidence-context.jsx', () => ({ EvidenceContext: () => <div /> }));
vi.mock('../components/place-picker.jsx', () => ({ PlaceDistanceList: () => null }));
vi.mock('../components/evidence-helpers.jsx', () => ({ candidateReasons: candidateReasonsMock }));

beforeEach(() => {
  useWorkspaceMock.mockReturnValue({ brief: {}, appliedBrief: {}, setHoveredHome: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const home = {
  id: 'home-1',
  address: '10 Sample Street',
  town: 'Central Region',
  type: '3 ROOM',
  price: 500000,
  observedOn: '2026-01-01',
};

function renderCard(overrides = {}) {
  const callbacks = { onLocate: vi.fn(), onSave: vi.fn(), onCompare: vi.fn(), onInspect: vi.fn() };
  render(<HomeCard variant="browse" compact home={home} saved={false} selected={false} mapActive={false} {...callbacks} {...overrides} />);
  return callbacks;
}

it('selects a home when its result card body is clicked', () => {
  const { onLocate } = renderCard();

  fireEvent.click(screen.getByText(/Central Region/));

  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(onLocate).toHaveBeenCalledWith(home);
});

it('marks the selected result for assistive technology and in the row', () => {
  renderCard({ mapActive: true });

  expect(screen.getByRole('article', { name: /10 sample street/i })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('button', { name: /show 10 sample street on map/i })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Selected on map')).toBeInTheDocument();
});

it('keeps save, compare, details, and title actions from firing the card selection twice', () => {
  const { onLocate, onSave, onCompare, onInspect } = renderCard();

  fireEvent.click(screen.getByRole('button', { name: /show 10 sample street on map/i }));
  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(onLocate).toHaveBeenCalledWith(home);

  fireEvent.click(screen.getByRole('button', { name: /save 10 sample street to shortlist/i }));
  fireEvent.click(screen.getByRole('button', { name: /compare 10 sample street/i }));
  fireEvent.click(screen.getByRole('button', { name: /details/i }));

  expect(onLocate).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith(home);
  expect(onCompare).toHaveBeenCalledTimes(1);
  expect(onCompare).toHaveBeenCalledWith(home);
  expect(onInspect).toHaveBeenCalledTimes(1);
  expect(onInspect).toHaveBeenCalledWith(home);
});
