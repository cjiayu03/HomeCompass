'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight, Baby, ChartNoAxesCombined, MapPin, Search, SlidersHorizontal, X } from 'lucide-react';
import { BriefRibbon } from '@/components/brief-ribbon';
import { HomeCard } from '@/components/home-card';
import { EvidenceContext } from '@/components/evidence-context';
import { MapPanel } from '@/components/map-panel';
import { DataStatus } from '@/components/data-status';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { money } from '@/lib/utils';
import { PlaceDistanceList, PlacePicker } from '@/components/place-picker';
import { requestJson } from '@/lib/api-client';
import { homes as fixtureHomes } from '@/lib/data';
import { ActiveRequirements, AdvancedRequirements, EmptyRecovery, MatchReasons, SearchWorkbench } from '@/components/search-workbench';
import { LoadingScene } from '@/components/loading-scene';
import { previewRank, storeyRangeValidationError } from '@/lib/planning';
import { NeighbourhoodMark } from '@/components/neighbourhood-mark';

const MarketExplorer = dynamic(() => import('@/components/market-explorer').then(module => module.MarketExplorer), {
  loading: () => <LoadingScene label="Opening price history…" />,
});

function Field({ label, children, hint }) {
  return <label className="flex flex-col gap-2"><span className="text-xs font-semibold text-foreground">{label}</span>{children}{hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}</label>;
}

function BriefPanel({ brief, setBrief, searchOptions, fixtureMode }) {
  const priorities = brief.priorityWeights || { school: 2, childcare: 2, care: 2, affordability: 1 };
  const update = (key, value) => setBrief({ ...brief, [key]: Number(value) });
  const updatePriority = (key, value) => setBrief({ ...brief, priorityWeights: { ...priorities, [key]: Number(value) } });
  const updateDistance = (key, value) => setBrief({ ...brief, [key]: value === '' ? null : Number(value) });
  const selectedTowns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  const townOptions = [...new Set([...(searchOptions?.towns || []), ...selectedTowns])];
  const flatTypeOptions = [...new Set([...(searchOptions?.flatTypes || []), ...(brief.preferredFlatType ? [brief.preferredFlatType] : [])])];
  return <div className="flex flex-col gap-5">
    <section aria-label="Household size">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">Household</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="Adults aged 18–59"><Input name="adults" autoComplete="off" type="number" min="1" max="10" value={brief.adults} onChange={(e) => update('adults', e.target.value)} /></Field><Field label="Children aged 0–17"><Input name="children" autoComplete="off" type="number" min="0" max="10" value={brief.children} onChange={(e) => update('children', e.target.value)} /></Field><Field label="People aged 60+"><Input name="olderAdults" autoComplete="off" type="number" min="0" max="10" value={brief.olderAdults} onChange={(e) => update('olderAdults', e.target.value)} /></Field></div>
    </section>
    <Field label={`Maximum budget · ${money(brief.budget)}`} hint="A ceiling for the labelled price observations."><input name="budget" className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]" type="range" min="250000" max="1000000" step="10000" value={brief.budget} onChange={(e) => update('budget', e.target.value)} /></Field>
    <section aria-label="Preferred HDB areas and flat type" className="space-y-3">
      <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold text-foreground">Where to look</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">Choose up to three towns. Leave them clear to search all areas.</p></div><span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{selectedTowns.length}/3 towns</span></div>
      {townOptions.length ? <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto rounded-xl border bg-muted/20 p-2 sm:grid-cols-3" role="group" aria-label="Preferred towns">
        {townOptions.map((town) => {
          const checked = selectedTowns.includes(town);
          const disabled = !checked && selectedTowns.length >= 3;
          return <label key={town} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${checked ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-transparent bg-background/70 text-muted-foreground hover:border-border'} ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}>
            <input type="checkbox" className="size-3.5 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled} onChange={() => setBrief({ ...brief, preferredTowns: checked ? selectedTowns.filter((item) => item !== town) : [...selectedTowns, town] })} />
            <span className="truncate">{town}</span>
          </label>;
        })}
      </div> : <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{searchOptions?.status === 'loading' ? 'Loading available towns…' : 'Town choices are temporarily unavailable. Other filters still work.'}</p>}
      <Field label="Flat type"><select name="preferredFlatType" className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief.preferredFlatType || ''} onChange={(event) => setBrief({ ...brief, preferredFlatType: event.target.value || null })}><option value="">Any flat type</option>{flatTypeOptions.map((flatType) => <option key={flatType} value={flatType}>{flatType}</option>)}</select></Field>
    </section>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Primary place" hint="Selecting a saved place below supplies its verified address for distance filters."><Input name="pinLocation" autoComplete="off" value={brief.pinLocation} onChange={(e) => setBrief({ ...brief, pinLocation: e.target.value })} placeholder="Raffles Place" /></Field><Field label="Place label"><Input name="pinLabel" autoComplete="off" value={brief.pinLabel} onChange={(e) => setBrief({ ...brief, pinLabel: e.target.value })} placeholder="Workplace" /></Field></div>
    <PlacePicker />
    <section className="space-y-3" aria-label="Nearby services"><div><p className="text-xs font-semibold text-foreground">Nearby services</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{fixtureMode ? 'Illustrative samples have no verified service distances; these limits apply to live source searches.' : 'Optional distance limits; records without distance evidence may not match.'}</p></div><div className="grid gap-3 sm:grid-cols-3">
      {[
        ['schoolDistance', 'Schools'],
        ['childcareDistance', 'Childcare'],
        ['careDistance', 'Care services'],
      ].map(([key, label]) => <Field key={key} label={label}><select name={key} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief[key] ?? ''} onChange={(event) => updateDistance(key, event.target.value)}><option value="">No limit</option><option value="500">Within 500 m</option><option value="1000">Within 1 km</option><option value="1500">Within 1.5 km</option><option value="2000">Within 2 km</option><option value="3000">Within 3 km</option></select></Field>)}
    </div></section>
    <Separator />
    <section aria-label="Priorities"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold">Priorities</p><p className="text-xs text-muted-foreground">Source scores use available evidence and these weights; missing evidence stays visible and lowers coverage.</p></div><span className="text-xs text-muted-foreground">1–3</span></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['school', 'School'], ['childcare', 'Childcare'], ['care', 'Care access'], ['affordability', 'Affordability']].map(([key, label]) => <label key={key} className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">{label}</span><select className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={priorities[key]} onChange={(e) => updatePriority(key, e.target.value)}><option value="1">Normal</option><option value="2">Important</option><option value="3">Essential</option></select></label>)}</div></section>
  </div>;
}

