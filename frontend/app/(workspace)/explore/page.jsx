'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, ChartNoAxesCombined, Copy, Expand, ListFilter, MapPinned, PanelsLeftBottom, Search, SlidersHorizontal, X } from 'lucide-react';
import { HomeCard } from '@/components/home-card';
import { CandidateDetails } from '@/components/candidate-details';
import { ComparisonView } from '@/components/comparison-view';
import { MapPanel } from '@/components/map-panel';
import { SearchFilters } from '@/components/search-filters';
import { SearchPlaceEntry } from '@/components/search-place-entry';
import { ActiveRequirements, EmptyRecovery, SearchWorkbench } from '@/components/search-workbench';
import { SavedDecisionSections } from '@/components/saved-searches';
import { BudgetInput } from '@/components/budget-input';
import { DataStatus } from '@/components/data-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingScene } from '@/components/loading-scene';
import { useWorkspace } from '@/components/workspace-provider';
import { usePlanning } from '@/components/planning-provider';
import { useAuth } from '@/components/auth-provider';
import { requestJson } from '@/lib/api-client';
import { homes as fixtureHomes, defaultBrief } from '@/lib/data';
import { briefValidationError } from '@/lib/planning';
import { readSearchLocation, searchLocation } from '@/lib/search-location';

const MarketExplorer = dynamic(() => import('@/components/market-explorer').then(module => module.MarketExplorer), { loading: () => <LoadingScene label="Opening price history…" /> });

