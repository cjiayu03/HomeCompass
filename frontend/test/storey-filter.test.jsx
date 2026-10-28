import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdvancedRequirements, MatchReasons } from '../components/search-workbench.jsx';
import { WorkspaceProvider, useWorkspace } from '../components/workspace-provider.jsx';
import { applyLocalRequirements, briefFromCriteria, buildCriteria, evaluateHome, parseStoreyRange, previewRank } from '../lib/planning.js';

vi.mock('../components/auth-provider.jsx', () => ({ useAuth: () => ({ client: null, user: null }) }));

const brief = { minStorey: 5, maxStorey: 8, requirements: {} };
const makeHome = storeyRange => ({ id: String(storeyRange), storeyRange });

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllEnvs(); });

describe('storey band contract', () => {
  it.each([
    ['04 TO 06', { lower: 4, upper: 6 }],
    [' 4  TO  6 ', { lower: 4, upper: 6 }],
    ['05 TO 05', { lower: 5, upper: 5 }],
    ['01 TO 999', { lower: 1, upper: 999 }],
    [null, null], ['', null], ['   ', null], ['04 TO 06\n', null],
    ['04\tTO 06', null], ['04-06', null], ['04 to 06', null],
    ['floor 04 TO 06', null], ['09 TO 04', null], ['00 TO 03', null],
    ['1000 TO 1001', null], ['5', null], [5, null],
  ])('parses %s according to the shared contract', (input, expected) => {
    expect(parseStoreyRange(input)).toEqual(expected);
  });

  it('filters partial overlaps and touching endpoints, but excludes disjoint and unknown evidence', () => {
    const homes = ['04 TO 06', '07 TO 09', '02 TO 05', '08 TO 10', '01 TO 03', '09 TO 12', null, '04-06'].map(makeHome);
    expect(applyLocalRequirements(homes, brief).map(home => home.storeyRange)).toEqual(['04 TO 06', '07 TO 09', '02 TO 05', '08 TO 10']);
    expect(applyLocalRequirements(homes, { minStorey: 5 }).map(home => home.storeyRange)).toEqual(['04 TO 06', '07 TO 09', '02 TO 05', '08 TO 10', '09 TO 12']);
    expect(applyLocalRequirements(homes, { maxStorey: 5 }).map(home => home.storeyRange)).toEqual(['04 TO 06', '02 TO 05', '01 TO 03']);
    expect(applyLocalRequirements(homes, { minStorey: 5, maxStorey: 5 }).map(home => home.storeyRange)).toEqual(['04 TO 06', '02 TO 05']);
    expect(applyLocalRequirements(homes, {})).toEqual(homes);
    expect(applyLocalRequirements(homes, { ...brief, requirements: { minStorey: false, maxStorey: false } })).toEqual(homes);
    expect(applyLocalRequirements(homes, { ...brief, requirements: { minStorey: false } }).map(home => home.storeyRange)).toEqual(['04 TO 06', '07 TO 09', '02 TO 05', '08 TO 10', '01 TO 03']);
  });

  it('explains possible overlap, disjoint and unavailable evidence, including mixed hard and preference bounds', () => {
    const overlap = evaluateHome(makeHome('04 TO 06'), brief);
    expect(overlap.matches.join(' ')).toContain('reported 04 TO 06 has a possible overlap');
    expect(overlap.matches.join(' ')).toContain('exact floor unavailable');
    expect(overlap.compromises.join(' ')).not.toContain('storey');
    expect(evaluateHome(makeHome('01 TO 03'), brief).compromises.join(' ')).toContain('does not overlap');
    expect(evaluateHome(makeHome('04-06'), brief).missing.join(' ')).toContain('reported storey range unavailable');
    const mixed = evaluateHome(makeHome('04 TO 06'), { ...brief, requirements: { maxStorey: false } });
    expect(mixed.matches.join(' ')).toContain('Must-have storeys 5 or higher');
    expect(mixed.matches.join(' ')).toContain('Preference storeys 8 or lower');
  });

  it('scores one combined storey criterion and omits unknown evidence', () => {
    const weights = { budget: 0, space: 1, location: 0 };
    expect(previewRank(makeHome('04 TO 06'), brief, weights, [0, 1]).score).toBe(100);
    expect(previewRank(makeHome('01 TO 03'), brief, weights, [0, 1]).score).toBe(0);
    const unknown = previewRank(makeHome('04-06'), brief, weights, [0, 1]);
    expect(unknown.score).toBeNull();
    expect(unknown.coverage).toBe(0);
  });

  it('restores and applies saved criteria with the same rule', () => {
    const restored = briefFromCriteria({ requirements: {} }, { min_storey: 5, max_storey: 8 });
    expect(buildCriteria(restored)).toMatchObject({ min_storey: 5, max_storey: 8 });
    expect(applyLocalRequirements([makeHome('04 TO 06'), makeHome('01 TO 03')], restored).map(home => home.storeyRange)).toEqual(['04 TO 06']);
  });
});

function Controls() {
  const [value, setValue] = useState({ minStorey: 9, maxStorey: 5 });
  return <AdvancedRequirements brief={value} setBrief={setValue} />;
}

it('shows accessible guidance and resolves the invalid range message when fixed', () => {
  render(<Controls />);
  const min = screen.getByLabelText('Minimum storey');
  expect(min).toHaveAccessibleDescription(/reported bands that overlap/);
  expect(min).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Minimum storey cannot exceed maximum storey.');
  fireEvent.change(min, { target: { value: '5' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(min).not.toHaveAttribute('aria-invalid');
});

it('renders the decision explanation for a partial overlap', () => {
  render(<MatchReasons home={makeHome('04 TO 06')} brief={brief} />);
  expect(screen.getByText(/reported 04 TO 06 has a possible overlap/)).toHaveTextContent('exact floor unavailable');
});

function InvalidSearchProbe() {
  const workspace = useWorkspace();
  return <>
    <button onClick={() => workspace.setBrief(current => ({ ...current, minStorey: 9, maxStorey: 5 }))}>Set invalid range</button>
    <button onClick={() => workspace.applySearch('')}>Apply search</button>
    <output data-testid="notice">{workspace.notice?.text || ''}</output>
    <output data-testid="homes">{workspace.homes.length}</output>
  </>;
}

it('blocks an invalid local search before filtering the fixtures', async () => {
  vi.stubEnv('NEXT_PUBLIC_HOME_DATA_MODE', 'fixture');
  render(<WorkspaceProvider><InvalidSearchProbe /></WorkspaceProvider>);
  await waitFor(() => expect(screen.getByTestId('homes')).toHaveTextContent('5'));
  fireEvent.click(screen.getByText('Set invalid range'));
  fireEvent.click(screen.getByText('Apply search'));
  await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Minimum storey cannot exceed maximum storey.'));
  expect(screen.getByTestId('homes')).toHaveTextContent('5');
});