function DetailDialog({ home, onClose, onSave }) {
  const { user } = useAuth();
  const { brief } = useWorkspace();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  useEffect(() => { setSummary(null); setSummaryError(''); }, [home?.id]);
  async function requestSummary() {
    if (!user || !home) return;
    setSummaryBusy(true);
    setSummaryError('');
    try {
      const payload = await requestJson(`/api/v1/ai/summaries/${encodeURIComponent(home.id)}`, { method: 'POST' });
      setSummary(payload);
    } catch (error) { setSummaryError(error.message || 'The evidence summary is not available.'); }
    finally { setSummaryBusy(false); }
  }
  return <Dialog open={Boolean(home)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"><DialogHeader><Badge variant="secondary" className="w-fit">{home?.sourceSemantics === 'historical_transaction' ? 'Transaction record' : 'Illustrative sample'}</Badge><DialogTitle>{home?.address}</DialogTitle><DialogDescription>{home?.town} · {home?.type} · {home ? money(home.price) : ''}</DialogDescription></DialogHeader>{home && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{home.highlights.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}{home.risks.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div><Alert className="mt-1"><div><p className="mt-1 text-xs leading-5 text-muted-foreground">{home.sourceSemantics === 'historical_transaction' ? `Observed ${home.observedOn || home.sourceUpdated}. This is a historical transaction, not a live listing.` : 'Address, price, map point and surrounding details are illustrative UI data, not verified records.'}</p></div></Alert><EvidenceContext home={home} className="mt-3" /><MatchReasons home={home} brief={brief} /><div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{home.floorAreaSqm != null && <span>{home.floorAreaSqm} m²</span>}{home.storeyRange && <span>Storeys {home.storeyRange}</span>}{home.remainingLeaseYears != null && <span>Lease ≈ {home.remainingLeaseYears} years</span>}{home.pricePerSqm != null && <span>{money(home.pricePerSqm)} / m²</span>}</div><section className="space-y-2 border-t pt-3" aria-label="Household access"><h3 className="text-sm font-semibold">Household access</h3>{[['School', home.school], ['Childcare', home.childcare], ['Care', home.care]].map(([label, value]) => <p key={label} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{label}:</span> {value || 'Distance evidence unavailable'}</p>)}</section><PlaceDistanceList distances={home.placeDistances} />{home.sourceSemantics === 'historical_transaction' && user && <section className="space-y-3 border-t pt-4"><Button variant="outline" disabled={summaryBusy} onClick={requestSummary}>{summaryBusy ? 'Preparing…' : 'Summarize evidence'}</Button>{summaryError && <Alert tone="warning" className="text-xs">{summaryError}</Alert>}{summary && <div className="rounded-xl border bg-muted/35 p-4"><p className="text-sm leading-6">{summary.overview}</p>{summary.observations.length > 0 && <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">{summary.observations.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <span className="font-medium">· {item.evidence_fields.join(', ')}</span></li>)}</ul>}<p className="mt-3 text-[11px] leading-4 text-muted-foreground">{summary.limitations.join(' ')}</p></div>}</section>}</>}<DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => { onSave(home); onClose(); }}>Save place</Button></DialogFooter></DialogContent></Dialog>;
}

