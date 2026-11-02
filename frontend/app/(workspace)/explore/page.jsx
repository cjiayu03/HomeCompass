'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, ChartNoAxesCombined, ChevronDown, Copy, Ellipsis, Expand, ListFilter, MapPinned, PanelsLeftBottom, Search, SlidersHorizontal, X } from 'lucide-react';
import { MapResearchSidebar } from '@/components/map-research-sidebar';
import { HomeCard } from '@/components/home-card';
import { CandidateDetails } from '@/components/candidate-details';
import { ComparisonAction } from '@/components/comparison-action';
import { ComparisonWorkspace } from '@/components/comparison-workspace';
import { setAssistantOpen } from '@/lib/assistant-state';
import { MapPanel } from '@/components/map-panel';
import { HousingChat } from '@/components/housing-chat';
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
import { nearbyFacilityTypes } from '@/lib/map-layers';

const WorkspaceMap = memo(MapPanel);
function useStableEvent(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args) => handlerRef.current(...args), []);
}
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
  const [mapResultsOpen, setMapResultsOpen] = useState(true);
  const detailRef = useRef(null);
  const stageRef = useRef(null);
  const [mapControlsTarget, setMapControlsTarget] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const [stageWidth, setStageWidth] = useState(1000);
  const [resizing, setResizing] = useState(false);
  const detailOpener = useRef(null);
  const previousDetailId = useRef('');
  const [sort, setSort] = useState('fit');
  const groupBlocks = workspace.appliedDistinctBlocks !== false;
  const [linkedRecord, setLinkedRecord] = useState(null);
  const [detailId, setDetailId] = useState('');
  const [selectedMapHome, setSelectedMapHome] = useState(null);
  const [visibleResourceTypes, setVisibleResourceTypes] = useState(() => workspace.mapResourceTypes || ['silver_zone']);
  const [facilityFocus, setFacilityFocus] = useState(null);
  const [mapCameraIntent, setMapCameraIntent] = useState({ type: 'initial', request: 0 });
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
  const [options, setOptions] = useState({ towns: [], flatTypes: [], status: 'loading' });
  const resultsRef = useRef(null);
  const initialized = useRef(false);
  const previousApplied = useRef(appliedBrief);
  const latest = useRef(null);
  const allKnown = useMemo(() => [...new Map([...homes, ...shortlistHomes, ...selectedHomes, ...(linkedRecord ? [linkedRecord] : [])].map(home => [String(home.id), home])).values()], [homes, shortlistHomes, selectedHomes, linkedRecord]);
  const detail = allKnown.find(home => String(home.id) === detailId);
  const visibleHomes = useMemo(() => {
    const records = [...(savedOnly ? shortlistHomes : homes)];
    if (sort === 'fit' && !savedOnly && !fixtureMode) return records;
    if (sort === 'price') records.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (sort === 'fit') records.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else records.sort((a, b) => String(b.observedOn || '').localeCompare(String(a.observedOn || '')) || String(a.id).localeCompare(String(b.id)));
    return records;
  }, [savedOnly, shortlistHomes, homes, sort, fixtureMode]);
  const recordGroups = useMemo(() => {
    if (!groupBlocks || savedOnly) return visibleHomes.map(home => ({ home, count: 1, records: [home] }));
    const groups = new Map();
    for (const home of visibleHomes) {
      const key = `${home.town}|${home.address}|${home.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(home);
    }
    const grouped = [...groups.values()].map(records => ({ records, count: records.length, home: [...records].sort((a, b) => String(b.observedOn || '').localeCompare(String(a.observedOn || '')))[0] }));
    if (sort === 'fit' && !fixtureMode) return grouped;
    return grouped.sort((a, b) => sort === 'price' ? (a.home.price ?? Infinity) - (b.home.price ?? Infinity) : sort === 'fit' ? (b.home.score ?? -1) - (a.home.score ?? -1) : String(b.home.observedOn || '').localeCompare(String(a.home.observedOn || '')));
  }, [visibleHomes, groupBlocks, savedOnly, sort, fixtureMode]);
  const navigationHomes = useMemo(() => recordGroups.map(group => group.home), [recordGroups]);
  const detailIndex = navigationHomes.findIndex(home => String(home.id) === detailId);
  const mapHomes = useMemo(() => selectedMapHome && !navigationHomes.some(home => home.id === selectedMapHome.id) ? [...navigationHomes, selectedMapHome] : navigationHomes, [navigationHomes, selectedMapHome]);
  useEffect(() => {
    if (detail && detail.id !== selectedMapHome?.id) setSelectedMapHome(detail);
  }, [detail?.id]);
  useEffect(() => {
    detailRef.current?.querySelector('.explore-detail-scroll')?.scrollTo?.({ top: 0 });
  }, [detailId]);
  useEffect(() => {
    const previous = previousDetailId.current;
    previousDetailId.current = detailId;
    if ((!detailId && !previous) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const content = detailId ? detailRef.current?.querySelector('.explore-detail-scroll') : resultsRef.current;
    if (!content?.animate) return;
    const animations = [content.animate([
      { opacity: .35, transform: `translateX(${detailId ? 24 : -16}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 340, easing: 'cubic-bezier(.16,1,.3,1)' })];
    const heading = detailRef.current?.querySelector('.explore-detail-heading');
    if (detailId && heading) animations.push(heading.animate([
      { backgroundColor: 'hsl(var(--primary) / .22)' },
      { backgroundColor: 'hsl(var(--accent) / .35)' },
    ], { duration: 1300, easing: 'ease-out' }));
    return () => animations.forEach(animation => animation.cancel());
  }, [detailId]);
  useEffect(() => {
    if (!detailId) return;
    detailRef.current?.focus({ preventScroll: true });
    const onKey = event => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]') && !document.querySelector('.housing-chat:not(.housing-chat--embedded)')) closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [Boolean(detailId)]);
  const resizeFrame = useRef(null);
  const pendingWidth = useRef(500);
  useEffect(() => {
    const update = () => {
      const width = stageRef.current?.clientWidth || 1000;
      setStageWidth(width);
      if (window.innerWidth >= 768) setSidebarWidth(current => Math.max(280, Math.min(width - 280, current)));
    };
    update();
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('resize', update); cancelAnimationFrame(resizeFrame.current); };
  }, []);
  function resizeSidebar(width) { setSidebarWidth(Math.round(Math.max(280, Math.min(stageWidth - 280, width)))); }
  function moveDivider(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !stageRef.current) return;
    pendingWidth.current = stageRef.current.getBoundingClientRect().right - event.clientX;
    if (resizeFrame.current != null) return;
    resizeFrame.current = requestAnimationFrame(() => { resizeFrame.current = null; resizeSidebar(pendingWidth.current); });
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
    setFilterError('');
    const result = await applySearch(nextQuery, nextBrief, { distinctBlocks: groupBlocks, ...searchOptions });
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
  function recordMapCameraIntent(type) { setMapCameraIntent(current => ({ type, request: current.request + 1 })); }
  function updateVisibleResourceTypes(types) {
    const next = [...new Set(types)];
    setVisibleResourceTypes(next);
    if (facilityFocus && !next.includes(facilityFocus.feature?.properties?.resourceType)) setFacilityFocus(null);
    workspace.setMapResourceTypes?.(next);
  }
  function toggleNearbyLayer(type, enabled) {
    updateVisibleResourceTypes(enabled
      ? [...visibleResourceTypes, type]
      : visibleResourceTypes.filter(item => item !== type));
  }
  function enableNearbyLayers() {
    const hasCounts = Array.isArray(resourceState?.counts) && resourceState.counts.length > 0;
    const availableTypes = hasCounts
      ? nearbyFacilityTypes.filter(type => {
        const count = resourceState.counts.find(item => item.resourceType === type);
        return count && count.total > (count.unlocated || 0);
      })
      : nearbyFacilityTypes;
    updateVisibleResourceTypes([...visibleResourceTypes, ...availableTypes]);
  }
  function focusFacilityOnMap(feature) {
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return;
    setFacilityFocus(current => ({ feature, request: (current?.request || 0) + 1 }));
  }
  function focusDetailHome(home) {
    if (!home) return;
    setMapResultsOpen(true);
    setSelectedMapHome(home);
    setFacilityFocus(null);
    recordMapCameraIntent('home');
    setMobileView('map');
    updateLocation(appliedBrief, { view: 'map', detailId: String(home.id) });
  }
  function inspect(home) { if (!home) return; setMapResultsOpen(true); if (!detailId) detailOpener.current = document.activeElement; setCompareOpen(false); setSelectedMapHome(home); setFacilityFocus(null); recordMapCameraIntent('home'); setDetailId(String(home.id)); updateLocation(appliedBrief, { detailId: String(home.id) }); }
  function closeDetail() { setMapResultsOpen(true); setDetailId(''); updateLocation(appliedBrief, { detailId: '' }); requestAnimationFrame(() => { if (detailOpener.current?.isConnected) detailOpener.current.focus({ preventScroll: true }); }); }
  function changeView(nextSaved) { setSavedOnly(nextSaved); updateLocation(appliedBrief, { saved: nextSaved }); window.dispatchEvent(new Event('homecompass:view-change')); }
  function changeMapView(next) { setMobileView(next); updateLocation(appliedBrief, { view: next }); }
  function changeLayout() { const next = layoutMode === 'split' ? 'map' : 'split'; setLayoutMode(next); setMapResultsOpen(true); setMobileView('map'); updateLocation(appliedBrief, { layout: next, view: 'map' }); }
  function locate(home) { setSelectedMapHome(home); setFacilityFocus(null); recordMapCameraIntent('home'); setMobileView('map'); setDetailId(''); updateLocation(appliedBrief, { view: 'map', detailId: '' }); }
  function selectFromMap(home) { inspect(home); }
  function revealAddressOnMap() {
    const sidebar = document.querySelector('.map-research-sidebar[data-state="open"]');
    const details = document.querySelector('.map-record-details');
    if (!sidebar || !details) return;
    const remainingMapWidth = window.innerWidth - sidebar.getBoundingClientRect().width - details.getBoundingClientRect().width;
    if (remainingMapWidth < 300) setMapResultsOpen(false);
  }
  async function save(home) {
    const alreadySaved = shortlistIds.includes(home.id);
    const success = workspace.ensureSaved ? await workspace.ensureSaved(home, !alreadySaved) : await workspace.toggleShortlist(home);
    if (alreadySaved && success !== false) workspace.flash(`${home.address} removed from Saved.`, 'info', { label: 'Undo', onClick: async () => { const restored = await workspace.ensureSaved(home, true); if (restored !== false) workspace.flash('Place restored to Saved.', 'success'); } });
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(searchLocation(appliedBrief, { saved: false, view: mobileView, layout: layoutMode, bounds: workspace.appliedBounds }), window.location.origin).href); workspace.flash('Search link copied. Personal places, notes and your free-text query are excluded.'); }
    catch { workspace.flash('The search filters are in your browser address. Copy it to share; personal places and notes are excluded.'); }
  }
  async function submitSavedSearch(event) {
    event.preventDefault(); setSavingSearch(true);
    try { const saved = await saveSearch(saveName); if (saved) { setSaveName(''); workspace.flash('Evidence search saved to your account.'); } }
    finally { setSavingSearch(false); }
  }
  async function reset() { const result = await resetSearch(); if (result != null) { setDetailId(''); updateLocation(defaultBrief, { detailId: '', bounds: null }); } }
  const canSaveSearch = Boolean(lastSearchSnapshot?.metadata?.dataMode === 'live' && lastSearchSnapshot?.metadata?.scorePolicyVersion && !busy && savedSearchState?.status !== 'signed_out');
  const empty = homeState?.status === 'error' ? 'Housing evidence unavailable' : busy || homeState?.status === 'idle' ? 'Loading transaction records…' : savedOnly ? 'No saved places yet' : 'No records match this search';

  const onInspectRecord = useStableEvent(inspect);
  const onLocateRecord = useStableEvent(locate);
  const onMapCameraIntent = useStableEvent(recordMapCameraIntent);
  const onSaveRecord = useStableEvent(save);
  const onCompareRecord = useStableEvent(toggleCompare);
  const onMapSelect = useStableEvent(selectFromMap);
  const onSearchMapArea = useStableEvent(() => runSearch(workspace.appliedQuery ?? query, appliedBrief, { bounds: viewportBounds, interpret: false }));
  const collectionControls = (
<div className="explore-collection-bar"><div className="flex items-center gap-1" role="group" aria-label="Record collection"><Button variant={!savedOnly ? 'soft' : 'ghost'} aria-pressed={!savedOnly} onClick={() => changeView(false)} aria-label="All results"><span className="collection-label-wide">All results</span><span className="collection-label-compact">All</span></Button><Button variant={savedOnly ? 'soft' : 'ghost'} aria-pressed={savedOnly} onClick={() => changeView(true)}><Bookmark aria-hidden="true" className="size-4" />Saved ({shortlistIds.length})</Button></div><div className="flex items-center gap-2"><ComparisonAction homes={selectedHomes} onRemove={onCompareRecord} onOpen={() => { setAssistantOpen(true); setCompareOpen(true); }} /><details className="explore-sort"><summary title="Sort and group">Sort</summary><div className="explore-sort-menu"><label className="grid gap-2 text-sm">Sort results<select className="h-11 rounded-lg border bg-background px-2" value={sort} onChange={event => setSort(event.target.value)}><option value="fit">Fit score · all results</option><option value="recent">Most recent loaded</option><option value="price">Recorded price · loaded</option></select></label>{!savedOnly && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={groupBlocks} disabled={busy} onChange={event => { void runSearch(query, appliedBrief, { interpret: false, distinctBlocks: event.target.checked }); }} />One best-fit record per block</label>}</div></details><Button className="explore-results-toggle" variant={mapResultsOpen ? 'soft' : 'outline'} aria-pressed={mapResultsOpen || Boolean(detailId)} onClick={() => { if (detailId) closeDetail(); else setMapResultsOpen(current => !current); }}>Results</Button></div></div>
  );
  const toolbar = <>
    <header className="explore-topbar">
      <Link href="/explore" aria-label="HomeCompass home" className="explore-brand"><span className="explore-logo"><MapPinned aria-hidden="true" className="size-6" /></span><span>HomeCompass</span></Link>
      <h1 className="sr-only">HomeCompass housing explorer</h1>
      <form className="explore-search-row" role="search" onSubmit={event => { event.preventDefault(); runSearch(); }}>
        <div className="explore-query"><Search aria-hidden="true" className="size-4" /><label htmlFor="home-search" className="sr-only">Search a town, street or amenity</label><Input id="home-search" name="query" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Town, street or amenity" />{query && <Button type="button" size="icon" variant="ghost" aria-label="Clear search and show all matching records" onClick={() => { setQuery(''); runSearch('', appliedBrief); document.getElementById('home-search')?.focus(); }}><X className="size-4" /></Button>}</div>
        <Button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button>
        <Button type="button" variant="outline" className="explore-filter-button" onClick={openFilters} aria-label="Filters"><SlidersHorizontal aria-hidden="true" className="size-4" /><span>Filters</span></Button>
      </form>
      <div className="explore-actions"><div className="explore-mobile-toggle" role="group" aria-label="Explore view"><Button variant={mobileView === 'homes' ? 'soft' : 'ghost'} aria-pressed={mobileView === 'homes'} onClick={() => changeMapView('homes')}>List</Button><Button variant={mobileView === 'map' ? 'soft' : 'ghost'} aria-pressed={mobileView === 'map'} onClick={() => changeMapView('map')}>Map</Button></div>
        <details className="explore-tools-menu"><summary aria-label="More search tools"><Ellipsis aria-hidden="true" className="size-5" /><span>More</span></summary><div className="explore-tools-popover">
          <Button className="explore-menu-layout" variant="ghost" aria-label={layoutMode === 'map' ? 'Split view' : 'Full map'} onClick={event => { event.currentTarget.closest('details').open = false; changeLayout(); }}>{layoutMode === 'map' ? 'Split view' : 'Full map'}</Button>
          <Button variant="ghost" onClick={event => { event.currentTarget.closest('details').open = false; setMarketOpen(true); }}><ChartNoAxesCombined aria-hidden="true" className="size-4" />Price history</Button>
          <Button variant="ghost" aria-label="Search presets" onClick={event => { event.currentTarget.closest('details').open = false; setToolsOpen(true); }}><ListFilter aria-hidden="true" className="size-4" />Search presets</Button>
          <Button variant="ghost" onClick={event => { event.currentTarget.closest('details').open = false; copyLink(); }}><Copy aria-hidden="true" className="size-4" />Share filters</Button>
          <Button variant="ghost" disabled={busy} onClick={event => { event.currentTarget.closest('details').open = false; reset(); }}>Reset search</Button>
        </div></details>
        <Button aria-label={layoutMode === 'map' ? 'Split view' : 'Full map'} variant="ghost" className="explore-layout-button" aria-pressed={layoutMode === 'map'} onClick={changeLayout}>{layoutMode === 'map' ? <PanelsLeftBottom aria-hidden="true" className="size-4" /> : <Expand aria-hidden="true" className="size-4" />}<span>{layoutMode === 'map' ? 'Split view' : 'Full map'}</span></Button>
      </div>
    </header>
    <div className="explore-controls">
      <div className="explore-quick-filters" aria-label="Quick search filters">
        <Button variant="ghost" onClick={() => { setDraft(structuredClone(appliedBrief)); setFilterError(''); setBudgetOpen(true); }}><span className="criteria-label">{appliedBrief.budget != null ? 'Edit price ceiling' : 'Set price ceiling'}</span><span className="criteria-short-label">Budget</span><ChevronDown aria-hidden="true" className="size-3.5" /></Button>
        <Button variant="ghost" onClick={openFilters}><span>{appliedBrief.preferredTowns?.length ? `${appliedBrief.preferredTowns.length} towns` : 'All towns'}</span><ChevronDown aria-hidden="true" className="size-3.5" /></Button>
        <Button variant="ghost" onClick={openFilters}><span className="criteria-label">{appliedBrief.preferredFlatType || 'Any flat type'}</span><span className="criteria-short-label">{appliedBrief.preferredFlatType || 'Flat type'}</span><ChevronDown aria-hidden="true" className="size-3.5" /></Button>
      </div>
      <div className="explore-applied">{workspace.appliedBounds && <Button variant="outline" onClick={() => runSearch(workspace.appliedQuery ?? query, appliedBrief, { interpret: false })}>Map area applied · Remove area <X aria-hidden="true" className="size-3" /></Button>}<ActiveRequirements brief={appliedBrief} places={places} disabled={busy} onApply={next => runSearch(query, next, { interpret: false })} /></div>
      <span className="explore-data-note">HDB resale records · Singapore</span>
    </div>
    {!['idle', 'loading', 'success'].includes(homeState?.status) || homeState?.dataMode === 'fixture' && !busy ? <DataStatus state={homeState} hasData={homes.length > 0} onRetry={retryHomes} retryLabel="Retry home data" compact className="mt-3" /> : null}

  </>;
  const resultsPanel = (
<section className="explore-results" aria-label="Historical transaction results"><div className="explore-results-heading"><div><h2>{savedOnly ? 'Your saved places' : 'Places to explore'}</h2><p>{savedOnly ? `${visibleHomes.length} saved records` : `${homes.length.toLocaleString()} of ${(pagination?.total ?? homes.length).toLocaleString()} ${groupBlocks ? 'blocks' : 'records'} loaded`}</p></div><span className="explore-source-note">Past sales,<br />not live listings</span></div>{collectionControls}<div ref={resultsRef} className="explore-results-scroll" aria-busy={busy}>
        {recordGroups.map(({ home, count }) => <div key={home.id} className="space-y-2">{count > 1 && <p className="px-2 text-xs text-muted-foreground">{count} loaded sales at this block / flat type · latest dated observation shown</p>}<HomeCard variant="browse" compact home={home} saved={shortlistIds.includes(home.id)} selected={selectedHomes.some(item => item.id === home.id)} mapActive={selectedMapHome?.id === home.id} onLocate={onLocateRecord} onSave={onSaveRecord} onCompare={onCompareRecord} onInspect={onInspectRecord} /></div>)}
        {!visibleHomes.length && !busy && homeState?.status !== 'idle' && <div className="grid min-h-64 content-center rounded-xl border border-dashed p-5 text-center"><h3 className="text-lg font-semibold">{empty}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{savedOnly ? 'Save a location from All results to keep its evidence here.' : homeState?.status === 'error' ? 'Your search is retained. Retry the same request to continue.' : 'Try fewer requirements or a wider area.'}</p>{savedOnly ? <Button variant="outline" className="mx-auto mt-4" onClick={() => changeView(false)}>Browse all results</Button> : <Button variant="outline" className="mx-auto mt-4" onClick={homeState?.status === 'error' ? retryHomes : reset}> {homeState?.status === 'error' ? 'Retry search' : 'Reset search'}</Button>}</div>}
    {!savedOnly && !visibleHomes.length && !busy && ['empty', 'success'].includes(homeState?.status) && <div className="mt-4"><EmptyRecovery brief={appliedBrief} lastSearchSnapshot={lastSearchSnapshot} applySearch={runSearch} fixtureMode={fixtureMode} /></div>}
        {!savedOnly && pagination?.hasMore && <Button variant="outline" className="w-full" disabled={busy} onClick={loadMoreHomes}>{busy ? 'Loading…' : groupBlocks ? 'Load more blocks' : 'Load more transactions'}</Button>}
      </div></section>
  );
  const detailsPanel = (
    detailId && <aside ref={detailRef} tabIndex={-1} className="explore-detail" aria-labelledby="record-detail-title"><header className="explore-detail-heading"><div className="min-w-0"><p className="explore-detail-label"><ArrowRight aria-hidden="true" className="size-4" />Record details</p><h2 id="record-detail-title" aria-live="polite" className="mt-1 break-words font-display text-lg font-semibold">{detail?.address || 'Transaction record'}</h2></div><Button size="icon" variant="ghost" aria-label="Close record details" onClick={closeDetail}><X aria-hidden="true" className="size-4" /></Button></header><div className="explore-detail-scroll">{detail ? <CandidateDetails home={detail} homes={allKnown} brief={appliedBrief} saved={shortlistIds.includes(detail.id)} selected={selectedHomes.some(item => item.id === detail.id)} resources={resourceFeatures} resourceState={resourceState} visibleResourceTypes={visibleResourceTypes} onToggleNearbyLayer={toggleNearbyLayer} onEnableNearbyLayers={enableNearbyLayers} onShowFacilityOnMap={focusFacilityOnMap} onRetryResources={retryResources} onSave={home => workspace.ensureSaved ? workspace.ensureSaved(home, true) : !shortlistIds.includes(home.id) && workspace.toggleShortlist(home)} onCompare={toggleCompare} onLocate={focusDetailHome} /> : <p className="text-sm text-muted-foreground">This record is not in the loaded results. Restore its search, check Saved, or load more records.</p>}</div><footer className="explore-detail-footer"><Button variant="ghost" onClick={closeDetail}><ArrowLeft aria-hidden="true" className="size-4" />Results</Button><div className="flex items-center gap-1"><span className="mr-2 text-xs text-muted-foreground" aria-live="polite">{detailIndex >= 0 ? `${detailIndex + 1} / ${navigationHomes.length}` : 'Linked record'}</span><Button variant="outline" size="icon" aria-label="Previous record" disabled={detailIndex <= 0} onClick={() => inspect(navigationHomes[detailIndex - 1])}><ArrowLeft aria-hidden="true" className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Next record" disabled={detailIndex < 0 || detailIndex >= navigationHomes.length - 1} onClick={() => inspect(navigationHomes[detailIndex + 1])}><ArrowRight aria-hidden="true" className="size-4" /></Button></div></footer></aside>
  );
  const recordPanels = <>{resultsPanel}{detailsPanel}</>;
  if (compareOpen) return <ComparisonWorkspace homes={selectedHomes} onRemove={onCompareRecord} availableHomes={shortlistHomes.filter(home => !selectedHomes.some(selected => selected.id === home.id))} onAdd={onCompareRecord} brief={appliedBrief} decisions={decisions} photos={photos} user={user} workspaceReady={workspaceReady !== false} onClose={() => setCompareOpen(false)} />;
  return <div style={{ '--sidebar-width': `${sidebarWidth}px` }} className={`explore-desk workspace-canvas ${layoutMode === 'map' ? 'explore-desk--map' : ''}`}>
    {!compareOpen && <HousingChat context={detail ? 'detail' : 'explore'} user={user} homes={homes} selectedHome={detail || selectedMapHome} brief={appliedBrief} onSearch={runSearch} workspaceReady={workspaceReady !== false} options={options} />}
    {layoutMode === 'map' ? <MapResearchSidebar open={mapResultsOpen} onOpenChange={setMapResultsOpen} toolbar={toolbar}>{resultsPanel}</MapResearchSidebar> : toolbar}
    {layoutMode === 'map' && detailId && <div className="map-record-details"><div ref={setMapControlsTarget} className="detail-map-tools-host" />{detailsPanel}</div>}
    <div ref={stageRef} style={{ '--sidebar-width': `${sidebarWidth}px` }} className={`explore-stage ${resizing ? 'explore-stage--resizing' : ''} ${detailId ? 'explore-stage--detail' : ''} ${mobileView === 'map' ? 'explore-stage--mobile-map' : ''} ${mapResultsOpen ? 'explore-stage--results-open' : ''} `}>
      <div className="explore-map"><WorkspaceMap controlsTarget={mapControlsTarget} onAddressSelected={revealAddressOnMap} homes={mapHomes} resources={resourceFeatures} resourceState={resourceState} retryResources={retryResources} sourceStatus={sourceStatus} hoveredHome={workspace.hoveredHome} selectedHome={selectedMapHome} onSelect={onMapSelect} facilityFocus={facilityFocus} visibleResourceTypes={visibleResourceTypes} onVisibleResourceTypesChange={updateVisibleResourceTypes} cameraIntent={mapCameraIntent} onCameraIntent={onMapCameraIntent} refreshViewport={refreshViewport} viewportBounds={viewportBounds} onSearchArea={savedOnly ? undefined : onSearchMapArea} searchBusy={busy} className="explore-map-panel" /></div>
      {layoutMode === 'split' && <div className="explore-divider" role="separator" tabIndex={0} aria-label="Resize map and sidebar" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={Math.max(280, stageWidth - 280)} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} pixels sidebar width`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={moveDivider} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onLostPointerCapture={() => setResizing(false)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizeSidebar(sidebarWidth + (event.key === 'ArrowLeft' ? 24 : -24)); } else if (event.key === 'Home') { event.preventDefault(); resizeSidebar(500); } }}><span /></div>}
      {layoutMode === 'split' && recordPanels}
    </div>


    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b p-5 pr-16"><DialogTitle>Filters</DialogTitle><DialogDescription>Edit your criteria. Changes apply only when you choose Apply filters.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"><SearchFilters brief={draft} setBrief={setDraft} options={options} places={places} onAddPlace={() => { setFiltersOpen(false); setPlaceOpen(true); }} />{filterError && <Alert role="alert" tone="warning" className="mt-4">{filterError}</Alert>}</div><DialogFooter className="shrink-0 border-t p-4"><Button variant="outline" onClick={() => setFiltersOpen(false)}>Cancel</Button><Button disabled={busy} onClick={applyDraft}>Apply filters</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}><DialogContent><DialogHeader><DialogTitle>Price ceiling</DialogTitle><DialogDescription>Compare recorded prices within your chosen ceiling.</DialogDescription></DialogHeader><BudgetInput value={draft.budget} onChange={value => setDraft(current => ({ ...current, budget: value, requirements: { ...current.requirements, budget: value != null } }))} />{filterError && <Alert role="alert" tone="warning">{filterError}</Alert>}<DialogFooter><Button variant="outline" onClick={() => setBudgetOpen(false)}>Cancel</Button><Button disabled={busy} onClick={applyDraft}>Apply price ceiling</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={placeOpen} onOpenChange={setPlaceOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Add a household place</DialogTitle><DialogDescription>Choose an address or mark a temporary location.</DialogDescription></DialogHeader><SearchPlaceEntry onCancel={() => { setPlaceOpen(false); setFiltersOpen(true); }} onAdded={place => { setDraft(current => ({ ...current, placeConstraints: [...(current.placeConstraints || []).filter(item => item.placeId !== place.id), { placeId: place.id, maxDistanceM: place.maximumDistanceM || 5000 }] })); setPlaceOpen(false); setFiltersOpen(true); }} /></DialogContent></Dialog>

    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Search presets and history</DialogTitle><DialogDescription>Reuse criteria without leaving your research workspace.</DialogDescription></DialogHeader><SearchWorkbench brief={appliedBrief} applySearch={async (...args) => { const result = await runSearch(...args); if (result != null) setToolsOpen(false); }} /><section className="border-t pt-4"><h3 className="text-sm font-semibold">Save this search with its evidence</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Account searches retain source dates and score policy so you can see what changed on a later run.</p>{user && !canSaveSearch && <p role="status" className="mt-2 text-xs text-muted-foreground">Run a source search first to save its evidence and scoring policy.</p>}{user ? <form className="mt-3 flex gap-2" onSubmit={submitSavedSearch}><Input aria-label="Saved evidence search name" maxLength={80} value={saveName} onChange={event => setSaveName(event.target.value)} placeholder="Name this evidence search" /><Button disabled={!canSaveSearch || savingSearch || !saveName.trim()}>{savingSearch ? 'Saving…' : 'Save evidence search'}</Button></form> : <Link href="/login" className="mt-2 block min-h-11 content-center text-sm text-primary underline">Sign in to retain evidence searches across devices</Link>}</section><SavedDecisionSections onEdit={edited => { setDraft(structuredClone(edited)); setToolsOpen(false); setFiltersOpen(true); }} onApplied={() => setToolsOpen(false)} /></DialogContent></Dialog>
    <Dialog open={marketOpen} onOpenChange={setMarketOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto overscroll-contain"><DialogHeader><DialogTitle>Neighbourhood price history</DialogTitle><DialogDescription>Dated resale transactions; not a valuation.</DialogDescription></DialogHeader><MarketExplorer towns={options.towns} flatTypes={options.flatTypes} initialTown={selectedMapHome?.town || appliedBrief.preferredTowns?.[0] || ''} initialFlatType={selectedMapHome?.type || appliedBrief.preferredFlatType || ''} /></DialogContent></Dialog>
  </div>;
}
