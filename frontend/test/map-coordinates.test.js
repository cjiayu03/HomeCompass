import { describe, expect, it } from 'vitest';
import { hasMapCoordinates } from '../lib/map-coordinates.js';

describe('hasMapCoordinates', () => {
  it('accepts valid Singapore coordinates as numbers or numeric strings', () => {
    expect(hasMapCoordinates({ lat: 1.3521, lng: 103.8198 })).toBe(true);
    expect(hasMapCoordinates({ lat: '1.3521', lng: '103.8198' })).toBe(true);
  });

  it.each([
    { lat: null, lng: 103.8 },
    { lat: 1.35, lng: undefined },
    { lat: '', lng: '103.8' },
    { lat: ' ', lng: '103.8' },
    { lat: true, lng: 103.8 },
    { lat: NaN, lng: 103.8 },
    { lat: Infinity, lng: 103.8 },
    { lat: 0, lng: 0 },
    { lat: 1.5, lng: 103.8 },
    { lat: 1.35, lng: 104.2 },
  ])('rejects coordinates without a valid in-Singapore point: %o', (home) => {
    expect(hasMapCoordinates(home)).toBe(false);
  });
});
