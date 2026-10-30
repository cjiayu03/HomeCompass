import { describe, expect, it } from 'vitest';
import { mapLayers } from '../lib/map-layers.js';
import { mapLayerClusterMarkup, mapLayerIcons, mapLayerMarkerMarkup, mapLayerMarkerSvg } from '../lib/map-layer-icons.js';

describe('map layer symbols', () => {
  it('uses the same distinct icon set in the menu and on individual map facilities', () => {
    for (const [type, , color] of mapLayers) {
      expect(mapLayerIcons[type]).toBeDefined();
      expect(mapLayerMarkerMarkup(type)).toContain('class="map-resource-marker"');
      expect(mapLayerMarkerMarkup(type)).toContain(`--resource-color:${color}`);
      expect(mapLayerMarkerSvg(type)).toContain(`stroke="${color}"`);
    }
    expect(mapLayerMarkerMarkup('childcare')).toContain('lucide-baby');
    expect(mapLayerMarkerMarkup('park_facility')).toContain('lucide-trees');
    expect(mapLayerClusterMarkup('childcare', 3)).toContain('lucide-baby');
    expect(mapLayerClusterMarkup('childcare', 3)).toContain('>3</span>');
  });
});
