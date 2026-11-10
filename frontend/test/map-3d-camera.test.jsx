import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import Map3DView from '../components/map-3d-view.jsx';
import { dengueSeverityColors, mapFeatureRevision } from '../lib/map-layers.js';

const { maps, popups } = vi.hoisted(() => ({ maps: [], popups: [] }));

vi.mock('maplibre-gl', () => {
  class MapMock {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.layerListeners = new Map();
      this.onceListeners = new Map();
      this.sources = new Map();
      this.layers = [];
      this.calls = [];
      maps.push(this);
    }
    on(type, target, listener) {
      const callback = typeof target === 'function' ? target : listener;
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
      if (typeof target === 'string') {
        const key = `${type}:${target}`;
        if (!this.layerListeners.has(key)) this.layerListeners.set(key, []);
        this.layerListeners.get(key).push(callback);
      }
    }
    once(type, listener) { this.onceListeners.set(type, listener); }
    emit(type, event = {}) {
      const once = this.onceListeners.get(type);
      if (once) { this.onceListeners.delete(type); once(event); }
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    addSource(id, source = {}) {
      const stored = { ...source, setData: vi.fn(data => { stored.data = data; }) };
      this.sources.set(id, stored);
    }
    getSource(id) { return this.sources.get(id); }
    addLayer(layer) { this.layers.push(layer); }
    moveLayer() {}
    setFilter() {}
    getStyle() { return { layers: [] }; }
    getBounds() { return { getWest: () => 103.7, getEast: () => 103.9, getSouth: () => 1.2, getNorth: () => 1.5 }; }
    getZoom() { return 11; }
    getContainer() { return this.options.container; }
    getCanvas() { return { style: {} }; }
    jumpTo(args) { this.calls.push({ method: 'jumpTo', args }); }
    flyTo(args) { this.calls.push({ method: 'flyTo', args }); }
    fitBounds(args) { this.calls.push({ method: 'fitBounds', args }); }
    easeTo(args) { this.calls.push({ method: 'easeTo', args }); }
    zoomIn() {}
    zoomOut() {}
    remove() {}
  }
  class BoundsMock {
    extend() { return this; }
    getEast() { return 103.9; }
    getWest() { return 103.7; }
    getNorth() { return 1.5; }
    getSouth() { return 1.2; }
    getCenter() { return { lng: 103.8, lat: 1.35 }; }
  }
  class MarkerMock {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() {}
  }
  class PopupMock {
    constructor() { this.remove = vi.fn(); popups.push(this); }
    setLngLat() { return this; }
    setDOMContent(content) { this.content = content; return this; }
    addTo() { return this; }
  }
  return {
    Map: MapMock,
    LngLatBounds: BoundsMock,
    Marker: MarkerMock,
    Popup: PopupMock,
    setWorkerUrl: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  maps.length = 0;
  popups.length = 0;
});

const home = { id: 'camera-home', address: '1 Test Road', lat: 1.33, lng: 103.84 };
const address = { address: '505 Ang Mo Kio Avenue 8', latitude: 1.3748, longitude: 103.8502, provider: 'OneMap' };

function viewProps(overrides = {}) {
  return {
    homes: [home],
    resources: [],
    visibleResourceTypes: [],
    selectedHome: home,
    hoveredHome: null,
    anchors: [],
    onUnavailable: vi.fn(),
    onSelect: vi.fn(),
    cameraIntent: { type: 'initial', request: 0 },
    homeFocusRequest: 0,
    centerRequest: 0,
    addressTarget: null,
    addressRequest: 0,
    addressFocused: false,
    onViewportChange: vi.fn(),
    ...overrides,
  };
}

it('applies Singapore reset after a pending style load and lets a later home locate win', async () => {
  const initial = viewProps();
  const { rerender } = render(<Map3DView {...initial} />);
  await waitFor(() => expect(maps).toHaveLength(1));
  const map = maps[0];
  const reset = viewProps({ centerRequest: 1, cameraIntent: { type: 'reset', request: 1 } });
  rerender(<Map3DView {...reset} />);
  expect(map.calls.filter(call => call.method === 'flyTo')).toHaveLength(0);

  act(() => map.emit('load'));
  await waitFor(() => expect(map.calls.at(-1)).toMatchObject({
    method: 'flyTo',
    args: { center: [103.8198, 1.3521] },
  }));
  expect(map.calls.some(call => call.method === 'fitBounds')).toBe(false);

  rerender(<Map3DView {...viewProps({
    centerRequest: 1,
    cameraIntent: { type: 'home', request: 2 },
    homeFocusRequest: 2,
  })} />);
  await waitFor(() => expect(map.calls.at(-1)).toMatchObject({
    method: 'flyTo',
    args: { center: [home.lng, home.lat], zoom: 17 },
  }));
});

it('keeps a newer address selection as camera owner when the 3D style is still loading', async () => {
  const initial = viewProps();
  const { rerender } = render(<Map3DView {...initial} />);
  await waitFor(() => expect(maps).toHaveLength(1));
  const map = maps[0];
  rerender(<Map3DView {...viewProps({ centerRequest: 1, cameraIntent: { type: 'reset', request: 1 } })} />);
  rerender(<Map3DView {...viewProps({
    centerRequest: 1,
    cameraIntent: { type: 'address', request: 2 },
    addressTarget: address,
    addressRequest: 1,
    addressFocused: true,
  })} />);

  act(() => map.emit('load'));
  await waitFor(() => expect(map.calls.at(-1)).toMatchObject({
    method: 'flyTo',
    args: { center: [address.longitude, address.latitude], zoom: 15 },
  }));
  expect(map.calls.some(call => call.method === 'flyTo' && call.args.center?.[0] === 103.8198)).toBe(false);
});

it('styles both NEA bands and updates an unchanged GeoJSON feature id after refresh', async () => {
  const now = Date.now();
  const originalSourceTime = new Date(now - 60 * 60 * 1000).toISOString();
  const refreshedSourceTime = new Date(now - 5 * 60 * 1000).toISOString();
  const feature = (count, sourceUpdatedAt, recordUpdatedAt) => ({
    type: 'Feature', id: 'same-cluster-id',
    geometry: { type: 'Polygon', coordinates: [[[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.3]]] },
    properties: { resourceType: 'dengue_cluster', name: 'Test locality', caseCount: count, sourceUpdatedAt, recordUpdatedAt },
  });
  const originalPolicy = { state: 'fresh', usable: true, sourceUpdatedAt: originalSourceTime, validUntil: new Date(Date.parse(originalSourceTime) + 48 * 60 * 60 * 1000).toISOString(), checkedAt: new Date(now).toISOString() };
  const refreshedPolicy = { ...originalPolicy, sourceUpdatedAt: refreshedSourceTime, validUntil: new Date(Date.parse(refreshedSourceTime) + 48 * 60 * 60 * 1000).toISOString(), checkedAt: new Date(now + 1).toISOString() };
  const nine = feature(9, originalSourceTime, '2026-10-27T09:00:00+00:00');
  const ten = feature(10, refreshedSourceTime, '2026-10-30T08:55:00+00:00');
  expect(mapFeatureRevision([nine])).not.toBe(mapFeatureRevision([ten]));
  expect(mapFeatureRevision([nine])).not.toBe(mapFeatureRevision([feature(9, originalSourceTime, '2026-10-28T09:00:00+00:00')]));

  const initial = viewProps({
    homes: [], selectedHome: null, resources: [nine], visibleResourceTypes: ['dengue_cluster'],
    denguePolicy: originalPolicy, dengueNow: now,
  });
  const { rerender } = render(<Map3DView {...initial} />);
  await waitFor(() => expect(maps).toHaveLength(1));
  const map = maps[0];
  act(() => map.emit('load'));
  const source = map.getSource('hc-resources');
  expect(source.data.features).toHaveLength(1);
  const polygonLayer = map.layers.find(layer => layer.id === 'hc-resource-polygons');
  const colorExpression = JSON.stringify(polygonLayer.paint['fill-color']);
  expect(colorExpression).toContain(dengueSeverityColors.red);
  expect(colorExpression).toContain(dengueSeverityColors.yellow);
  expect(JSON.stringify(polygonLayer.filter)).toContain('MultiPolygon');
  map.layerListeners.get('click:hc-resource-polygons')[0]({ features: [nine], lngLat: { lng: 103.805, lat: 1.305 } });
  const yellowPopup = popups.at(-1);
  expect(yellowPopup.content.textContent).toContain('Yellow alert');
  const reposition = vi.spyOn(yellowPopup, 'setLngLat');
  yellowPopup.content.querySelector('details').dispatchEvent(new Event('toggle'));
  expect(reposition).toHaveBeenCalledWith({ lng: 103.805, lat: 1.305 });
  map.layerListeners.get('click:hc-score-points')[0]({
    features: [{ properties: { name: 'Scoring school', label: 'School', distanceLabel: '280 m straight-line', context: 'Used in score' } }],
    lngLat: { lng: 103.805, lat: 1.305 },
  });
  const scorePopup = popups.at(-1);
  expect(scorePopup.content.textContent).toContain('Scoring school');

  rerender(<Map3DView {...viewProps({
    homes: [], selectedHome: null, resources: [ten], visibleResourceTypes: ['dengue_cluster'],
    denguePolicy: refreshedPolicy, dengueNow: now,
  })} />);
  await waitFor(() => expect(source.setData).toHaveBeenCalled());
  const refreshed = source.setData.mock.calls.at(-1)[0].features[0];
  expect(refreshed.id).toBe('same-cluster-id');
  expect(refreshed.properties.caseCount).toBe(10);
  expect(refreshed.properties.sourceUpdatedAt).toBe(refreshedSourceTime);
  expect(refreshed.properties.recordUpdatedAt).toBe('2026-10-30T08:55:00+00:00');
  await waitFor(() => expect(yellowPopup.remove).toHaveBeenCalledTimes(1));
  expect(scorePopup.remove).not.toHaveBeenCalled();
  map.layerListeners.get('click:hc-resource-polygons')[0]({ features: [ten], lngLat: { lng: 103.805, lat: 1.305 } });
  const refreshedPopup = popups.at(-1);
  expect(refreshedPopup.content.textContent).toContain('Red alert');

  const nextSourceTime = new Date(now - 2 * 60 * 1000).toISOString();
  const tenAtNewSnapshot = feature(10, nextSourceTime, '2026-10-30T09:00:00+00:00');
  const nextPolicy = { ...refreshedPolicy, sourceUpdatedAt: nextSourceTime, validUntil: new Date(Date.parse(nextSourceTime) + 48 * 60 * 60 * 1000).toISOString() };
  rerender(<Map3DView {...viewProps({
    homes: [], selectedHome: null, resources: [tenAtNewSnapshot], visibleResourceTypes: ['dengue_cluster'],
    denguePolicy: nextPolicy, dengueNow: now,
  })} />);
  await waitFor(() => expect(refreshedPopup.remove).toHaveBeenCalledTimes(1));

  map.layerListeners.get('click:hc-resource-polygons')[0]({ features: [tenAtNewSnapshot], lngLat: { lng: 103.805, lat: 1.305 } });
  const popupBeforeLayerToggle = popups.at(-1);
  rerender(<Map3DView {...viewProps({
    homes: [], selectedHome: null, resources: [tenAtNewSnapshot], visibleResourceTypes: [],
    denguePolicy: nextPolicy, dengueNow: now,
  })} />);
  await waitFor(() => expect(popupBeforeLayerToggle.remove).toHaveBeenCalledTimes(1));
});
