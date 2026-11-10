import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ElderlyZoneStatus } from '@/components/elderly-zone-status';
import { CandidateDetails } from '@/components/candidate-details';
import { ComparisonView } from '@/components/comparison-view';

vi.mock('@/components/auth-provider', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/components/workspace-provider', () => ({ useWorkspace: () => ({ brief: {}, appliedBrief: {}, setHoveredHome: () => {} }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const silver = { state: 'inside', flag: true, label: 'Inside a Silver Zone',
  sourceUpdatedAt: '2026-11-01T00:00:00Z', validUntil: '2027-11-01T00:00:00Z',
  sourceUrl: 'https://data.gov.sg/datasets/silver/view',
  rule: 'Inside or on the published Silver Zone polygon boundary; no proximity buffer.' };
const gtp = { ...silver, state: 'nearby', label: 'Go-To-Point nearby', distanceM: 125.5,
  rule: 'Within 500 m straight-line of a published Go-To-Point, including the limit.' };
const home = { id: 'one', address: '12 Bishan Street 12', town: 'BISHAN', type: '4 ROOM',
  elderlyZones: { silverZone: silver, dementiaGtp: gtp } };

it('shows the flag, source date, distance and accessible rule disclosure', () => {
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  render(<ElderlyZoneStatus home={home} kind="dementiaGtp" />);
  expect(screen.getByText('Go-To-Point nearby')).toBeVisible();
  expect(screen.getByText(/126 m straight-line/)).toBeVisible();
  expect(screen.getByText('1 Nov 2026').closest('p')).toHaveTextContent('Updated 1 Nov 2026');
  expect(screen.getByText('Source and rule').tagName).toBe('SUMMARY');
});

it('does not reuse an expired or missing cached flag', () => {
  vi.setSystemTime(new Date('2027-11-02T00:00:00Z'));
  const { rerender } = render(<ElderlyZoneStatus home={home} kind="silverZone" />);
  expect(screen.getByText('Source data is stale')).toBeVisible();
  expect(screen.queryByText('Inside a Silver Zone')).not.toBeInTheDocument();
  rerender(<ElderlyZoneStatus home={{}} kind="dementiaGtp" />);
  expect(screen.getByText('Status unavailable')).toBeVisible();
});

it('integrates both flags into home details and the existing comparison rows', () => {
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  const { unmount } = render(<CandidateDetails home={home} />);
  expect(screen.getByRole('heading', { name: 'Elderly-friendly surroundings' })).toBeVisible();
  expect(screen.getByText('Inside a Silver Zone')).toBeVisible();
  expect(screen.getByText('Go-To-Point nearby')).toBeVisible();
  unmount();
  render(<ComparisonView homes={[home, { id: 'two', address: '34 Toa Payoh' }]} />);
  const row = screen.getAllByRole('row').find(row => within(row).queryByRole('rowheader', { name: 'Silver Zone' }));
  expect(within(row).getByText('Inside a Silver Zone')).toBeInTheDocument();
  expect(within(row).getByText('Status unavailable')).toBeInTheDocument();
});
