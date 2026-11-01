import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DengueLayerSummary, DengueMapLegend, DengueStatus } from '@/components/dengue-status';
import { HomeCard } from '@/components/home-card';
import { CandidateDetails } from '@/components/candidate-details';
import { ComparisonView } from '@/components/comparison-view';
import { DecisionSummary, standaloneHtml } from '@/components/decision-summary';
import { sourceFreshness } from '@/components/evidence-helpers';
import { dengueFeatureColor, evaluateDengueSnapshot, evaluateHomeDengueStatus, filterCurrentDengueFeatures } from '@/lib/dengue-status';
import { mapResourcePopupContent } from '@/lib/map-resource-popup';

vi.mock('@/components/workspace-provider', () => ({ useWorkspace: () => ({ brief: {}, appliedBrief: {}, setHoveredHome: () => {} }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = Date.parse('2026-10-30T09:00:00.000Z');
const SOURCE_AT = new Date(NOW - 60 * 60 * 1000).toISOString();
const FRESH_POLICY = {
  state: 'fresh', fresh: true, usable: true, complete: true, coverage: 'complete', rows: 2,
  sourceUpdatedAt: SOURCE_AT, validUntil: new Date(Date.parse(SOURCE_AT) + 48 * 60 * 60 * 1000).toISOString(),
  checkedAt: new Date(NOW).toISOString(), sourceUrl: 'https://www.nea.gov.sg/dengue-zika/dengue/dengue-clusters',
};
const HOME_STATUS = {
  state: 'active_cluster', severity: 'red', caseCount: 18, locality: 'Bishan Street 12',
  sourceUpdatedAt: FRESH_POLICY.sourceUpdatedAt, validUntil: FRESH_POLICY.validUntil,
  checkedAt: FRESH_POLICY.checkedAt, featureUpdatedAt: '2026-10-27T09:50:46+00:00',
  coverage: 'complete', reason: 'NEA intervention-area overlap.', sourceUrl: FRESH_POLICY.sourceUrl,
};
const polygon = (id, count, geometryType = 'Polygon', sourceUpdatedAt = SOURCE_AT) => ({
  type: 'Feature', id,
  geometry: { type: geometryType, coordinates: geometryType === 'Polygon' ? [] : [[]] },
  properties: { resourceType: 'dengue_cluster', caseCount: count, sourceUpdatedAt },
});
const home = { id: 'home-1', address: '12 Bishan Street 12', town: 'BISHAN', type: '4 ROOM', price: 500000, dengue: HOME_STATUS, risk: 'Legacy cached risk text' };

describe('dengue status policy and presentation', () => {
  it('keeps the 48-hour boundary exact and rejects unverifiable source dates', () => {
    vi.setSystemTime(NOW);
    const exactly48Hours = { ...FRESH_POLICY, sourceUpdatedAt: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(), validUntil: new Date(NOW).toISOString() };
    expect(evaluateDengueSnapshot(exactly48Hours, NOW).usable).toBe(true);
    expect(evaluateDengueSnapshot(exactly48Hours, NOW + 1).state).toBe('stale');
    expect(sourceFreshness({ resourceType: 'dengue_cluster', state: 'valid', sourceUpdatedAt: '2026-10-29T08:00:00Z', retrievedAt: new Date(NOW).toISOString() }, new Date(NOW)).state).toBe('unknown_date');
    expect(evaluateHomeDengueStatus({ state: 'no_active_cluster', coverage: 'complete' }, NOW).state).toBe('unknown_date');
  });

  it('uses the official 2–9 and 10+ color bands and hides stale, mismatched, or malformed polygons', () => {
    vi.setSystemTime(NOW);
    const yellow = polygon('yellow', 9);
    const red = polygon('red', 10, 'MultiPolygon');
    const mismatched = polygon('old', 100, 'Polygon', new Date(Date.parse(SOURCE_AT) - 1000).toISOString());
    expect(dengueFeatureColor(yellow)).toBe('#c49a3f');
    expect(dengueFeatureColor(red)).toBe('#c4514e');
    expect(filterCurrentDengueFeatures([yellow, red, mismatched], FRESH_POLICY, NOW)).toEqual([yellow, red]);
    expect(filterCurrentDengueFeatures([yellow, red], { ...FRESH_POLICY, validUntil: new Date(NOW - 1).toISOString() }, NOW)).toEqual([]);
    expect(filterCurrentDengueFeatures([polygon('bad-count', 1)], FRESH_POLICY, NOW)).toEqual([]);
  });

  it('refreshes a same-id polygon revision with its new case band and record timestamp', () => {
    const nine = { ...polygon('same-id', 9), properties: { ...polygon('same-id', 9).properties, name: 'Example locality', categoryLabel: 'High-risk cluster (fewer than 10 cases)', recordUpdatedAt: '2026-10-27T09:00:00+00:00', sourceUrl: FRESH_POLICY.sourceUrl } };
    const ten = { ...nine, properties: { ...nine.properties, caseCount: 10, categoryLabel: 'High-risk cluster (10 or more cases)', sourceUpdatedAt: '2026-10-30T08:30:00+00:00', recordUpdatedAt: '2026-10-30T08:25:00+00:00' } };
    const ninePopup = mapResourcePopupContent(nine).textContent;
    const tenPopup = mapResourcePopupContent(ten).textContent;
    expect(ninePopup).toContain('9 casesYellow alert');
    expect(tenPopup).toContain('10 casesRed alert');
    expect(tenPopup).toContain('Record updated');
    expect(tenPopup).not.toContain('27 Oct 2026');
  });

  it('keeps popup source notes behind a disclosure and preserves safe source links', () => {
    const feature = polygon('red', 18);
    feature.properties = { ...feature.properties, name: '<img src=x onerror=alert(1)>', sourceUrl: 'javascript:alert(1)', recordUpdatedAt: '2026-10-27T09:00:00Z' };
    const popup = mapResourcePopupContent(feature);
    expect(popup.querySelector('.map-cluster-cases')).toHaveTextContent('18 cases');
    expect(popup.querySelector('.map-cluster-alert')).toHaveTextContent('Red alert');
    expect(popup.querySelector('details')).not.toHaveAttribute('open');
    expect(popup.querySelector('details')).toHaveTextContent('not a case report date');
    expect(popup.querySelector('details')).toHaveTextContent('not an estimate of individual infection risk');
    expect(popup.querySelector('img')).toBeNull();
    expect(popup.querySelectorAll('a')).toHaveLength(1);
    expect(popup.querySelector('a')).toHaveAttribute('href', FRESH_POLICY.sourceUrl);
  });

  it('keeps the legend concise while retaining context and visible expiry warnings', () => {
    vi.setSystemTime(NOW);
    const { rerender } = render(<DengueMapLegend policy={FRESH_POLICY} now={NOW} visibleFeatureCount={2} nationalRowCount={2} />);
    expect(screen.getByText('Red · 10+ cases')).toBeVisible();
    expect(screen.getByText(/Updated 30 Oct 2026/)).toBeVisible();
    expect(screen.getByText(/Data older than 48 hours/)).not.toBeVisible();
    expect(screen.getByRole('link', { name: 'NEA source and cluster notes' })).toBeVisible();
    rerender(<DengueMapLegend policy={FRESH_POLICY} now={Date.parse(FRESH_POLICY.validUntil) + 1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Data expired. Overlay hidden.');
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByText('Red · 10+ cases')).not.toBeInTheDocument();
  });

  it('summarizes a layer without substituting a fresh label for missing dates', () => {
    const { rerender } = render(<DengueLayerSummary policy={FRESH_POLICY} now={NOW} />);
    expect(screen.getByText(/Updated 30 Oct 2026/)).toBeVisible();
    expect(screen.queryByText(/complete national/)).not.toBeInTheDocument();
    rerender(<DengueLayerSummary policy={{ ...FRESH_POLICY, state: 'unknown_date', usable: false }} now={NOW} />);
    expect(screen.getByText('Update date unverified')).toBeVisible();
    expect(screen.queryByText(/Updated 30 Oct/)).not.toBeInTheDocument();
  });

  it('ignores cached legacy risk strings and expires rendered home status without a reload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const legacy = { risk: 'No published cluster overlap' };
    expect(evaluateHomeDengueStatus(legacy.dengue, NOW).state).toBe('source_unavailable');
    render(<DengueStatus home={legacy} compact />);
    expect(screen.getByText('Dengue status unavailable')).toBeInTheDocument();
    cleanup();

    const shortWindow = { ...HOME_STATUS, validUntil: new Date(NOW + 20).toISOString(), sourceUpdatedAt: new Date(NOW - (48 * 60 * 60 * 1000) + 20).toISOString() };
    render(<DengueStatus home={{ ...home, dengue: shortWindow }} compact />);
    expect(screen.getByText(/Red: NEA high-risk cluster/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(22); });
    expect(screen.getByText('NEA cluster snapshot is stale; status hidden')).toBeInTheDocument();
  });

  it('shows the same structured home status in browse, details, shortlist cards, and comparison', () => {
    vi.setSystemTime(NOW);
    const { unmount } = render(<HomeCard home={home} variant="browse" compact />);
    expect(screen.getByText(/Red: NEA high-risk cluster/)).toBeInTheDocument();
    unmount();

    render(<CandidateDetails home={home} />);
    expect(screen.getByText(/Red: NEA high-risk cluster/)).toBeInTheDocument();
    cleanup();

    render(<HomeCard home={home} saved variant="default" compact />);
    expect(screen.getByText(/Red: NEA high-risk cluster/)).toBeInTheDocument();
    cleanup();

    const second = { ...home, id: 'home-2', address: '22 Bishan Street 12', dengue: { ...HOME_STATUS, state: 'location_unavailable', severity: null, caseCount: null, sourceUpdatedAt: null, validUntil: null } };
    render(<ComparisonView homes={[home, second]} />);
    expect(screen.getByText(/Red: NEA high-risk cluster/)).toBeInTheDocument();
    expect(screen.getByText('Home location unavailable for cluster check')).toBeInTheDocument();
  });

  it('re-evaluates the open decision summary and dates exported status', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const shortWindow = { ...HOME_STATUS, validUntil: new Date(NOW + 20).toISOString(), sourceUpdatedAt: new Date(NOW - (48 * 60 * 60 * 1000) + 20).toISOString() };
    const candidate = { ...home, dengue: shortWindow };
    render(<DecisionSummary homes={[candidate]} />);
    const summary = screen.getByRole('region', { name: 'Printable decision summary' });
    expect(summary).toHaveTextContent('Red: NEA high-risk cluster');
    await act(async () => { vi.advanceTimersByTime(22); });
    expect(summary).toHaveTextContent('NEA cluster snapshot is stale; status hidden');
    expect(standaloneHtml([candidate])).toContain('status window ends');
  });
});
