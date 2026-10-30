'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, Search, X } from 'lucide-react';
import { requestJson } from '@/lib/api-client';
import { normalizeMapAddressCandidates } from '@/lib/map-address-search';

function searchErrorMessage(error) {
  if (error?.status === 429) return 'Too many address searches. Please try again shortly.';
  if (error?.status === 422) return 'Enter an address or postal code of up to 160 characters.';
  if (error?.code === 'ONEMAP_UNCONFIGURED' || error?.status === 503) {
    return 'Address search is not configured right now. Please try again later.';
  }
  if (error?.code === 'INVALID_ADDRESS_RESULTS' || error?.code === 'MALFORMED_PAYLOAD') {
    return 'Address search returned an invalid response. Please try again.';
  }
  return 'Address search is temporarily unavailable. Please try again.';
}

const initialState = { status: 'idle', items: [] };

export function MapAddressSearch({ selectedAddress, onSelect, onClear, optionsOpen = false, onSearchStart }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState(initialState);
  const activeRequest = useRef(null);
  const requestVersion = useRef(0);
  const inputRef = useRef(null);

  function invalidate() {
    requestVersion.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }

  function dismissResults() {
    invalidate();
    setState(initialState);
  }

  useEffect(() => () => invalidate(), []);

  useEffect(() => {
    if (!optionsOpen) return;
    dismissResults();
  }, [optionsOpen]);

  async function runSearch() {
    const text = query.trim();
    invalidate();
    if (!text) {
      setState({ status: 'invalid', items: [], message: 'Enter an address or postal code to search.' });
      return;
    }

    onSearchStart?.();
    const version = requestVersion.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ status: 'loading', items: [] });

    try {
      const response = await requestJson('/api/v1/map/address-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
        signal: controller.signal,
      });
      if (version !== requestVersion.current) return;
      let items;
      try {
        items = normalizeMapAddressCandidates(response?.items);
      } catch (error) {
        error.code = 'INVALID_ADDRESS_RESULTS';
        throw error;
      }
      setState({ status: items.length ? 'success' : 'empty', items });
    } catch (error) {
      if (version !== requestVersion.current || error?.name === 'AbortError') return;
      setState({ status: 'error', items: [], message: searchErrorMessage(error) });
    } finally {
      if (version === requestVersion.current) activeRequest.current = null;
    }
  }

  function submit(event) {
    event.preventDefault();
    void runSearch();
  }

  function handleKeyDown(event) {
    if (event.key !== 'Escape' || state.status === 'idle') return;
    event.preventDefault();
    event.stopPropagation();
    dismissResults();
    inputRef.current?.focus({ preventScroll: true });
  }

  function choose(item) {
    invalidate();
    onSelect(item);
    setState(initialState);
    inputRef.current?.focus({ preventScroll: true });
  }

  return <div className="map-address-search" onKeyDown={handleKeyDown}>
    <form onSubmit={submit} role="search" aria-label="Find an address on the map" className="map-address-form flex gap-1 rounded-xl border bg-background/95 p-1 shadow-md backdrop-blur">
      <label htmlFor="map-address-input" className="sr-only">Find an address or postal code</label>
      <input
        ref={inputRef}
        id="map-address-input"
        type="search"
        maxLength={160}
        autoComplete="off"
        value={query}
        placeholder="Address or postal code"
        onChange={event => {
          invalidate();
          setQuery(event.target.value);
          setState(initialState);
        }}
        className="h-10 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {query && <button type="button" aria-label="Clear address search input" onClick={() => { invalidate(); setQuery(''); setState(initialState); inputRef.current?.focus(); }} className="grid h-10 w-9 shrink-0 place-items-center rounded-lg hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <X aria-hidden="true" className="size-4" />
      </button>}
      <button type="submit" aria-label="Search map addresses" disabled={state.status === 'loading'} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50">
        <Search aria-hidden="true" className="size-4" />
      </button>
    </form>

    {state.status === 'loading' && <div className="map-address-feedback mt-1 flex items-center justify-between gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm" role="status">
      <span>Searching addresses…</span>
      <button type="button" onClick={dismissResults} className="min-h-8 shrink-0 rounded-md px-2 font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Cancel</button>
    </div>}
    {state.status === 'invalid' && <div className="map-address-feedback mt-1 flex items-center justify-between gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm" role="status">
      <span>{state.message}</span>
      <button type="button" aria-label="Dismiss address search message" onClick={dismissResults} className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X aria-hidden="true" className="size-4" /></button>
    </div>}
    {state.status === 'empty' && <div className="map-address-feedback mt-1 flex items-center justify-between gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm" role="status">
      <span>No addresses found. Try another search.</span>
      <button type="button" aria-label="Dismiss address results" onClick={dismissResults} className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X aria-hidden="true" className="size-4" /></button>
    </div>}
    {state.status === 'error' && <div className="map-address-feedback mt-1 flex items-center justify-between gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm" role="alert">
      <span className="min-w-0 flex-1">{state.message}</span>
      <button type="button" aria-label="Retry address search" onClick={() => void runSearch()} className="min-h-8 shrink-0 rounded-md px-2 font-semibold text-primary hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Retry</button>
      <button type="button" aria-label="Dismiss address search error" onClick={dismissResults} className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X aria-hidden="true" className="size-4" /></button>
    </div>}
    {state.status === 'success' && <div className="map-address-results mt-1 overflow-hidden rounded-xl border bg-background/95 shadow-md">
      <div className="flex min-h-9 items-center justify-between border-b px-3 text-xs font-medium">
        <span>Choose an address</span>
        <button type="button" aria-label="Dismiss address results" onClick={dismissResults} className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><X aria-hidden="true" className="size-4" /></button>
      </div>
      <ul aria-label="Address suggestions" className="max-h-48 overflow-y-auto overscroll-contain">
        {state.items.map((item) => <li key={`${item.address}|${item.latitude}|${item.longitude}`}>
          <button type="button" onClick={() => choose(item)} className="flex min-h-11 w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-secondary focus-visible:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0 break-words">{item.address}</span>
          </button>
        </li>)}
      </ul>
    </div>}

    {selectedAddress && <div className="map-address-selected mt-1 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-md">
      <button type="button" onClick={() => choose(selectedAddress)} className="min-h-10 min-w-0 flex-1 truncate px-2 text-left text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Show ${selectedAddress.address} on map again`}>
        <MapPin aria-hidden="true" className="mr-1 inline size-3.5 text-primary" />{selectedAddress.address}
      </button>
      <button type="button" onClick={onClear} aria-label="Clear selected address" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>}
  </div>;
}
