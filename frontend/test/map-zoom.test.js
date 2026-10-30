import { describe, expect, it } from 'vitest';
import { facilityClusterRadius, selectedHomeZoom } from '../lib/map-zoom.js';

describe('map focus and facility density', () => {
  it('zooms selected homes to neighborhood level without zooming back out', () => {
    expect(selectedHomeZoom(11)).toBe(17);
    expect(selectedHomeZoom(17)).toBe(17);
    expect(selectedHomeZoom(19)).toBe(19);
    expect(selectedHomeZoom(Number.NaN)).toBe(17);
  });

  it('shows more individual facilities as the map zooms in', () => {
    expect(facilityClusterRadius(14)).toBe(48);
    expect(facilityClusterRadius(15)).toBe(12);
    expect(facilityClusterRadius(17)).toBe(1);
  });
});
