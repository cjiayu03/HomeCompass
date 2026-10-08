'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Baby, MapPin, Search, SlidersHorizontal, X } from 'lucide-react';
import { BriefRibbon } from '@/components/brief-ribbon';
import { HomeCard } from '@/components/home-card';
import { MapPanel } from '@/components/map-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BlurFade } from '@/components/ui/blur-fade';
import { NumberTicker } from '@/components/ui/number-ticker';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { money, scoreLabel } from '@/lib/utils';

function Field({ label, children, hint }) {
  return <label className="flex flex-col gap-2"><span className="text-xs font-semibold text-foreground">{label}</span>{children}{hint && <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>}</label>;
}

function BriefPanel({ brief, setBrief }) {
  const priorities = brief.priorityWeights || { school: 2, childcare: 2, care: 2, affordability: 1 };
  const update = (key, value) => setBrief({ ...brief, [key]: Number(value) });
  const updatePriority = (key, value) => setBrief({ ...brief, priorityWeights: { ...priorities, [key]: Number(value) } });
  return <div className="flex flex-col gap-5">
    <section aria-label="Household size">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">Household</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Field label="Adults"><Input name="adults" autoComplete="off" type="number" min="1" max="10" value={brief.adults} onChange={(e) => update('adults', e.target.value)} /></Field><Field label="Children"><Input name="children" autoComplete="off" type="number" min="0" max="10" value={brief.children} onChange={(e) => update('children', e.target.value)} /></Field><Field label="Older adults"><Input name="olderAdults" autoComplete="off" type="number" min="0" max="10" value={brief.olderAdults} onChange={(e) => update('olderAdults', e.target.value)} /></Field></div>
    </section>
    <Field label={`Maximum budget · ${money(brief.budget)}`} hint="A ceiling for the labelled price observations."><input name="budget" className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]" type="range" min="250000" max="1000000" step="10000" value={brief.budget} onChange={(e) => update('budget', e.target.value)} /></Field>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Primary place"><Input name="pinLocation" autoComplete="off" value={brief.pinLocation} onChange={(e) => setBrief({ ...brief, pinLocation: e.target.value })} placeholder="Raffles Place" /></Field><Field label="Place label"><Input name="pinLabel" autoComplete="off" value={brief.pinLabel} onChange={(e) => setBrief({ ...brief, pinLabel: e.target.value })} placeholder="Workplace" /></Field></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="School distance"><select name="schoolDistance" className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief.schoolDistance} onChange={(e) => update('schoolDistance', e.target.value)}><option value="500">Within 500 m</option><option value="1000">Within 1 km</option><option value="1500">Within 1.5 km</option></select></Field><Field label="Care distance"><select name="careDistance" className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief.careDistance} onChange={(e) => update('careDistance', e.target.value)}><option value="500">Within 500 m</option><option value="1200">Within 1.2 km</option><option value="2000">Within 2 km</option></select></Field></div>
    <Separator />
    <section aria-label="Priorities"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold">Priorities</p><p className="text-xs text-muted-foreground">Weights currently affect local fixture ordering only.</p></div><span className="text-xs text-muted-foreground">1–3</span></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['school', 'School'], ['childcare', 'Childcare'], ['care', 'Care access'], ['affordability', 'Affordability']].map(([key, label]) => <label key={key} className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">{label}</span><select className="h-10 w-full rounded-lg border bg-background px-3 text-sm" value={priorities[key]} onChange={(e) => updatePriority(key, e.target.value)}><option value="1">Normal</option><option value="2">Important</option><option value="3">Essential</option></select></label>)}</div></section>
  </div>;
}

