import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapAddressSearch } from '../components/map-address-search.jsx';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api-client.js', () => ({ requestJson: request }));
const candidate = { address: '1 Example Road', latitude: 1.31, longitude: 103.85, provider: 'OneMap' };
afterEach(() => { cleanup(); request.mockReset(); });

it('lets a visitor search and select a candidate without saving it', async () => {
  const select = vi.fn();
  request.mockResolvedValue({ items: [candidate] });
  render(<MapAddressSearch onSelect={select} onClear={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an address or postal code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByLabelText('Search map addresses'));
  const result = await screen.findByRole('button', { name: /1 Example Road/ });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ query: '123456' });
  fireEvent.click(result);
  expect(select).toHaveBeenCalledWith(candidate);
  expect(screen.queryByLabelText('Address suggestions')).toBeNull();
});

it('ignores an older response after the user edits and searches again', async () => {
  let resolveOld;
  request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ items: [{ ...candidate, address: 'New result' }] });
  render(<MapAddressSearch onSelect={vi.fn()} onClear={vi.fn()} />);
  const input = screen.getByLabelText('Find an address or postal code');
  fireEvent.change(input, { target: { value: 'old' } });
  fireEvent.click(screen.getByLabelText('Search map addresses'));
  fireEvent.change(input, { target: { value: 'new' } });
  fireEvent.click(screen.getByLabelText('Search map addresses'));
  expect(await screen.findByRole('button', { name: /New result/ })).toBeInTheDocument();
  resolveOld({ items: [candidate] });
  await waitFor(() => expect(screen.queryByRole('button', { name: /1 Example Road/ })).toBeNull());
});

it('offers to show the selected address again or clear it', () => {
  const select = vi.fn(), clear = vi.fn();
  render(<MapAddressSearch selectedAddress={candidate} onSelect={select} onClear={clear} />);
  fireEvent.click(screen.getByRole('button', { name: /Show 1 Example Road on map again/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear selected address' }));
  expect(select).toHaveBeenCalledWith(candidate);
  expect(clear).toHaveBeenCalledOnce();
});