export default function ExplorePage() {
  const { hoveredHome } = useWorkspace();
  const { brief, setBrief, homes, homeState, pagination, loadMoreHomes, resourceFeatures, resourceState, viewportBounds, refreshViewport, sourceStatus, query, setQuery, selectedHomes, shortlistIds, toggleShortlist, toggleCompare, applySearch, resetSearch, retryHomes, retryResources, busy, lastSearchSnapshot, savedSearchState, saveSearch, fixtureMode } = useWorkspace();
  const [selectedMapHome, setSelectedMapHome] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState({ towns: [], flatTypes: [], status: 'loading' });
  const [saveName, setSaveName] = useState('');
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [savingSearch, setSavingSearch] = useState(false);
  const [weights, setWeights] = useState({budget:3,space:2,location:3});
  const [preview, setPreview] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileView, setMobileView] = useState('homes');
  const resultsRef = useRef(null);
  const visibleHomes = useMemo(() => {
    if(!preview) return homes;
    const areas=homes.map(home=>home.floorAreaSqm).filter(Number.isFinite);
    const range=areas.length?[Math.min(...areas),Math.max(...areas)]:[0,0];
    return homes.map(home=>({...home,preferencePreview:previewRank(home,brief,weights,range)})).sort((a,b)=>(b.preferencePreview.score??-1)-(a.preferencePreview.score??-1)||String(a.id).localeCompare(String(b.id)));
  }, [homes,preview,brief,weights]);
  function selectFromMap(home) {
    setSelectedMapHome({ ...home });
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileView('homes');
  }
  function locateFromCard(home) {
    setSelectedMapHome({ ...home });
    if (window.matchMedia('(max-width: 1023px)').matches) setMobileView('map');
  }
  useEffect(() => {
    if (!selectedMapHome) return;
    if (!visibleHomes.some(home => home.id === selectedMapHome.id)) {
      setSelectedMapHome(null);
      return;
    }
    const list = resultsRef.current;
    const card = Array.from(list?.querySelectorAll('[data-home-id]') || []).find(node => node.dataset.homeId === String(selectedMapHome.id));
    if (!card || !card.getClientRects().length) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (window.matchMedia('(min-width: 1024px)').matches) {
      const offset = card.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTo({ top: list.scrollTop + offset - 12, behavior });
    } else if (mobileView === 'homes') {
      card.scrollIntoView({ block: 'center', behavior });
    }
  }, [selectedMapHome, mobileView, visibleHomes]);
  const canSaveSearch = Boolean(lastSearchSnapshot?.metadata?.dataMode === 'live'
    && lastSearchSnapshot.metadata.scorePolicyVersion
    && ['success', 'empty'].includes(homeState?.status)
    && homeState?.dataMode === 'live'
    && !busy
    && savedSearchState?.status !== 'signed_out');
  const emptyTitle = homeState?.status === 'error'
    ? 'Home data unavailable'
    : homeState?.status === 'loading' || homeState?.status === 'idle'
      ? 'Loading places'
      : homeState?.dataMode === 'fixture'
        ? 'No sample homes found'
        : 'No places found';
  const emptyDescription = homeState?.status === 'error'
    ? 'The latest home request failed. Retry it or reset the search to try again.'
    : homeState?.status === 'loading' || homeState?.status === 'idle'
      ? 'Home records are loading.'
      : 'Try a wider search or adjust the filters.';
  const search = (event) => { event?.preventDefault(); applySearch(); };
  const applyFilters = () => { if (storeyRangeValidationError(brief)) return; applySearch(); setFiltersOpen(false); };
  useEffect(() => {
    if (fixtureMode) {
      setSearchOptions({
        towns: [...new Set(fixtureHomes.map((home) => home.town))].sort(),
        flatTypes: [...new Set(fixtureHomes.map((home) => home.type.toLocaleUpperCase().replace(/-/g, ' ')))].sort(),
        status: 'ready',
      });
      return undefined;
    }
    let active = true;
    requestJson('/api/v1/search/options').then((payload) => {
      if (!active) return;
      setSearchOptions({
        towns: Array.isArray(payload.towns) ? payload.towns : [],
        flatTypes: Array.isArray(payload.flatTypes) ? payload.flatTypes : [],
        status: 'ready',
      });
    }).catch(() => {
      if (active) setSearchOptions({ towns: [], flatTypes: [], status: 'error' });
    });
    return () => { active = false; };
  }, [fixtureMode]);
  async function submitSavedSearch(event) {
    event.preventDefault();
    setSavingSearch(true);
    setSaveFeedback(null);
    try {
      const saved = await saveSearch(saveName);
      if (saved) {
        setSaveName('');
        setSaveFeedback({ tone: 'success', message: 'Saved search created.' });
      } else {
        setSaveFeedback({ tone: 'warning', message: 'The search could not be saved. Check the name and sign-in status, then try again.' });
      }
    } finally {
      setSavingSearch(false);
    }
  }

  return <div className="workspace-canvas explore-workspace container max-w-[1600px] px-4 py-3 sm:px-6 lg:px-8">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3"><NeighbourhoodMark /><div><h1 className="font-display text-2xl font-semibold tracking-tight">Explore homes</h1><p className="hidden text-sm text-muted-foreground sm:block">A neighbourhood for your everyday.</p></div></div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" className="h-11 px-3 text-sm" onClick={() => setMarketOpen(true)}><ChartNoAxesCombined className="size-4" /><span className="hidden sm:inline">Price history</span><span className="sm:hidden">Prices</span></Button>
        <Button variant="outline" className="h-11 px-3 text-sm" onClick={() => setToolsOpen(true)}>Search tools</Button>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <form className="relative flex min-w-0 flex-1" role="search" onSubmit={search}>
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
        <label htmlFor="home-search" className="sr-only">Search a town or amenity</label>
        <Input id="home-search" name="query" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 pl-9 pr-24" placeholder="Town, street or amenity" />
        {query && <Button type="button" size="icon" variant="ghost" className="absolute right-[4.8rem] top-1.5 size-8 p-0" aria-label="Clear search" onClick={() => { setQuery(''); document.getElementById('home-search')?.focus(); }}><X className="size-4" /></Button>}
        <Button className="absolute right-1 top-1 h-9 w-[72px] px-2" type="submit" disabled={busy} aria-label="Search">{busy ? 'Loading…' : 'Search'}</Button>
      </form>
      <Button variant="outline" className="h-11 shrink-0 px-3" onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="size-4" />Filters</Button>
    </div>
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm text-muted-foreground">
      <button className="min-w-0 cursor-pointer text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setFiltersOpen(true)} aria-label="Edit current filters">
        <span className="font-medium text-foreground">Up to {money(brief.budget)}</span> · {brief.preferredTowns?.length ? brief.preferredTowns.join(', ') : 'All towns'} · {brief.preferredFlatType || 'Any flat type'}
      </button>
      <button className="cursor-pointer text-left underline decoration-border underline-offset-4 hover:text-foreground" onClick={() => setToolsOpen(true)}>Historical transactions, not listings · Data notes</button>
    </div>
    {(homeState?.status !== 'success' || homeState?.dataMode === 'fixture') && <DataStatus state={homeState} hasData={visibleHomes.length > 0} onRetry={retryHomes} retryLabel="Retry home data" emptyMessage="No source records match these filters." showMetadata={false} compact className="mb-3" />}
    <div className="mb-3 flex items-center gap-1 rounded-lg border bg-secondary/50 p-1 lg:hidden" role="group" aria-label="Explore view">
      <Button variant={mobileView === 'homes' ? 'default' : 'ghost'} className="h-11 flex-1 text-sm" aria-pressed={mobileView === 'homes'} onClick={() => setMobileView('homes')}>Homes ({visibleHomes.length})</Button>
      <Button variant={mobileView === 'map' ? 'default' : 'ghost'} className="h-11 flex-1 text-sm" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}><MapPin className="size-4" />Map</Button>
    </div>
    <div className="grid min-h-0 gap-4 lg:h-[max(400px,calc(100dvh-230px))] lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className={`${mobileView === 'map' ? 'block' : 'hidden'} min-h-0 lg:block`}>
        <MapPanel homes={visibleHomes} resources={resourceFeatures} resourceState={resourceState} retryResources={retryResources} sourceStatus={sourceStatus} hoveredHome={hoveredHome} selectedHome={selectedMapHome} onSelect={selectFromMap} refreshViewport={refreshViewport} viewportBounds={viewportBounds} className="lg:h-full" />
        {mobileView === 'map' && selectedMapHome && <Button variant="outline" className="mt-2 w-full lg:hidden" onClick={() => setDetail(selectedMapHome)}>View {selectedMapHome.address}</Button>}
      </div>
      <section className={`${mobileView === 'homes' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col rounded-2xl border bg-card/70 lg:flex lg:overflow-hidden`} aria-label="Candidate places">
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-t-2xl border-b bg-[var(--friendly-leaf)] px-4 py-3">
          <h2 className="text-base font-semibold">Homes <span className="ml-1 font-normal text-muted-foreground">({visibleHomes.length})</span></h2>
          {selectedHomes.length > 0 ? <Button asChild variant="soft" className="h-11 px-3 text-sm"><Link href="/compare">Compare {selectedHomes.length} <ArrowRight className="size-4" /></Link></Button> : <span className="text-sm text-muted-foreground">Find a favourite</span>}
        </div>
        <div ref={resultsRef} className="min-h-0 flex-1 p-3 lg:overflow-y-auto lg:[scrollbar-gutter:stable]" aria-live="polite" aria-busy={busy}>
          {visibleHomes.length ? <div className="flex flex-col gap-3">
            {visibleHomes.map((home) => <HomeCard key={home.id} variant="browse" home={home} saved={shortlistIds.includes(home.id)} selected={selectedHomes.some((item) => item.id === home.id)} mapActive={selectedMapHome?.id === home.id} onLocate={locateFromCard} onSave={toggleShortlist} onCompare={toggleCompare} onInspect={setDetail} />)}
            {pagination?.hasMore && <div className="flex flex-col items-center gap-2 border-t py-3"><Button variant="outline" disabled={busy} onClick={loadMoreHomes}>{busy ? 'Loading…' : 'Load more homes'}</Button><p className="text-xs text-muted-foreground">{visibleHomes.length.toLocaleString()} records loaded</p></div>}
          </div> : <Card className="grid min-h-64 place-items-center border-dashed"><CardContent className="text-center"><Baby className="mx-auto mb-3 size-8 text-primary" /><h3 className="font-display text-lg font-semibold">{emptyTitle}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{emptyDescription}</p><Button className="mt-5" variant="outline" onClick={resetSearch}>Reset search</Button></CardContent></Card>}
        </div>
      </section>
    </div>

    <Dialog open={toolsOpen} onOpenChange={setToolsOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Search tools</DialogTitle><DialogDescription>Save this search, adjust your priorities or try another scenario.</DialogDescription></DialogHeader>
      <DataStatus state={homeState} hasData={visibleHomes.length > 0} onRetry={retryHomes} retryLabel="Retry home data" compact liveTitle="Historical resale data" />
      <BriefRibbon brief={brief} onEdit={() => { setToolsOpen(false); setFiltersOpen(true); }} />
      <ActiveRequirements brief={brief} setBrief={setBrief} />
      <SearchWorkbench brief={brief} setBrief={setBrief} weights={weights} setWeights={setWeights} preview={preview} setPreview={setPreview} applySearch={() => { applySearch(); setToolsOpen(false); }} />
      <form className="space-y-2 border-t pt-4" onSubmit={submitSavedSearch}>
        <label htmlFor="saved-search-name" className="text-sm font-semibold">Save this search</label>
        <div className="flex gap-2"><Input id="saved-search-name" autoComplete="off" maxLength={80} value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Name this search" /><Button type="submit" disabled={!canSaveSearch || savingSearch || !saveName.trim()}>{savingSearch ? 'Saving…' : 'Save search'}</Button></div>
        {savedSearchState?.status === 'signed_out' && <p className="text-xs text-muted-foreground">Sign in to save searches to your account.</p>}
        {saveFeedback && <Alert role="status" tone={saveFeedback.tone} className="text-xs">{saveFeedback.message}</Alert>}
      </form>
      <DialogFooter><Button variant="ghost" onClick={() => { resetSearch(); setToolsOpen(false); }}>Reset search</Button><Button variant="outline" onClick={() => setToolsOpen(false)}>Done</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-14 sm:px-7"><DialogTitle>Filters</DialogTitle><DialogDescription>Set household size, budget, nearby places and priorities for this search.</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7"><BriefPanel brief={brief} setBrief={setBrief} searchOptions={searchOptions} fixtureMode={fixtureMode} /><AdvancedRequirements brief={brief} setBrief={setBrief}/></div>
      <DialogFooter className="shrink-0 flex-col border-t border-border bg-background px-5 py-4 sm:flex-row sm:px-7"><Button variant="outline" className="w-full sm:w-auto" onClick={() => setFiltersOpen(false)}>Cancel</Button><Button className="w-full sm:w-auto" onClick={applyFilters}>Apply filters <ArrowRight className="size-4" /></Button></DialogFooter>
    </DialogContent></Dialog>
    {!visibleHomes.length && ['empty','success'].includes(homeState?.status) && <EmptyRecovery brief={brief} setBrief={setBrief} lastSearchSnapshot={lastSearchSnapshot} applySearch={applySearch} fixtureMode={fixtureMode}/>}
    <Dialog open={marketOpen} onOpenChange={setMarketOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Neighbourhood price history</DialogTitle><DialogDescription>Explore the evidence behind historical resale prices.</DialogDescription></DialogHeader><MarketExplorer towns={searchOptions.towns} flatTypes={searchOptions.flatTypes} initialTown={selectedMapHome?.town||brief.preferredTowns?.[0]||''} initialFlatType={selectedMapHome?.type||brief.preferredFlatType||''}/></DialogContent></Dialog>
    <DetailDialog home={detail} onClose={() => setDetail(null)} onSave={toggleShortlist} />
  </div>;
}