function DetailDialog({ home, onClose, onSave }) {
  const { client, user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  useEffect(() => { setSummary(null); setSummaryError(''); }, [home?.id]);
  async function requestSummary() {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
    if (!client || !home) return;
    setSummaryBusy(true);
    setSummaryError('');
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/ai/summaries/${encodeURIComponent(home.id)}`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail?.message || 'The evidence summary is not available.');
      setSummary(payload);
    } catch (error) { setSummaryError(error.message || 'The evidence summary is not available.'); }
    finally { setSummaryBusy(false); }
  }
  return <Dialog open={Boolean(home)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><Badge variant="secondary" className="w-fit">{home?.sourceSemantics === 'historical_transaction' ? 'Transaction record' : 'Illustrative sample'}</Badge><DialogTitle>{home?.address}</DialogTitle><DialogDescription>{home?.town} · {home?.type} · {home ? money(home.price) : ''}</DialogDescription></DialogHeader>{home && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{home.highlights.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}{home.risks.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div><Alert className="mt-1"><div><p className="font-semibold">{scoreLabel(home.score)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{home.sourceSemantics === 'historical_transaction' ? `Observed ${home.observedOn || home.sourceUpdated}. This is a historical transaction, not a live listing.` : 'Address, price, map point and surrounding details are illustrative UI data, not verified records.'}</p></div></Alert>{home.sourceSemantics === 'historical_transaction' && user && <section className="space-y-3 border-t pt-4"><Button variant="outline" disabled={summaryBusy} onClick={requestSummary}>{summaryBusy ? 'Preparing…' : 'Summarize evidence'}</Button>{summaryError && <Alert tone="warning" className="text-xs">{summaryError}</Alert>}{summary && <div className="rounded-xl border bg-muted/35 p-4"><p className="text-sm leading-6">{summary.overview}</p>{summary.observations.length > 0 && <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">{summary.observations.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <span className="font-medium">· {item.evidence_fields.join(', ')}</span></li>)}</ul>}<p className="mt-3 text-[11px] leading-4 text-muted-foreground">{summary.limitations.join(' ')}</p></div>}</section>}</>}<DialogFooter><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => { onSave(home); onClose(); }}>Save place</Button></DialogFooter></DialogContent></Dialog>;
}

export default function ExplorePage() {
  const { brief, setBrief, homes, resourceFeatures, sourceStatus, query, setQuery, selectedHomes, shortlistIds, toggleShortlist, toggleCompare, applySearch, resetSearch, busy } = useWorkspace();
  const [selectedMapHome, setSelectedMapHome] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const visibleHomes = useMemo(() => homes, [homes]);
  const search = (event) => { event?.preventDefault(); applySearch(); };
  const applyFilters = () => { applySearch(); setFiltersOpen(false); };

  return <div className="workspace-canvas container flex max-w-[1600px] flex-col px-4 py-5 sm:px-6 sm:py-6 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:px-8">
    <BlurFade direction="up" delay={0.01} className="shrink-0"><div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><MapPin className="size-3.5 text-primary" />Singapore · source-dated observations</div><h1 className="font-display text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Find a place that fits real life.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Browse homes on the map, then compare the details that matter to your household.</p>{visibleHomes.some((home) => home.source?.includes('Illustrative fixture')) && <p className="mt-2 max-w-2xl rounded-lg border bg-muted/45 px-3 py-2 text-xs leading-5 text-muted-foreground">Preview only: these addresses, prices and map pins are illustrative UI samples, not verified government records. Real scores and amenity distances are not enabled yet.</p>}</div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-primary" /><NumberTicker value={visibleHomes.length} className="text-foreground" /> places in view</div></div></BlurFade>
    <BlurFade direction="up" delay={0.05} className="shrink-0"><div className="flex flex-col gap-3 py-3 sm:flex-row"><form className="relative flex min-w-0 flex-1" role="search" onSubmit={search}><Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" /><label htmlFor="home-search" className="sr-only">Search a town or amenity</label><Input id="home-search" name="query" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 pl-10 pr-24" placeholder="Search a town, street or amenity" />{query && <Button type="button" size="icon" variant="ghost" className="absolute right-[4.8rem] top-1.5 size-8 p-0" aria-label="Clear search" onClick={() => setQuery('')}><X className="size-4" /></Button>}<Button className="absolute right-1 top-1 h-9" type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button></form><Button variant="outline" onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="size-4" />Filter</Button><Button variant="ghost" onClick={resetSearch}>Reset</Button></div></BlurFade>
    <BlurFade direction="up" delay={0.09} className="shrink-0"><BriefRibbon brief={brief} onEdit={() => setFiltersOpen(true)} /></BlurFade>

    <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)]">
      <MapPanel homes={visibleHomes} resources={resourceFeatures} sourceStatus={sourceStatus} selectedHome={selectedMapHome || selectedHomes[0]} onSelect={setSelectedMapHome} />
      <section className="glass-panel flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl lg:min-h-0" aria-label="Candidate places"><div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/45 px-4 py-3 sm:px-5 dark:border-white/[0.08]"><div><div className="flex items-center gap-2"><h2 className="font-display text-lg font-semibold">Candidate places</h2><Badge variant="secondary"><NumberTicker value={visibleHomes.length} className="text-foreground" /></Badge></div><p className="mt-0.5 text-xs text-muted-foreground">Open a card for the source details.</p></div>{selectedHomes.length > 0 && <Button asChild size="sm" variant="soft"><Link href="/compare">{selectedHomes.length} selected <ArrowRight className="size-3.5" /></Link></Button>}</div><div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" aria-live="polite">{visibleHomes.length ? <div className="flex flex-col gap-3">{visibleHomes.map((home, index) => <HomeCard key={home.id} home={home} saved={shortlistIds.includes(home.id)} selected={selectedHomes.some((item) => item.id === home.id)} onSave={toggleShortlist} onCompare={toggleCompare} onInspect={setDetail} entranceDelay={Math.min(index * 0.075, 0.3)} />)}</div> : <Card className="grid min-h-64 place-items-center border-dashed"><CardContent className="text-center"><Baby className="mx-auto mb-3 size-8 text-primary" /><h3 className="font-display text-lg font-semibold">No places found</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Try a wider search or adjust the filters.</p><Button className="mt-5" variant="outline" onClick={resetSearch}>Reset search</Button></CardContent></Card>}</div></section>
    </div>

    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}><DialogContent overlayClassName="backdrop-blur-md" className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden bg-popover p-0 backdrop-blur-none">
      <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-14 sm:px-7"><DialogTitle>Filters</DialogTitle><DialogDescription>Set household size, budget, nearby places and priorities for this search.</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7"><BriefPanel brief={brief} setBrief={setBrief} /></div>
      <DialogFooter className="shrink-0 flex-col border-t border-border bg-background px-5 py-4 sm:flex-row sm:px-7"><Button variant="outline" className="w-full sm:w-auto" onClick={() => setFiltersOpen(false)}>Cancel</Button><Button className="w-full sm:w-auto" onClick={applyFilters}>Apply filters <ArrowRight className="size-4" /></Button></DialogFooter>
    </DialogContent></Dialog>
    <DetailDialog home={detail} onClose={() => setDetail(null)} onSave={toggleShortlist} />
  </div>;
}
