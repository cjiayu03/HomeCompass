import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ maps: [], markers: [] }));
vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor() { this.flyTo = vi.fn(); this.fitBounds = vi.fn(); this.jumpTo = vi.fn(); this.setFilter = vi.fn(); this.remove = vi.fn(); this.sources = {}; mocks.maps.push(this); }
    on() {}
    once(_event, callback) { this.load = callback; }
    addSource(id) { this.sources[id] = { setData: vi.fn() }; }
    getSource(id) { return this.sources[id]; }
    addLayer() {}
    getStyle() { return { layers: [] }; }
    getBounds() { return { getWest: () => 103.7, getEast: () => 103.9, getSouth: () => 1.2, getNorth: () => 1.4 }; }
    getZoom() { return 11; }
  }
  class FakeMarker {
    constructor() { this.setLngLat = vi.fn(() => this); this.setPopup = vi.fn(() => this); this.addTo = vi.fn(() => this); this.remove = vi.fn(); mocks.markers.push(this); }
  }
  class FakePopup { setText(value) { this.text = value; return this; } }
  return { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: class {}, setWorkerUrl: vi.fn() };
});
import Map3DView from '../components/map-3d-view.jsx';

afterEach(() => { cleanup(); mocks.maps.length = 0; mocks.markers.length = 0; vi.unstubAllGlobals(); });

it('moves the 3D map using longitude then latitude and keeps the pin through repeated selections', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const target = { address: '<b>Example</b>', latitude: 1.31, longitude: 103.85 };
  const homes = [{ id: 'home', lat: 1.33, lng: 103.8 }];
  const props = { homes, resources: [], visibleResourceTypes: [], onSelect: vi.fn(), addressTarget: target, addressRequest: 1, addressFocused: true };
  const view = render(<Map3DView {...props} />);
  await act(async () => mocks.maps[0].load());
  const map = mocks.maps[0];
  await waitFor(() => expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [103.85, 1.31], duration: 0 })));
  expect(map.jumpTo).not.toHaveBeenCalled();
  expect(mocks.markers.at(-1).setLngLat).toHaveBeenCalledWith([103.85, 1.31]);
  expect(mocks.markers.at(-1).setPopup.mock.calls[0][0].text).toBe('<b>Example</b>');
  view.rerender(<Map3DView {...props} addressRequest={2} />);
  expect(map.flyTo).toHaveBeenCalledTimes(2);
  view.rerender(<Map3DView {...props} addressRequest={2} addressTarget={null} addressFocused={false} />);
  expect(mocks.markers.at(-1).remove).toHaveBeenCalled();
});
