'use client';

import { ArrowUpRight, Baby, Bookmark, Check, HeartPulse, House, MapPin, Scale, X } from 'lucide-react';
import { memo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { money } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';
import { EvidenceContext } from '@/components/evidence-context';
import { PlaceDistanceList } from '@/components/place-picker';
import { candidateReasons } from '@/components/evidence-helpers';
import { useWorkspace } from '@/components/workspace-provider';

function AccessTile({ icon: Icon, label, value }) {
  return <div className="rounded-xl border border-white/45 bg-white/35 p-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.035]">
    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div>
    <p className="text-xs font-medium leading-5 text-foreground">{value}</p>
  </div>;
}

const BrowseHomeCard = memo(function BrowseHomeCard({ home, saved, selected, mapActive, onLocate, onSave, onCompare, onInspect, setHoveredHome, brief, compact }) {
  const reasons = candidateReasons(home, brief || {});
  const matchEvidence = <div className="mt-3 space-y-2 text-xs leading-5"><ul aria-label="Evidence-backed matches" className="space-y-1">{reasons.matches.map(reason => <li key={reason}>✓ {reason}</li>)}</ul><p className="text-muted-foreground"><span className="font-medium text-foreground">To check:</span> {reasons.tradeoff}</p></div>;
  return <article
      className="browse-home-card rounded-md border bg-card p-3 sm:p-4"
      data-selected={selected}
      data-map-active={mapActive}
      data-home-id={home.id}
      aria-current={mapActive ? 'location' : undefined}
      aria-label={`${home.address}, ${home.type}, ${money(home.price)} recorded price`}
      onMouseEnter={() => setHoveredHome?.(home)}
      onMouseLeave={() => setHoveredHome?.(null)}
      onFocusCapture={() => setHoveredHome?.(home)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHoveredHome?.(null); }}
    >
      <div className="home-row-heading">
        <div className="home-row-address"><p className="home-row-location">{home.town} <span aria-hidden="true">·</span> {String(home.type || '').replace(/ROOM/g, 'room')}</p><h3>{onLocate ? <button aria-label={`Show ${home.address} on map`} aria-pressed={mapActive} onClick={() => onLocate(home)}>{home.address}</button> : home.address}</h3></div>
        <Button variant={saved ? 'soft' : 'ghost'} className="home-row-save" aria-label={saved ? `Remove ${home.address} from shortlist` : `Save ${home.address} to shortlist`} aria-pressed={saved} onClick={() => onSave(home)}><Bookmark className={`size-4 ${saved ? 'fill-current' : ''}`} /><span>{saved ? 'Saved' : 'Save'}</span></Button>
      </div>
      <div className="home-row-price"><span>{money(home.price)}</span><span>Recorded {home.observedOn || home.transactionDate || 'date unavailable'}</span></div>
      <dl className="home-row-facts">
        {home.floorAreaSqm != null && <div><dt>Floor area</dt><dd>{home.floorAreaSqm} m²</dd></div>}
        {home.storeyRange && <div><dt>Floor band</dt><dd>{String(home.storeyRange).replace(/\s+TO\s+/i, '–')}</dd></div>}
        {home.remainingLeaseYears != null && <div><dt>Lease left</dt><dd>≈ {home.remainingLeaseYears} years</dd></div>}
      </dl>
      {!compact && matchEvidence}
      <div className="home-row-actions"><Button variant="default" onClick={() => onInspect(home)}>Details <ArrowUpRight aria-hidden="true" className="size-4" /></Button><Button variant={selected ? 'soft' : 'outline'} onClick={() => onCompare(home)} aria-pressed={selected} aria-label={selected ? `Remove ${home.address} from comparison` : `Compare ${home.address}`} title={selected ? 'Remove from comparison' : 'Add to comparison'}>{selected ? <X aria-hidden="true" className="size-4" /> : <Scale aria-hidden="true" className="size-4" />}{selected ? 'Remove' : 'Compare'}</Button></div>
      <details className="browse-evidence"><summary><span>Evidence &amp; sources</span><span className="browse-score">{Number.isFinite(home.score) ? `${home.score.toFixed(1)} / 100` : 'Score unavailable'}</span></summary>{compact && matchEvidence}<EvidenceContext home={home} className="mt-2" /></details>
    </article>;
});

