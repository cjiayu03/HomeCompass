import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapAddressSearch } from '../components/map-address-search.jsx';
import { matchHomeMapCandidate, normalizeMapAddressCandidates } from '../lib/map-address-search.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api-client.js', () => ({ requestJson: request }));

const candidate = { address: '1 Example Road', latitude: 1.31, longitude: 103.85, provider: 'OneMap' };
afterEach(() => { cleanup(); request.mockReset(); });

it('lets a guest search and choose an address without invoking any save flow', async () => {
  const select = vi.fn();
  request.mockResolvedValue({ items: [candidate] });
  render(<MapAddressSearch onSelect={select} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));

  fireEvent.click(await screen.findByRole('button', { name: '1 Example Road' }));
  expect(request).toHaveBeenCalledWith('/api/v1/map/address-search', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ query: '123456' }),
  }));
  expect(select).toHaveBeenCalledWith({ ...candidate, provider: 'OneMap' });
  expect(screen.queryByLabelText('Address suggestions')).not.toBeInTheDocument();
});

it('reports whitespace without sending a request', async () => {
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Enter an address or postal code to search.');
  expect(request).not.toHaveBeenCalled();
});

it('aborts and ignores a previous result when the query changes', async () => {
  let resolveOld;
  let oldSignal;
  request.mockImplementationOnce((_path, options) => {
    oldSignal = options.signal;
    return new Promise(resolve => { resolveOld = resolve; });
  }).mockResolvedValueOnce({ items: [{ ...candidate, address: 'New result' }] });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByLabelText('Find an address or postal code');
  fireEvent.change(input, { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  fireEvent.change(input, { target: { value: 'new' } });
  expect(oldSignal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  expect(await screen.findByRole('button', { name: 'New result' })).toBeInTheDocument();

  resolveOld({ items: [candidate] });
  await waitFor(() => expect(screen.queryByRole('button', { name: '1 Example Road' })).not.toBeInTheDocument());
});

it('does not let an older failure replace newer results', async () => {
  let rejectOld;
  request.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
    .mockResolvedValueOnce({ items: [{ ...candidate, address: 'Fresh result' }] });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByLabelText('Find an address or postal code');
  fireEvent.change(input, { target: { value: 'old' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  fireEvent.change(input, { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  expect(await screen.findByRole('button', { name: 'Fresh result' })).toBeInTheDocument();

  rejectOld({ status: 502 });
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Fresh result' })).toBeInTheDocument();
});

it('distinguishes no matches, rate limits, and provider configuration failures', async () => {
  request.mockResolvedValueOnce({ items: [] })
    .mockRejectedValueOnce({ status: 429 })
    .mockRejectedValueOnce({ status: 503, code: 'ONEMAP_UNCONFIGURED' });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByLabelText('Find an address or postal code');
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));

  fireEvent.change(input, { target: { value: '123456' } });
  submit();
  expect(await screen.findByText('No addresses found. Try another search.')).toBeInTheDocument();
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many address searches. Please try again shortly.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry address search' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Address search is not configured right now. Please try again later.');
});

it('offers an explicit retry and keeps the previous selected address on failure', async () => {
  request.mockRejectedValueOnce({ status: 502 }).mockResolvedValueOnce({ items: [candidate] });
  const select = vi.fn();
  render(<MapAddressSearch selectedAddress={candidate} onSelect={select} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Address search is temporarily unavailable. Please try again.');
  expect(screen.getByRole('button', { name: 'Show 1 Example Road on map again' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry address search' }));
  expect(await screen.findByRole('button', { name: '1 Example Road' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 Example Road on map again' }));
  expect(select).toHaveBeenCalledWith({ ...candidate, provider: 'OneMap' });
});

it('dismisses an active request when map options open and ignores its response', async () => {
  let resolveRequest;
  let signal;
  request.mockImplementationOnce((_path, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveRequest = resolve; });
  });
  const { rerender } = render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} optionsOpen={false} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  rerender(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} optionsOpen />);
  expect(signal.aborted).toBe(true);

  resolveRequest({ items: [candidate] });
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '1 Example Road' })).not.toBeInTheDocument();
});

it('Escape dismisses results and returns focus to the search input', async () => {
  request.mockResolvedValue({ items: [candidate] });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  const result = await screen.findByRole('button', { name: '1 Example Road' });
  fireEvent.keyDown(result, { key: 'Escape' });

  expect(screen.queryByRole('button', { name: '1 Example Road' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Find an address or postal code')).toHaveFocus();
});

it('rejects malformed results and uses the backend coordinate boundaries', async () => {
  expect(() => normalizeMapAddressCandidates([{ ...candidate, latitude: 1.12 }])).toThrow('Address search returned invalid results.');
  expect(() => normalizeMapAddressCandidates([{ ...candidate, longitude: Number.NaN }])).toThrow('Address search returned invalid results.');
  expect(normalizeMapAddressCandidates([
    { ...candidate, latitude: 1.13, longitude: 103.59 },
    { ...candidate, latitude: 1.47, longitude: 104.07 },
  ])).toHaveLength(2);

  request.mockResolvedValue({ items: [{ ...candidate, latitude: 1.12 }] });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Address search returned an invalid response. Please try again.');
});

it('normalizes duplicate results and keeps the candidate list bounded', () => {
  const items = [
    candidate,
    { ...candidate, address: ' 1   EXAMPLE ROAD ' },
    ...Array.from({ length: 12 }, (_, index) => ({ ...candidate, address: `${index + 2} Example Road` })),
  ];
  const normalized = normalizeMapAddressCandidates(items);
  expect(normalized).toHaveLength(10);
  expect(normalized[0].address).toBe('1 Example Road');
  expect(normalized.at(-1).address).toBe('10 Example Road');
});

it('uses an unambiguous exact block and street match for an approximate home pin', () => {
  const home = { address: '20 Bukit Batok Street 23' };
  const candidate = { address: '20 BUKIT BATOK ST 23 SINGAPORE 659531', latitude: 1.345, longitude: 103.754 };

  expect(matchHomeMapCandidate(home, [candidate])).toBe(candidate);
});

it('rejects a candidate with a different block or street', () => {
  const home = { address: '109A Canberra Walk' };

  expect(matchHomeMapCandidate(home, [
    { address: '109B Canberra Walk', latitude: 1.45, longitude: 103.82 },
    { address: '109A Canberra Drive', latitude: 1.45, longitude: 103.82 },
  ])).toBeNull();
});

it('rejects multiple exact block and street matches at different coordinates', () => {
  const home = { address: '109A Canberra Walk' };

  expect(matchHomeMapCandidate(home, [
    { address: '109A Canberra Walk', latitude: 1.45, longitude: 103.82 },
    { address: '109A Canberra Walk Singapore 751109', latitude: 1.451, longitude: 103.821 },
  ])).toBeNull();
});

it('opens the compact control on tap without submitting an empty address', () => {
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByLabelText('Find an address or postal code');
  fireEvent.click(screen.getByRole('button', { name: 'Search map addresses' }));
  expect(input).toHaveFocus();
  expect(input.closest('.map-address-search')).toHaveAttribute('data-expanded', 'true');
  expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
