import { describe, expect, it } from 'vitest';
import { defaultBrief } from '../lib/data';
import { readSearchLocation, searchLocation } from '../lib/search-location';
import { briefValidationError } from '../lib/planning';

describe('shareable search locations', () => {
  it('round-trips structured criteria, preference strength and public map bounds', () => {
    const brief = { ...defaultBrief, budget: 610000, preferredTowns: ['Bedok', 'Tampines'], observedAfter: '2024-03-01', requirements: { budget: false, observedAfter: false }, schoolDistance: 1200 };
    const bounds = { west: 103.8, south: 1.2, east: 103.95, north: 1.4 };
    const parsed = readSearchLocation(searchLocation(brief, { bounds, view: 'map', saved: true, detailId: 'record-1' }).split('?')[1], defaultBrief);
    expect(parsed).toMatchObject({ brief, bounds, saved: true, view: 'map', detailId: 'record-1' });
  });
  it('excludes private places, text, notes and household details from links', () => {
    const url = searchLocation({ ...defaultBrief, query: 'private address', adults: 7, children: 4, pinLabel: 'My office', pinLocation: 'secret address', placeConstraints: [{ placeId: 'private-id', maxDistanceM: 2345 }], notes: 'secret notes', latitude: 1.2345 });
    for (const secret of ['private', 'secret', 'office', '2345', 'children', 'adults', 'latitude']) expect(url).not.toContain(secret);
  });
  it.each(['min_storey=0', 'min_storey=8&max_storey=4', 'from=2026-02-31', 'min_area=100&max_area=10', 'school=100001'])('restores a usable neutral search for invalid URL %s', params => {
    const parsed = readSearchLocation(`?search=1&${params}`, defaultBrief);
    expect(parsed.error).toBeTruthy();
    expect(briefValidationError(parsed.brief)).toBeNull();
    expect(parsed.brief.budget).toBeNull();
  });
  it('does not inherit private or previous numeric criteria', () => {
    const parsed = readSearchLocation('?search=1', { ...defaultBrief, budget: 700000, minStorey: 7, observedAfter: '2025-01-01', placeConstraints: [{ placeId: 'secret', maxDistanceM: 300 }] });
    expect(parsed.brief).toMatchObject({ budget: null, minStorey: null, observedAfter: null, placeConstraints: [] });
  });
});
