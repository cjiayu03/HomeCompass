'use client';

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
  return <div className="space-y-5 text-sm">
    <div><p className="text-muted-foreground">{home.town} · {home.type}</p><p className="mt-2 font-display text-2xl font-semibold">{money(home.price)} <span className="text-sm font-normal text-muted-foreground">recorded {home.observedOn || home.transactionDate || '(date unavailable)'}</span></p><div className="mt-2 flex flex-wrap gap-3 text-muted-foreground">{home.floorAreaSqm != null && <span>{home.floorAreaSqm} m²</span>}{home.storeyRange && <span>Storeys {home.storeyRange}</span>}{home.remainingLeaseYears != null && <span>Lease ≈ {home.remainingLeaseYears} years</span>}{home.pricePerSqm != null && <span>{money(home.pricePerSqm)} / m²</span>}</div></div>
    <div className="flex flex-wrap gap-2">{onSave && <Button onClick={() => onSave(home)} disabled={saved}>{saved ? 'On your shortlist' : 'Save to shortlist'}</Button>}{onCompare && <Button variant="outline" onClick={() => onCompare(home)} aria-pressed={selected}>{selected ? 'Remove from comparison' : 'Add to comparison'}</Button>}{onLocate && <Button variant="outline" onClick={() => onLocate(home)}>Show on map</Button>}</div>
    <section className="rounded-xl border p-4"><h3 className="font-semibold">What the loaded evidence supports</h3>{reasons.matches.length > 0 ? <ul className="mt-2 list-inside list-disc space-y-2">{reasons.matches.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p className="mt-2 text-muted-foreground">No verified matches to your criteria are available yet.</p>}<p className="mt-3 text-muted-foreground"><strong className="font-medium text-foreground">Check before deciding:</strong> {reasons.tradeoff}</p></section>
    <MatchReasons home={home} brief={brief} />
    <EvidenceContext home={home} />
    <PlaceDistanceList distances={home.placeDistances} />
    <section className="rounded-xl border p-4"><h3 className="font-semibold">Access and services</h3><dl className="mt-3 space-y-3">{[['School', home.school], ['Childcare', home.childcare], ['Care', home.care], ['Dengue context', home.risk]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1">{value || 'Unavailable in this record'}</dd></div>)}</dl><p className="mt-3 text-xs leading-6 text-muted-foreground">Distances describe straight-line proximity where verified coordinates are available. Travel times, accessible routes, service suitability, admissions and current vacancies are unavailable. Proximity does not guarantee admission.</p><div className="mt-3 flex flex-wrap gap-3"><a className="min-h-11 content-center text-primary underline" href="https://p1.placement.moe.gov.sg/" target="_blank" rel="noreferrer">Check official MOE registration guidance</a><a className="min-h-11 content-center text-primary underline" href={route} target="_blank" rel="noreferrer">Plan a route in Google Maps ↗</a></div><p className="text-xs text-muted-foreground">The route link shares only this recorded destination with Google Maps. Choose your origin there; saved personal locations are not added.</p></section>
    <AreaProfile homes={homes} home={home} />
    <AffordabilityPlanner key={home.id} initialPrice={home.price} />
  </div>;
}
