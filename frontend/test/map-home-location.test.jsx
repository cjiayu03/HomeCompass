import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MapPanel } from '../components/map-panel.jsx';

const { requestJsonMock } = vi.hoisted(() => ({ requestJsonMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ requestJson: requestJsonMock }));
vi.mock('../components/workspace-provider.jsx', () => ({
  useWorkspace: () => ({ brief: { priorityWeights: {} }, places: [], resourceFeatures: [], resourceState: { status: 'success' } }),
}));
vi.mock('../components/planning-provider.jsx', () => ({ usePlanning: () => ({ scenarios: [], decisions: {}, photos: {} }) }));
vi.mock('../components/auth-provider.jsx', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => function MapCanvas() { return <div data-testid="map-canvas" />; } }));

const unlocatedHome = { id: 'home-1', address: '10 TOA PAYOH LOR 1', town: 'TOA PAYOH', lat: null, lng: null };

beforeEach(() => {
  requestJsonMock.mockResolvedValue({
    items: [{ address: '10 TOA PAYOH LORONG 1 SINGAPORE 310010', latitude: 1.34, longitude: 103.85, provider: 'OneMap' }],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('looks up an unlocated home through the home-location endpoint, not the address search quota', async () => {
  render(<MapPanel homes={[unlocatedHome]} selectedHome={unlocatedHome} />);

  await waitFor(() => expect(requestJsonMock).toHaveBeenCalledTimes(1));
  const [path, options] = requestJsonMock.mock.calls[0];
  expect(path).toBe('/api/v1/map/home-location');
  expect(JSON.parse(options.body)).toEqual({ query: unlocatedHome.address });
  expect(requestJsonMock).not.toHaveBeenCalledWith('/api/v1/map/address-search', expect.anything());
});

it('does not look up a home that already has stored coordinates', async () => {
  const located = { ...unlocatedHome, lat: 1.34, lng: 103.85 };
  render(<MapPanel homes={[located]} selectedHome={located} />);

  await new Promise(resolve => setTimeout(resolve, 450));
  expect(requestJsonMock).not.toHaveBeenCalledWith('/api/v1/map/home-location', expect.anything());
});

it('reports the home as unavailable when the lookup is rate limited', async () => {
  requestJsonMock.mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }));
  render(<MapPanel homes={[unlocatedHome]} selectedHome={unlocatedHome} />);

  expect(await screen.findByText(`No verified block location found for ${unlocatedHome.address}.`)).toBeInTheDocument();
});
