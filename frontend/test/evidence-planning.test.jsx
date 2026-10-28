import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cohortProfile, monthlyChart, sourceFreshness } from '../components/evidence-helpers';
import { calculateAffordability } from '../components/affordability-planner';
import { ComparisonView } from '../components/comparison-view';

vi.mock('../components/workspace-provider', () => ({ useWorkspace: () => ({}) }));
afterEach(cleanup);

describe('evidence planning', () => {
  it('spaces prices by actual months and breaks the line across absent months', () => {
    const chart = monthlyChart([{ month: '2025-01', median: 400000 }, { month: '2025-02', median: 420000 }, { month: '2025-04', median: 450000 }]);
    expect(chart.points[1].x - chart.points[0].x).toBeCloseTo((chart.points[2].x - chart.points[1].x) / 2);
    expect(chart.segments.map(s => s.length)).toEqual([2, 1]);
    expect(chart.ticks).toHaveLength(3);
  });
  it('uses source-specific review limits and never treats a recent fetch as fresh source evidence', () => {
    const record = { state: 'valid', resourceType: 'dengue_cluster', sourceUpdatedAt: '2026-10-01', retrievedAt: '2026-10-28' };
    expect(sourceFreshness(record, new Date('2026-10-28')).state).toBe('review');
    expect(sourceFreshness({ ...record, resourceType: 'hdb_property' }, new Date('2026-10-28')).state).toBe('within');
    expect(sourceFreshness({ ...record, sourceUpdatedAt: null }).state).toBe('unknown');
    expect(sourceFreshness({ ...record, state: 'not_imported' }).state).toBe('unavailable');
  });
  it('describes only loaded historical records and groups repeated blocks', () => {
    const home = { town: 'Bedok', address: '1 Bedok', price: 400000, sourceSemantics: 'historical_transaction' };
    expect(cohortProfile([home, { ...home, price: 600000 }, { ...home, sourceSemantics: 'fixture', price: 1 }])).toMatchObject({ count: 2, median: 500000, blocks: [['1 Bedok', 2]] });
  });
  it('calculates principal and interest plus explicit upfront funding gaps', () => {
    expect(calculateAffordability({ price: 500000, loan: 400000, cpf: 60000, cash: 20000, costs: 10000, renovation: 20000, rate: 0, years: 20, recurring: 200, monthlyCpf: 500 })).toMatchObject({ upfront: 130000, gap: 50000, payment: 400000 / 240, monthlyCash: 400000 / 240 - 500 + 200 });
    expect(calculateAffordability({ price: 500000, loan: 600000, cpf: 0, cash: 0, costs: 0, renovation: 0, rate: 3, years: 25, recurring: 0, monthlyCpf: 0 }).error).toMatch(/loan cannot exceed/i);
  });
  it('compares two selected candidates on a phone and hides only identical rows', () => {
    const homes = [{ id: 'a', address: 'A', town: 'Bedok', type: '4 ROOM', price: 400000, sourceSemantics: 'historical_transaction' }, { id: 'b', address: 'B', town: 'Bedok', type: '4 ROOM', price: 500000, sourceSemantics: 'historical_transaction' }, { id: 'c', address: 'C', town: 'Jurong', type: '5 ROOM', price: 600000, sourceSemantics: 'historical_transaction' }];
    render(<ComparisonView homes={homes} />);
    expect(screen.getByRole('table', { name: 'Candidate evidence comparison' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Second candidate'), { target: { value: 'c' } });
    expect(screen.getByLabelText('Second candidate')).toHaveValue('c');
    fireEvent.click(screen.getByLabelText('Show differences only'));
    expect(screen.queryByRole('rowheader', { name: 'Current availability' })).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Recorded price' })).toBeInTheDocument();
  });
});
