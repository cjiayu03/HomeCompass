'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { requestJson } from '@/lib/api-client';

export function MapAddressSearch({ selectedAddress, onSelect, onClear, optionsOpen = false, onSearchStart }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [] });
  const activeRequest = useRef(null);
  const requestVersion = useRef(0);

  function invalidate() {
    requestVersion.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }
  useEffect(() => () => invalidate(), []);
  useEffect(() => { if (optionsOpen) { invalidate(); setState({ status: 'idle', items: [] }); } }, [optionsOpen]);

  async function search(event) {
    event.preventDefault();
    const text = query.trim();
    onSearchStart?.();
    invalidate();
    if (!text) { setState({ status: 'idle', items: [] }); return; }
    const version = requestVersion.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ status: 'loading', items: [] });
    try {
      const response = await requestJson('/api/v1/map/address-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }), signal: controller.signal,
      });
      if (version !== requestVersion.current) return;
      if (!Array.isArray(response?.items)) throw new Error('Invalid response');
      const items = response.items.filter(item => typeof item?.address === 'string' && item.address.trim() && typeof item.latitude === 'number' && Number.isFinite(item.latitude) && item.latitude >= 1.13 && item.latitude <= 1.47 && typeof item.longitude === 'number' && Number.isFinite(item.longitude) && item.longitude >= 103.59 && item.longitude <= 104.07);
      setState({ status: items.length ? 'success' : 'empty', items });
    } catch (error) {
      if (version !== requestVersion.current || error?.name === 'AbortError') return;
      setState({ status: 'error', items: [], message: error?.status === 429 ? 'Too many searches. Please try again shortly.' : 'Address search is temporarily unavailable. Please try again.' });
    }
  }

  return <div className="absolute left-3 top-3 z-[11] w-[min(22rem,calc(100%-8rem))] sm:w-[min(22rem,calc(100%-14rem))]">
    <form onSubmit={search} role="search" aria-label="Find an address on the map" className="flex gap-1 rounded-xl border bg-background/95 p-1 shadow-md backdrop-blur">
      <label htmlFor="map-address-input" className="sr-only">Find an address or postal code</label>
      <input id="map-address-input" type="search" maxLength={160} value={query} placeholder="Address or postal code" onChange={event => { invalidate(); setQuery(event.target.value); setState({ status: 'idle', items: [] }); }} className="h-10 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <button type="submit" aria-label="Search map addresses" disabled={!query.trim() || state.status === 'loading'} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"><Search aria-hidden="true" className="size-4" /></button>
    </form>
    {state.status === 'loading' && <p role="status" className="mt-1 rounded-lg border bg-background px-3 py-2 text-xs">Searching addresses…</p>}
    {state.status === 'empty' && <p role="status" className="mt-1 rounded-lg border bg-background px-3 py-2 text-xs">No addresses found. Try another search.</p>}
    {state.status === 'error' && <p role="alert" className="mt-1 rounded-lg border bg-background px-3 py-2 text-xs">{state.message}</p>}
    {state.status === 'success' && <ul aria-label="Address suggestions" className="mt-1 max-h-48 overflow-y-auto rounded-xl border bg-background shadow-md">{state.items.map((item, index) => <li key={`${item.latitude},${item.longitude},${index}`}><button type="button" onClick={() => { onSelect(item); setState({ status: 'idle', items: [] }); }} className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-secondary focus-visible:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span>{item.address}<span className="mt-0.5 block text-muted-foreground">{item.provider || 'Address search'}</span></span></button></li>)}</ul>}
    {selectedAddress && !optionsOpen && <div className="mt-1 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-md"><button type="button" onClick={() => onSelect(selectedAddress)} className="min-h-10 min-w-0 flex-1 truncate px-2 text-left text-xs font-medium" aria-label={`Show ${selectedAddress.address} on map again`}><MapPin aria-hidden="true" className="mr-1 inline size-3.5 text-primary" />{selectedAddress.address}</button><button type="button" onClick={onClear} aria-label="Clear selected address" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-secondary"><X aria-hidden="true" className="size-4" /></button></div>}
  </div>;
}