export function HomeCard({ home, saved, selected, mapActive = false, onLocate, onSave, onCompare, onInspect, compact = false, variant = 'default', entranceDelay = 0 }) {
  const reduceMotion = useReducedMotion();
  const { brief, appliedBrief, setHoveredHome } = useWorkspace();
  if (variant === 'browse') return <BrowseHomeCard home={home} saved={saved} selected={selected} mapActive={mapActive} onLocate={onLocate} onSave={onSave} onCompare={onCompare} onInspect={onInspect} setHoveredHome={setHoveredHome} brief={appliedBrief || brief} compact={compact} />;
  const reasons = candidateReasons(home, appliedBrief || brief || {});
  const matchEvidence = <div className="mt-3 space-y-2 text-xs leading-5"><ul aria-label="Evidence-backed matches" className="space-y-1">{reasons.matches.map(reason => <li key={reason}>✓ {reason}</li>)}</ul><p className="text-muted-foreground"><span className="font-medium text-foreground">To check:</span> {reasons.tradeoff}</p></div>;

  return <motion.div
    layout={!reduceMotion}
    initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.975, filter: 'blur(8px)' }}
    animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
    whileHover={reduceMotion ? undefined : { y: -7, scale: 1.012 }}
    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
    transition={{ type: 'spring', stiffness: 360, damping: 25, mass: 0.7, delay: entranceDelay }}
    className="group"
    onMouseEnter={() => setHoveredHome?.(home)}
    onMouseLeave={() => setHoveredHome?.(null)}
    onFocusCapture={() => setHoveredHome?.(home)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHoveredHome?.(null); }}
  >
    <MagicCard
      className="magic-card-frame h-full rounded-2xl"
      gradientSize={260}
      gradientFrom={selected ? '#3f664b' : '#e2e9e3'}
      gradientTo={selected ? '#5d7f63' : '#829385'}
      gradientColor={selected ? 'rgba(63, 102, 75, 0.16)' : 'rgba(108, 132, 111, 0.13)'}
      borderColor={selected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
      gradientOpacity={reduceMotion ? 0 : 0.22}
    >
      <article className="relative z-40 overflow-hidden rounded-[inherit] p-4 sm:p-5" aria-label={`${home.address}, ${home.type}, ${money(home.price)} recorded price`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{home.town}</Badge><span className="rounded-md border border-border/70 bg-background/35 px-2 py-1">{home.type}</span></div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">{home.address}</h3>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-display text-2xl font-semibold tracking-tight text-foreground">{money(home.price)}</span><span className="text-xs text-muted-foreground">recorded {home.observedOn || home.transactionDate || '(date unavailable)'}</span></div>
          </div>
        </div>

        <EvidenceContext home={home} className="mt-4 w-full" />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{home.floorAreaSqm!=null&&<span>{home.floorAreaSqm} m²</span>}{home.storeyRange&&<span>Storeys {home.storeyRange}</span>}{home.remainingLeaseYears!=null&&<span>Lease ≈ {home.remainingLeaseYears} years</span>}{home.pricePerSqm!=null&&<span>{money(home.pricePerSqm)} / m²</span>}</div>
        {matchEvidence}
        {Array.isArray(home.placeDistances) && home.placeDistances.length > 0 && <div className="mt-4"><PlaceDistanceList distances={home.placeDistances} /></div>}

        {!compact && <div className="mt-4"><div className="mb-2 flex items-center justify-between text-[10px] font-medium text-muted-foreground"><span>Household access</span><span>{home.distance || 'Distance unavailable'} to a key amenity</span></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <AccessTile icon={MapPin} label="School" value={home.school || 'Location match pending'} />
          <AccessTile icon={Baby} label="Childcare" value={home.childcare || 'Location match pending'} />
          <AccessTile icon={HeartPulse} label="Care" value={home.care || 'Location match pending'} />
        </div></div>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><Badge variant="outline" className="max-w-full">{home.risk}</Badge></div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="icon" variant={saved ? 'soft' : 'ghost'} aria-label={saved ? `Remove ${home.address} from shortlist` : `Save ${home.address} to shortlist`} aria-pressed={saved} onClick={() => onSave(home)}>{saved ? <Bookmark className="size-4 fill-current" /> : <Bookmark className="size-4" />}</Button>
            {!compact && <><Button size="sm" variant="ghost" onClick={() => onInspect(home)}>Details <ArrowUpRight className="size-3.5" /></Button><Button size="sm" variant={selected ? 'soft' : 'outline'} onClick={() => onCompare(home)} aria-pressed={selected}>{selected ? <Check className="size-3.5" /> : <Scale className="size-3.5" />}{selected ? 'Selected' : 'Compare'}</Button></>}
          </div>
        </div>
      </article>
    </MagicCard>
  </motion.div>;
}
