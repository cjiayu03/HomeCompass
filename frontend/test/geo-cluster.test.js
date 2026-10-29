import { describe, expect, it } from 'vitest';
import { clusterPointFeatures } from '../lib/geo-cluster.js';

function point(id, coordinates, properties = {}) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates },
    properties: { resourceType: 'chas_clinic', name: `Clinic ${id}`, ...properties },
  };
}

describe('clusterPointFeatures', () => {
  it('clusters nearby points with their IDs, centroid, and representative source metadata', () => {
    const first = point('resource-a', [103.8, 1.3], {
      name: 'Central Clinic',
      sourceId: 'clinic-snapshot',
      sourceVersion: '2026-10',
      retrievedAt: '2026-10-18T12:00:00+00:00',
    });
    const second = point('resource-b', [103.804, 1.304], { name: 'Nearby Clinic' });

    const [cluster] = clusterPointFeatures([first, second], { cellSize: 0.02 });

    expect(cluster).toMatchObject({
      type: 'Feature',
      geometry: { type: 'Point' },
      properties: {
        cluster: true,
        count: 2,
        memberIds: ['resource-a', 'resource-b'],
        name: 'Central Clinic',
        resourceType: 'chas_clinic',
        sourceId: 'clinic-snapshot',
        sourceVersion: '2026-10',
        retrievedAt: '2026-10-18T12:00:00+00:00',
      },
    });
    expect(cluster.geometry.coordinates[0]).toBeCloseTo(103.802);
    expect(cluster.geometry.coordinates[1]).toBeCloseTo(1.302);
  });

  it('leaves distant points as their original individual features', () => {
    const west = point('west', [103.8, 1.3]);
    const east = point('east', [104.2, 1.3]);

    const result = clusterPointFeatures([west, east], { cellSize: 0.02 });

    expect(result).toEqual([west, east]);
    expect(result[0]).toBe(west);
    expect(result[1]).toBe(east);
  });

  it('passes valid polygons through unchanged while clustering point resources', () => {
    const polygon = {
      type: 'Feature',
      id: 'zone-1',
      geometry: { type: 'Polygon', coordinates: [[[103.7, 1.2], [103.9, 1.2], [103.9, 1.4], [103.7, 1.2]]] },
      properties: { resourceType: 'school_zone', name: 'Zone 1' },
    };
    const first = point('one', [103.8, 1.3]);
    const second = point('two', [103.801, 1.301]);

    const result = clusterPointFeatures([polygon, first, second], { cellSize: 0.02 });

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(polygon);
    expect(result[1].properties.count).toBe(2);
  });

  it('ignores malformed geometries without throwing or passing them to the map', () => {
    const valid = point('valid', [103.8, 1.3]);
    const malformed = [
      { type: 'Feature', id: 'bad-point', geometry: { type: 'Point', coordinates: ['103.8', null] }, properties: {} },
      { type: 'Feature', id: 'bad-polygon', geometry: { type: 'Polygon', coordinates: 'not coordinates' }, properties: {} },
      { type: 'Feature', id: 'misnested-polygon', geometry: { type: 'Polygon', coordinates: [[103.8, 1.3], [103.9, 1.4], [103.7, 1.3]] }, properties: {} },
      { type: 'Feature', id: 'no-geometry', geometry: null, properties: {} },
      null,
    ];

    const result = clusterPointFeatures([valid, ...malformed], { cellSize: 0.02 });

    expect(result).toEqual([valid]);
    expect(result[0]).toBe(valid);
  });

  it('rejects invalid extra ordinates while preserving valid 2D and 3D positions', () => {
    const twoDimensional = point('two-d', [103.8, 1.3]);
    const threeDimensional = point('three-d', [103.801, 1.301, 12]);
    const invalidExtraOrdinates = [
      point('null-height', [103.802, 1.302, null]),
      point('string-height', [103.803, 1.303, '12']),
      point('infinite-height', [103.804, 1.304, Infinity]),
    ];

    const result = clusterPointFeatures([twoDimensional, threeDimensional, ...invalidExtraOrdinates], { cellSize: 0.02 });

    expect(result).toHaveLength(1);
    expect(result[0].properties).toMatchObject({
      cluster: true,
      count: 2,
      memberIds: ['two-d', 'three-d'],
    });
  });

  it('rejects malformed polygon positions and sparse ring entries', () => {
    const malformedExtraOrdinate = {
      type: 'Feature',
      id: 'bad-extra-ordinate',
      geometry: {
        type: 'Polygon',
        coordinates: [[[103.7, 1.2], [103.9, 1.2], [103.9, 1.4, null], [103.7, 1.2]]],
      },
      properties: {},
    };
    const nestedPosition = {
      type: 'Feature',
      id: 'nested-position',
      geometry: {
        type: 'Polygon',
        coordinates: [[[103.7, 1.2], [103.9, 1.2], [103.9, 1.4, [5]], [103.7, 1.2]]],
      },
      properties: {},
    };
    const sparseRing = new Array(4);
    sparseRing[0] = [103.7, 1.2];
    sparseRing[3] = [103.7, 1.2];
    const sparsePolygon = {
      type: 'Feature',
      id: 'sparse-ring',
      geometry: { type: 'Polygon', coordinates: [sparseRing] },
      properties: {},
    };

    const result = clusterPointFeatures([malformedExtraOrdinate, nestedPosition, sparsePolygon]);

    expect(result).toEqual([]);
  });

  it('keeps a single point individual and does not mutate API features', () => {
    const feature = point('only', [103.8, 1.3], { attributes: { postalCode: '123456' } });
    const before = structuredClone(feature);

    const result = clusterPointFeatures([feature], { cellSize: 0.02 });

    expect(result).toEqual([feature]);
    expect(result[0]).toBe(feature);
    expect(feature).toEqual(before);
  });
});


it('keeps community, park and health clusters separate at the same location', () => {
  const features = ['community_club', 'park_facility', 'eldercare'].flatMap(type => [
    point(`${type}-1`, [103.8, 1.3], { resourceType: type }),
    point(`${type}-2`, [103.801, 1.301], { resourceType: type }),
  ]);
  const clusters = clusterPointFeatures(features);
  expect(clusters).toHaveLength(3);
  expect(clusters.map(feature => feature.properties.resourceType)).toEqual(['community_club', 'park_facility', 'eldercare']);
  expect(clusters.every(feature => feature.properties.count === 2)).toBe(true);
});
