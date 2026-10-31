import { describe, it, expect } from 'vitest';
import { evidenceCollection, selectedEvidenceLocations } from '../lib/score-locations';

const home = { id: 'home', lat: 1.3, lng: 103.8, scoreLocations: [{ id: 'school-1', component: 'school', name: 'Scoring school', lat: 1.301, lng: 103.801, distanceM: 157, resourceType: 'moe_school', usedInScore: true }] };

describe('selected home evidence', () => {
  it('uses only linked scoring locations, preserving their actual coordinates and distances', () => {
    const locations = selectedEvidenceLocations(home);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ lat: 1.301, lng: 103.801, distanceM: 157, context: 'Used in score', labelDirection: 'top' });
    const collection = evidenceCollection(home, locations);
    expect(collection.features[0].geometry.coordinates).toEqual([103.801, 1.301]);
    expect(collection.features[1].geometry.coordinates).toEqual([[103.8, 1.3], [103.801, 1.301]]);
    expect(collection.features[1].properties.distanceLabel).toBe('157 m straight-line');
  });
  it('keeps personal places separate from the score and includes only evaluated place checks', () => {
    const places = [{ id: 'work', label: 'Work', latitude: 1.31, longitude: 103.81 }, { id: 'private', label: 'Other private place', latitude: 1.4, longitude: 103.9 }];
    const locations = selectedEvidenceLocations({ ...home, placeDistances: [{ placeId: 'work', distanceM: 1500 }] }, places);
    expect(locations).toHaveLength(2);
    expect(locations[1]).toMatchObject({ name: 'Work', context: 'Search distance check · not part of score' });
    expect(JSON.stringify(locations)).not.toContain('Other private place');
  });
  it('does not fabricate coordinates for missing, old, or ungeocoded evidence', () => {
    expect(selectedEvidenceLocations({ ...home, scoreLocations: undefined })).toEqual([]);
    expect(selectedEvidenceLocations({ ...home, lat: null })).toEqual([]);
    for (const lat of [null, '', false, 999]) expect(selectedEvidenceLocations({ ...home, scoreLocations: [{ ...home.scoreLocations[0], lat }] })).toEqual([]);
    expect(selectedEvidenceLocations({ ...home, scoreLocations: [{ ...home.scoreLocations[0], usedInScore: false }] })[0].context).toContain('not included in score');
  });
});
