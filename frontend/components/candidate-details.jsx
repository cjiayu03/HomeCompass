'use client';

import { Bookmark, Check, CheckCircle2, MapPin, Ruler, Layers, CalendarDays, Scale, X } from 'lucide-react';
import { MatchReasons } from '@/components/search-workbench';
import { EvidenceContext } from '@/components/evidence-context';
import { candidateReasons } from '@/components/evidence-helpers';
import { AreaProfile } from '@/components/area-profile';
import { AffordabilityPlanner } from '@/components/affordability-planner';
import { PlaceDistanceList } from '@/components/place-picker';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';

export function CandidateDetails({ home, homes = [], brief = {}, saved = false, selected = false, onSave, onCompare, onLocate }) {
  if (!home) return null;
  const reasons = candidateReasons(home, brief);
  const route = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${home.address}, Singapore`)}`;
  const facts = [
    { label: 'Floor area', value: home.floorAreaSqm != null ? `${home.floorAreaSqm} m²` : 'Unavailable', icon: Ruler },
    { label: 'Floor band', value: home.storeyRange ? String(home.storeyRange).replace(/\s+TO\s+/i, '–') : 'Unavailable', icon: Layers },
    { label: 'Lease left', value: home.remainingLeaseYears != null ? `≈ ${home.remainingLeaseYears} years` : 'Unavailable', icon: CalendarDays },
    { label: 'Price per m²', value: home.pricePerSqm != null ? money(home.pricePerSqm) : 'Unavailable', icon: Scale },
  ];
  return <div className="candidate-details text-sm">
    <section className="candidate-overview" aria-label="Home overview">
      <p className="candidate-location"><MapPin aria-hidden="true" className="size-4" />{home.town} · {home.type}</p>
      <p className="candidate-price">{money(home.price)}</p>
      <p className="candidate-date">Recorded {home.observedOn || home.transactionDate || '(date unavailable)'}</p>
      <dl className="candidate-facts">{facts.map(({ label, value, icon: Icon }) => <div key={label}><dt><Icon aria-hidden="true" className="size-4" />{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="candidate-actions">
        {onSave && <Button onClick={() => onSave(home)} disabled={saved}>{saved ? <Check aria-hidden="true" className="size-4" /> : <Bookmark aria-hidden="true" className="size-4" />}{saved ? 'On your shortlist' : 'Save to shortlist'}</Button>}
        {onCompare && <Button variant="outline" onClick={() => onCompare(home)} aria-pressed={selected}>{selected ? <X aria-hidden="true" className="size-4" /> : <Scale aria-hidden="true" className="size-4" />}{selected ? 'Remove from comparison' : 'Add to comparison'}</Button>}
        {onLocate && <Button variant="ghost" onClick={() => onLocate(home)}><MapPin aria-hidden="true" className="size-4" />Show on map</Button>}
      </div>
    </section>
    <section className="candidate-matches"><h3>What the loaded evidence supports</h3>{reasons.matches.length > 0 ? <ul>{reasons.matches.map(reason => <li key={reason}><CheckCircle2 aria-hidden="true" className="size-4" /><span>{reason}</span></li>)}</ul> : <p className="mt-2 text-muted-foreground">No verified matches to your criteria are available yet.</p>}<p className="candidate-tradeoff"><strong>Check before deciding</strong><span>{reasons.tradeoff}</span></p></section>
    <MatchReasons home={home} brief={brief} />
    <EvidenceContext home={home} />
    <PlaceDistanceList distances={home.placeDistances} />
    <section className="candidate-services"><h3>Access and services</h3><dl className="mt-3 space-y-3">{[['School', home.school], ['Childcare', home.childcare], ['Care', home.care], ['Dengue context', home.risk]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1">{value || 'Unavailable in this record'}</dd></div>)}</dl><p className="mt-3 text-xs leading-6 text-muted-foreground">Distances describe straight-line proximity where verified coordinates are available. Travel times, accessible routes, service suitability, admissions and current vacancies are unavailable. Proximity does not guarantee admission.</p><div className="mt-3 flex flex-wrap gap-3"><a className="min-h-11 content-center text-primary underline" href="https://p1.placement.moe.gov.sg/" target="_blank" rel="noreferrer">Check official MOE registration guidance</a><a className="min-h-11 content-center text-primary underline" href={route} target="_blank" rel="noreferrer">Plan a route in Google Maps ↗</a></div><p className="text-xs text-muted-foreground">The route link shares only this recorded destination with Google Maps. Choose your origin there; saved personal locations are not added.</p></section>
    <AreaProfile homes={homes} home={home} />
    <AffordabilityPlanner key={home.id} initialPrice={home.price} />
  </div>;
}
