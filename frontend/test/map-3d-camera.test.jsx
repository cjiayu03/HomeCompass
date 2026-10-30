import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import Map3DView from '../components/map-3d-view.jsx';

const { maps } = vi.hoisted(() => ({ maps: [] }));

vi.mock('maplibre-gl', () => {
  class MapMock {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.onceListeners = new Map();
      this.sources = new Map();
      this.calls = [];
      maps.push(this);
    }
    on(type, target, listener) {
      const callback = typeof target === 'function' ? target : listener;
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    once(type, listener) { this.onceListeners.set(type, listener); }
    emit(type, event = {}) {
      const once = this.onceListeners.get(type);
      if (once) { this.onceListeners.delete(type); once(event); }
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    addSource(id) { this.sources.set(id, { setData: vi.fn() }); }
    getSource(id) { return this.sources.get(id); }
    addLayer() {}
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
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() {}
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