export default function ExplorePage() {
  const workspace = useWorkspace();
  const { brief, homes, homeState, pagination, loadMoreHomes, resourceFeatures, resourceState, viewportBounds, refreshViewport, sourceStatus, query, setQuery, selectedHomes, shortlistHomes, shortlistIds, toggleCompare, applySearch, resetSearch, retryHomes, retryResources, busy, lastSearchSnapshot, savedSearchState, saveSearch, fixtureMode, places = [], workspaceReady } = workspace;
  const appliedBrief = workspace.appliedBrief || brief;
  const { scenarios = [], decisions = {}, photos = {} } = usePlanning();
  const { user } = useAuth();
  const [savedOnly, setSavedOnly] = useState(false);
  const [mobileView, setMobileView] = useState('homes');
  const [layoutMode, setLayoutMode] = useState('split');
  const [mapResultsOpen, setMapResultsOpen] = useState(false);
  const detailRef = useRef(null);
  const deskRef = useRef(null);
  const collectionRef = useRef(null);
  const controlsRef = useRef(null);
  const stageRef = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [stageWidth, setStageWidth] = useState(1000);
  const [resizing, setResizing] = useState(false);
  const detailOpener = useRef(null);
  const [sort, setSort] = useState('recent');
  const [groupBlocks, setGroupBlocks] = useState(true);
  const [removedHome, setRemovedHome] = useState(null);
  const [linkedRecord, setLinkedRecord] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [selectedMapHome, setSelectedMapHome] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draft, setDraft] = useState(appliedBrief);
  const [filterError, setFilterError] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [options, setOptions] = useState({ towns: [], flatTypes: [], status: 'loading' });
  const resultsRef = useRef(null);
  const initialized = useRef(false);
  const previousApplied = useRef(appliedBrief);
  const latest = useRef(null);
  const allKnown = useMemo(() => [...new Map([...homes, ...shortlistHomes, ...selectedHomes, ...(linkedRecord ? [linkedRecord] : [])].map(home => [String(home.id), home])).values()], [homes, shortlistHomes, selectedHomes, linkedRecord]);
  const detail = allKnown.find(home => String(home.id) === detailId);
  const visibleHomes = useMemo(() => {
    const records = [...(savedOnly ? shortlistHomes : homes)];
    if (sort === 'price') records.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (sort === 'fit') records.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else records.sort((a, b) => String(b.observedOn || '').localeCompare(String(a.observedOn || '')) || String(a.id).localeCompare(String(b.id)));
    return records;
  }, [savedOnly, shortlistHomes, homes, sort]);
  const recordGroups = useMemo(() => {
    if (!groupBlocks || savedOnly) return visibleHomes.map(home => ({ home, count: 1, records: [home] }));
    const groups = new Map();
    for (const home of visibleHomes) {
      const key = `${home.town}|${home.address}|${home.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(home);
    }
    const grouped = [...groups.values()].map(records => ({ records, count: records.length, home: [...records].sort((a, b) => String(b.observedOn || '').localeCompare(String(a.observedOn || '')))[0] }));
    return grouped.sort((a, b) => sort === 'price' ? (a.home.price ?? Infinity) - (b.home.price ?? Infinity) : sort === 'fit' ? (b.home.score ?? -1) - (a.home.score ?? -1) : String(b.home.observedOn || '').localeCompare(String(a.home.observedOn || '')));
  }, [visibleHomes, groupBlocks, savedOnly, sort]);
  const navigationHomes = recordGroups.map(group => group.home);
  const detailIndex = navigationHomes.findIndex(home => String(home.id) === detailId);
  const mapHomes = selectedMapHome && !navigationHomes.some(home => home.id === selectedMapHome.id) ? [...navigationHomes, selectedMapHome] : navigationHomes;
  useEffect(() => {
    if (detail && detail.id !== selectedMapHome?.id) setSelectedMapHome(detail);
  }, [detail?.id]);
  useEffect(() => {
    detailRef.current?.querySelector('.explore-detail-scroll')?.scrollTo?.({ top: 0 });
  }, [detailId]);
  useEffect(() => {
    if (!detailId) return;
    detailRef.current?.focus({ preventScroll: true });
    const onKey = event => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [Boolean(detailId)]);
  useEffect(() => {
    const update = () => {
      if (!deskRef.current || !collectionRef.current || !stageRef.current) return;
      if (controlsRef.current) deskRef.current.style.setProperty('--map-controls-bottom', `${controlsRef.current.getBoundingClientRect().bottom - deskRef.current.getBoundingClientRect().top}px`);
      deskRef.current.style.setProperty('--map-results-top', `${collectionRef.current.getBoundingClientRect().bottom - deskRef.current.getBoundingClientRect().top + 8}px`);
      const width = stageRef.current.clientWidth;
      setStageWidth(width);
      if (width >= 768) setSidebarWidth(current => Math.max(280, Math.min(width - 280, current)));
    };
    if (typeof ResizeObserver === 'undefined') { update(); return; }
    const observer = new ResizeObserver(update);
    for (const node of [deskRef.current, collectionRef.current, controlsRef.current]) if (node) observer.observe(node);
    update();
    return () => observer.disconnect();
  }, [layoutMode]);
  function resizeSidebar(width) { setSidebarWidth(Math.round(Math.max(280, Math.min(stageWidth - 280, width)))); }
  function moveDivider(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !stageRef.current) return;
    resizeSidebar(stageRef.current.getBoundingClientRect().right - event.clientX);
  }
  latest.current = { appliedBrief, savedOnly, mobileView, detailId, applySearch };

  function updateLocation(nextBrief = appliedBrief, patch = {}, replace = false) {
    if (typeof window === 'undefined') return;
    const next = { saved: savedOnly, view: mobileView, detailId, layout: layoutMode, bounds: workspace.appliedBounds, ...patch };
    const location = searchLocation(nextBrief, next);
    if (window.location.pathname + window.location.search !== location) window.history[replace ? 'replaceState' : 'pushState']({}, '', location);
  }
  useEffect(() => {
    if (workspaceReady === false) return;
    if (!initialized.current) {
      initialized.current = true;
      const location = readSearchLocation(window.location.search, defaultBrief);
      setSavedOnly(location.saved); setMobileView(location.view); setDetailId(location.detailId); setLayoutMode(location.layout);
      if (location.hasFilters) applySearch('', location.brief, { bounds: location.bounds, interpret: false });
    }
    function restore() {
      const next = readSearchLocation(window.location.search, defaultBrief);
      setSavedOnly(next.saved); setMobileView(next.view); setDetailId(next.detailId); setLayoutMode(next.layout);
      latest.current.applySearch('', next.brief, { bounds: next.bounds, interpret: false });
    }
    window.addEventListener('popstate', restore);
    function externalView() {
      const next = readSearchLocation(window.location.search, defaultBrief);
      setSavedOnly(next.saved); setMobileView(next.view);
    }
    window.addEventListener('homecompass:view-change', externalView);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('homecompass:view-change', externalView); };
  }, [workspaceReady]);
  useEffect(() => {
    if (!detailId || detail || workspaceReady === false) return;
    let active = true;
    requestJson(`/api/v1/homes/${encodeURIComponent(detailId)}`).then(payload => { if (active) setLinkedRecord(payload.item || payload); }).catch(() => {});
    return () => { active = false; };
  }, [detailId, Boolean(detail), workspaceReady]);
  useEffect(() => {
    let active = true;
    if (fixtureMode) { setOptions({ towns: [...new Set(fixtureHomes.map(home => home.town))], flatTypes: [...new Set(fixtureHomes.map(home => home.type))], status: 'ready' }); return; }
    requestJson('/api/v1/search/options').then(payload => { if (active) setOptions({ towns: payload.towns || [], flatTypes: payload.flatTypes || [], status: 'ready' }); }).catch(() => { if (active) setOptions({ towns: [], flatTypes: [], status: 'error' }); });
    return () => { active = false; };
  }, [fixtureMode]);
  useEffect(() => {
    if (detailId || !selectedMapHome || !resultsRef.current) return;
    const card = [...resultsRef.current.querySelectorAll('[data-home-id]')].find(node => node.dataset.homeId === String(selectedMapHome.id));
    if (card && mobileView === 'homes') card.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [selectedMapHome, mobileView, detailId]);

  async function runSearch(nextQuery = query, nextBrief = appliedBrief, searchOptions = {}) {
    const error = briefValidationError(nextBrief);
    if (error) { setFilterError(error); return null; }
    setFeedback(''); setFilterError('');
    const result = await applySearch(nextQuery, nextBrief, searchOptions);
    if (result != null) { setDetailId(''); updateLocation(nextBrief, { detailId: '', bounds: searchOptions.bounds || null }); }
    return result;
  }
  useEffect(() => {
    if (previousApplied.current === appliedBrief) return;
    previousApplied.current = appliedBrief;
    if (!initialized.current || workspaceReady === false) return;
    const location = readSearchLocation(window.location.search, defaultBrief);
    const target = searchLocation(appliedBrief, { saved: location.saved, view: location.view, detailId: location.detailId, layout: location.layout, bounds: workspace.appliedBounds });
    window.history.replaceState({}, '', target);
  }, [appliedBrief, workspace.appliedBounds]);
  function openFilters() { setDraft(structuredClone(appliedBrief)); setFilterError(''); setFiltersOpen(true); }
  async function applyDraft() { const result = await runSearch(query, draft, { interpret: false }); if (result != null) { setFiltersOpen(false); setBudgetOpen(false); } }
  function inspect(home) { if (!home) return; if (!detailId) detailOpener.current = document.activeElement; setSelectedMapHome(home); setDetailId(String(home.id)); updateLocation(appliedBrief, { detailId: String(home.id) }); }
  function closeDetail() { setDetailId(''); updateLocation(appliedBrief, { detailId: '' }); requestAnimationFrame(() => { if (detailOpener.current?.isConnected) detailOpener.current.focus({ preventScroll: true }); }); }
  function changeView(nextSaved) { setSavedOnly(nextSaved); updateLocation(appliedBrief, { saved: nextSaved }); window.dispatchEvent(new Event('homecompass:view-change')); }
  function changeMapView(next) { setMobileView(next); updateLocation(appliedBrief, { view: next }); }
  function changeLayout() { const next = layoutMode === 'split' ? 'map' : 'split'; setLayoutMode(next); setMobileView('map'); updateLocation(appliedBrief, { layout: next, view: 'map' }); }
  function locate(home) { setSelectedMapHome(home); setMobileView('map'); setDetailId(''); updateLocation(appliedBrief, { view: 'map', detailId: '' }); }
  function selectFromMap(home) { setSelectedMapHome(home); inspect(home); }
  async function save(home) {
    const alreadySaved = shortlistIds.includes(home.id);
    const success = workspace.ensureSaved ? await workspace.ensureSaved(home, !alreadySaved) : await workspace.toggleShortlist(home);
    if (alreadySaved && success !== false) { setRemovedHome(home); setFeedback(`${home.address} removed from Saved.`); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(searchLocation(appliedBrief, { saved: false, view: mobileView, layout: layoutMode, bounds: workspace.appliedBounds }), window.location.origin).href); setFeedback('Search link copied. Personal places, notes and your free-text query are excluded.'); }
    catch { setFeedback('The search filters are in your browser address. Copy it to share; personal places and notes are excluded.'); }
  }
  async function submitSavedSearch(event) {
    event.preventDefault(); setSavingSearch(true);
    try { const saved = await saveSearch(saveName); if (saved) { setSaveName(''); setFeedback('Evidence search saved to your account.'); } }
    finally { setSavingSearch(false); }
  }
  async function reset() { const result = await resetSearch(); if (result != null) { setDetailId(''); updateLocation(defaultBrief, { detailId: '', bounds: null }); } }
  const canSaveSearch = Boolean(lastSearchSnapshot?.metadata?.dataMode === 'live' && lastSearchSnapshot?.metadata?.scorePolicyVersion && !busy && savedSearchState?.status !== 'signed_out');
  const empty = homeState?.status === 'error' ? 'Housing evidence unavailable' : busy || homeState?.status === 'idle' ? 'Loading transaction records…' : savedOnly ? 'No saved places yet' : 'No records match this search';

  return <div ref={deskRef} className={`explore-desk workspace-canvas ${layoutMode === 'map' ? 'explore-desk--map' : ''}`}>
    <header className="explore-heading"><div className="flex min-w-0 items-center gap-2"><span className="explore-brand"><MapPinned aria-hidden="true" className="size-5" /></span><div><h1 className="font-display text-lg font-semibold tracking-tight">Find an HDB area that fits.</h1><p className="text-xs text-muted-foreground">Historical resale evidence, not live listings.</p></div></div><div className="flex shrink-0 items-center gap-1"><Button variant="ghost" aria-label="Price history" onClick={() => setMarketOpen(true)}><ChartNoAxesCombined aria-hidden="true" className="size-4" /><span className="hidden xl:inline">Price history</span></Button><Button variant="ghost" aria-label="Search presets" onClick={() => setToolsOpen(true)}><ListFilter aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Search presets</span><span className="sr-only sm:hidden">Search presets</span></Button><Button aria-label={layoutMode === 'map' ? 'Split view' : 'Full map'} variant={layoutMode === 'map' ? 'soft' : 'outline'} aria-pressed={layoutMode === 'map'} onClick={changeLayout}>{layoutMode === 'map' ? <PanelsLeftBottom aria-hidden="true" className="size-4" /> : <Expand aria-hidden="true" className="size-4" />}<span className="hidden sm:inline">{layoutMode === 'map' ? 'Split view' : 'Full map'}</span><span className="sr-only sm:hidden">{layoutMode === 'map' ? 'Split view' : 'Full map'}</span></Button></div></header>
    <div ref={controlsRef} className="explore-controls search-command-bar">
      <form className="explore-search-row" role="search" onSubmit={event => { event.preventDefault(); runSearch(); }}><div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><label htmlFor="home-search" className="sr-only">Search a town, street or amenity</label><Input id="home-search" name="query" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} className="h-11 pl-9 pr-12" placeholder="Town, street or amenity" />{query && <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 size-11" aria-label="Clear search and show all matching records" onClick={() => { setQuery(''); runSearch('', appliedBrief); document.getElementById('home-search')?.focus(); }}><X className="size-4" /></Button>}</div><Button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button><Button type="button" variant="outline" onClick={openFilters}><SlidersHorizontal aria-hidden="true" className="size-4" /><span>Filters</span></Button></form>
      <div className="explore-quick-filters"><Button variant="ghost" onClick={() => { setDraft(structuredClone(appliedBrief)); setFilterError(''); setBudgetOpen(true); }}>{appliedBrief.budget != null ? 'Edit price ceiling' : 'Set price ceiling'}</Button><Button variant="ghost" onClick={openFilters}>{appliedBrief.preferredTowns?.length ? `${appliedBrief.preferredTowns.length} towns` : 'All towns'}</Button><Button variant="ghost" onClick={openFilters}>{appliedBrief.preferredFlatType || 'Any flat type'}</Button><Button size="icon" variant="ghost" aria-label="Share filters" onClick={copyLink}><Copy aria-hidden="true" className="size-4" /></Button><Button variant="ghost" disabled={busy} onClick={reset}>Reset search</Button></div>
      <div className="explore-applied">{workspace.appliedBounds && <Button variant="outline" onClick={() => runSearch(workspace.appliedQuery ?? query, appliedBrief, { interpret: false })}>Map area applied · Remove area <X aria-hidden="true" className="size-3" /></Button>}<ActiveRequirements brief={appliedBrief} places={places} disabled={busy} onApply={next => runSearch(query, next, { interpret: false })} /></div>
    </div>
    {feedback && <div role="status" className="mt-3 flex items-start justify-between gap-3 rounded-xl border bg-secondary px-4 py-3 text-sm"><span>{feedback}</span>{removedHome && <Button variant="outline" onClick={async () => { await workspace.ensureSaved(removedHome, true); setRemovedHome(null); setFeedback('Place restored to Saved.'); }}>Undo</Button>}<Button size="icon" variant="ghost" aria-label="Dismiss search message" onClick={() => setFeedback('')}><X className="size-4" /></Button></div>}
    {(homeState?.status !== 'success' || homeState?.dataMode === 'fixture') && <DataStatus state={homeState} hasData={homes.length > 0} onRetry={retryHomes} retryLabel="Retry home data" compact className="mt-3" />}
    <div ref={collectionRef} className="explore-collection-bar"><div className="flex items-center gap-1" role="group" aria-label="Record collection"><Button variant={!savedOnly ? 'soft' : 'ghost'} aria-pressed={!savedOnly} onClick={() => changeView(false)}>All results</Button><Button variant={savedOnly ? 'soft' : 'ghost'} aria-pressed={savedOnly} onClick={() => changeView(true)}><Bookmark aria-hidden="true" className="size-4" />Saved ({shortlistIds.length})</Button></div><div className="flex items-center gap-2"><details className="explore-sort"><summary>Sort and group</summary><div className="explore-sort-menu"><label className="grid gap-2 text-sm">Sort loaded records<select className="h-11 rounded-lg border bg-background px-2" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Most recent</option><option value="price">Recorded price</option><option value="fit">Fit score</option></select></label>{!savedOnly && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={groupBlocks} onChange={event => setGroupBlocks(event.target.checked)} />Group repeated block records</label>}</div></details><div className="explore-mobile-toggle" role="group" aria-label="Explore view"><Button variant={mobileView === 'homes' ? 'soft' : 'ghost'} aria-pressed={mobileView === 'homes'} onClick={() => changeMapView('homes')}>List</Button><Button variant={mobileView === 'map' ? 'soft' : 'ghost'} aria-pressed={mobileView === 'map'} onClick={() => changeMapView('map')}>Map</Button></div>{layoutMode === 'map' && <Button variant={mapResultsOpen ? 'soft' : 'outline'} aria-pressed={mapResultsOpen} onClick={() => setMapResultsOpen(current => !current)}>Results</Button>}</div></div>
    <div ref={stageRef} style={{ '--sidebar-width': `${sidebarWidth}px` }} className={`explore-stage ${resizing ? 'explore-stage--resizing' : ''} ${detailId ? 'explore-stage--detail' : ''} ${mobileView === 'map' ? 'explore-stage--mobile-map' : ''} ${mapResultsOpen ? 'explore-stage--results-open' : ''}`}>
      <div className="explore-map"><MapPanel homes={mapHomes} resources={resourceFeatures} resourceState={resourceState} retryResources={retryResources} sourceStatus={sourceStatus} hoveredHome={workspace.hoveredHome} selectedHome={selectedMapHome} onSelect={selectFromMap} refreshViewport={refreshViewport} viewportBounds={viewportBounds} onSearchArea={savedOnly ? undefined : () => runSearch(workspace.appliedQuery ?? query, appliedBrief, { bounds: viewportBounds, interpret: false })} searchBusy={busy} className="explore-map-panel" /></div>
      {layoutMode === 'split' && <div className="explore-divider" role="separator" tabIndex={0} aria-label="Resize map and sidebar" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={Math.max(280, stageWidth - 280)} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} pixels sidebar width`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={moveDivider} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onLostPointerCapture={() => setResizing(false)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeSidebar(sidebarWidth + (event.key === 'ArrowLeft' ? 24 : -24)); } else if (event.key === 'Home') { event.preventDefault(); resizeSidebar(420); } }}><span /></div>}
      <section className="explore-results" aria-label="Historical transaction results"><div className="explore-results-heading"><h2 className="text-sm font-semibold">{savedOnly ? `${visibleHomes.length} saved records` : `${homes.length.toLocaleString()} / ${(pagination?.total ?? homes.length).toLocaleString()} records loaded`}</h2><span className="text-xs text-muted-foreground">{groupBlocks && !savedOnly ? `${recordGroups.length} groups` : 'No live listings'}</span></div><div ref={resultsRef} className="explore-results-scroll" aria-busy={busy}>
        {recordGroups.map(({ home, count }) => <div key={home.id} className="space-y-2">{count > 1 && <p className="px-2 text-xs text-muted-foreground">{count} loaded sales at this block / flat type · latest dated observation shown</p>}<HomeCard variant="browse" home={home} saved={shortlistIds.includes(home.id)} selected={selectedHomes.some(item => item.id === home.id)} mapActive={selectedMapHome?.id === home.id} onLocate={locate} onSave={save} onCompare={toggleCompare} onInspect={inspect} /></div>)}
        {!visibleHomes.length && <div className="grid min-h-64 content-center rounded-xl border border-dashed p-5 text-center"><h3 className="text-lg font-semibold">{empty}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{savedOnly ? 'Save a location from All results to keep its evidence here.' : homeState?.status === 'error' ? 'Your search is retained. Retry the same request to continue.' : 'Try fewer requirements or a wider area.'}</p>{savedOnly ? <Button variant="outline" className="mx-auto mt-4" onClick={() => changeView(false)}>Browse all results</Button> : <Button variant="outline" className="mx-auto mt-4" onClick={homeState?.status === 'error' ? retryHomes : reset}> {homeState?.status === 'error' ? 'Retry search' : 'Reset search'}</Button>}</div>}
    {!savedOnly && !visibleHomes.length && !busy && ['empty', 'success'].includes(homeState?.status) && <div className="mt-4"><EmptyRecovery brief={appliedBrief} lastSearchSnapshot={lastSearchSnapshot} applySearch={runSearch} fixtureMode={fixtureMode} /></div>}
        {!savedOnly && pagination?.hasMore && <Button variant="outline" className="w-full" disabled={busy} onClick={loadMoreHomes}>{busy ? 'Loading…' : 'Load more transactions'}</Button>}
      </div></section>
      {detailId && <aside ref={detailRef} tabIndex={-1} className="explore-detail" aria-labelledby="record-detail-title"><header className="explore-detail-heading"><div className="min-w-0"><p className="text-xs text-muted-foreground">Record details</p><h2 id="record-detail-title" aria-live="polite" className="mt-1 break-words font-display text-lg font-semibold">{detail?.address || 'Transaction record'}</h2></div><Button size="icon" variant="ghost" aria-label="Close record details" onClick={closeDetail}><X aria-hidden="true" className="size-4" /></Button></header><div className="explore-detail-scroll">{detail ? <CandidateDetails home={detail} homes={allKnown} brief={appliedBrief} saved={shortlistIds.includes(detail.id)} selected={selectedHomes.some(item => item.id === detail.id)} onSave={home => workspace.ensureSaved ? workspace.ensureSaved(home, true) : !shortlistIds.includes(home.id) && workspace.toggleShortlist(home)} onCompare={toggleCompare} onLocate={locate} /> : <p className="text-sm text-muted-foreground">This record is not in the loaded results. Restore its search, check Saved, or load more records.</p>}</div><footer className="explore-detail-footer"><Button variant="ghost" onClick={closeDetail}><ArrowLeft aria-hidden="true" className="size-4" />Results</Button><div className="flex items-center gap-1"><span className="mr-2 text-xs text-muted-foreground" aria-live="polite">{detailIndex >= 0 ? `${detailIndex + 1} / ${navigationHomes.length}` : 'Linked record'}</span><Button variant="outline" size="icon" aria-label="Previous record" disabled={detailIndex <= 0} onClick={() => inspect(navigationHomes[detailIndex - 1])}><ArrowLeft aria-hidden="true" className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Next record" disabled={detailIndex < 0 || detailIndex >= navigationHomes.length - 1} onClick={() => inspect(navigationHomes[detailIndex + 1])}><ArrowRight aria-hidden="true" className="size-4" /></Button></div></footer></aside>}
    </div>

    {selectedHomes.length > 0 && <aside className="comparison-tray fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border bg-popover p-3 shadow-xl sm:inset-x-6" aria-label="Comparison selection"><div className="min-w-0"><p className="text-sm font-semibold">{selectedHomes.length} selected <span className="font-normal text-muted-foreground">· up to 3</span></p><div className="mt-1 flex flex-wrap gap-1">{selectedHomes.map(home => <button key={home.id} className="flex min-h-11 max-w-48 items-center gap-2 rounded-lg px-2 text-xs hover:bg-secondary" onClick={() => toggleCompare(home)} aria-label={`Remove ${home.address} from comparison`}><span className="truncate">{home.address}</span><X aria-hidden="true" className="size-3 shrink-0" /></button>)}</div></div><Button disabled={selectedHomes.length < 2} onClick={() => setCompareOpen(true)}>{selectedHomes.length < 2 ? 'Select one more' : `Compare ${selectedHomes.length}`}<ArrowRight aria-hidden="true" className="size-4" /></Button></aside>}
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b p-5 pr-16"><DialogTitle>Filters</DialogTitle><DialogDescription>Edit your criteria. Changes apply only when you choose Apply filters.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"><SearchFilters brief={draft} setBrief={setDraft} options={options} places={places} onAddPlace={() => { setFiltersOpen(false); setPlaceOpen(true); }} />{filterError && <Alert role="alert" tone="warning" className="mt-4">{filterError}</Alert>}</div><DialogFooter className="shrink-0 border-t p-4"><Button variant="outline" onClick={() => setFiltersOpen(false)}>Cancel</Button><Button disabled={busy} onClick={applyDraft}>Apply filters</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}><DialogContent><DialogHeader><DialogTitle>Price ceiling</DialogTitle><DialogDescription>Compare recorded prices within your chosen ceiling.</DialogDescription></DialogHeader><BudgetInput value={draft.budget} onChange={value => setDraft(current => ({ ...current, budget: value, requirements: { ...current.requirements, budget: value != null } }))} />{filterError && <Alert role="alert" tone="warning">{filterError}</Alert>}<DialogFooter><Button variant="outline" onClick={() => setBudgetOpen(false)}>Cancel</Button><Button disabled={busy} onClick={applyDraft}>Apply price ceiling</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={placeOpen} onOpenChange={setPlaceOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Add a household place</DialogTitle><DialogDescription>Choose an address or mark a temporary location.</DialogDescription></DialogHeader><SearchPlaceEntry onCancel={() => { setPlaceOpen(false); setFiltersOpen(true); }} onAdded={place => { setDraft(current => ({ ...current, placeConstraints: [...(current.placeConstraints || []).filter(item => item.placeId !== place.id), { placeId: place.id, maxDistanceM: place.maximumDistanceM || 5000 }] })); setPlaceOpen(false); setFiltersOpen(true); }} /></DialogContent></Dialog>
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden p-0"><DialogHeader className="shrink-0 border-b p-5 pr-16"><DialogTitle>Compare your selected places</DialogTitle><DialogDescription>Closing comparison returns to your search.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"><ComparisonView homes={selectedHomes} onRemove={toggleCompare} availableHomes={shortlistHomes.filter(home => !selectedHomes.some(selected => selected.id === home.id))} onAdd={toggleCompare} brief={appliedBrief} decisions={decisions} photos={photos} /></div><DialogFooter className="border-t p-3"><Button onClick={() => setCompareOpen(false)}>Back to search</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Search presets and history</DialogTitle><DialogDescription>Reuse criteria without leaving your research workspace.</DialogDescription></DialogHeader><SearchWorkbench brief={appliedBrief} applySearch={async (...args) => { const result = await runSearch(...args); if (result != null) setToolsOpen(false); }} /><section className="border-t pt-4"><h3 className="text-sm font-semibold">Save this search with its evidence</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Account searches retain source dates and score policy so you can see what changed on a later run.</p>{user && !canSaveSearch && <p role="status" className="mt-2 text-xs text-muted-foreground">Run a source search first to save its evidence and scoring policy.</p>}{user ? <form className="mt-3 flex gap-2" onSubmit={submitSavedSearch}><Input aria-label="Saved evidence search name" maxLength={80} value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Name this evidence search" /><Button disabled={!canSaveSearch || savingSearch || !saveName.trim()}>{savingSearch ? 'Saving…' : 'Save evidence search'}</Button></form> : <Link href="/login" className="mt-2 block min-h-11 content-center text-sm text-primary underline">Sign in to retain evidence searches across devices</Link>}</section><SavedDecisionSections onEdit={edited => { setDraft(structuredClone(edited)); setToolsOpen(false); setFiltersOpen(true); }} onApplied={() => setToolsOpen(false)} /></DialogContent></Dialog>
    <Dialog open={marketOpen} onOpenChange={setMarketOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Neighbourhood price history</DialogTitle><DialogDescription>Dated resale transactions; not a valuation.</DialogDescription></DialogHeader><MarketExplorer towns={options.towns} flatTypes={options.flatTypes} initialTown={selectedMapHome?.town || appliedBrief.preferredTowns?.[0] || ''} initialFlatType={selectedMapHome?.type || appliedBrief.preferredFlatType || ''} /></DialogContent></Dialog>
  </div>;
}
