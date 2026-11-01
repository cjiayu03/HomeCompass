'use client';

import { useMemo } from 'react';
import { Bookmark, Check, CheckCircle2, MapPin, Ruler, Layers, CalendarDays, Scale, X } from 'lucide-react';
import { MatchReasons } from '@/components/search-workbench';
import { EvidenceContext } from '@/components/evidence-context';
import { candidateReasons } from '@/components/evidence-helpers';
import { AreaProfile } from '@/components/area-profile';
import { AffordabilityPlanner } from '@/components/affordability-planner';
import { PlaceDistanceList } from '@/components/place-picker';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';
import { distanceM } from '@/lib/planning';
import { mapLayers, nearbyFacilityTypes, resourceColors } from '@/lib/map-layers';
import { mapLayerIcons } from '@/lib/map-layer-icons';
import { dedupePointFeatures, facilityLocationLabel } from '@/lib/geo-cluster';
import { DengueStatus } from '@/components/dengue-status';

function distanceLabel(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function CandidateDetails({ home, homes = [], brief = {}, saved = false, selected = false, resources = [], resourceState, visibleResourceTypes = [], onToggleNearbyLayer, onEnableNearbyLayers, onShowFacilityOnMap, onRetryResources, onSave, onCompare, onLocate }) {
  const nearbyFacilities = useMemo(() => {
    if (!home) return [];
    const enabled = new Set(visibleResourceTypes.filter(type => nearbyFacilityTypes.includes(type)));
    return dedupePointFeatures(resources)
      .filter(feature => feature?.geometry?.type === 'Point' && enabled.has(feature.properties?.resourceType))
      .map(feature => {
        const [longitude, latitude] = feature.geometry.coordinates || [];
        const distance = distanceM(home, { lat: latitude, lng: longitude });
        return distance == null ? null : { feature, distance };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance);
  }, [home?.id, home?.lat, home?.lng, resources, visibleResourceTypes]);
  if (!home) return null;
  const reasons = candidateReasons(home, brief);
  const route = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${home.address}, Singapore`)}`;
  const activeNearbyTypes = nearbyFacilityTypes.filter(type => visibleResourceTypes.includes(type));
  const hasResourceCounts = Array.isArray(resourceState?.counts) && resourceState.counts.length > 0;
  const availableNearbyTypes = nearbyFacilityTypes.filter(type => {
    if (!hasResourceCounts) return true;
    const count = resourceState.counts.find(item => item.resourceType === type);
    return Boolean(count && count.total > (count.unlocated || 0));
  });
  const shownNearbyFacilities = nearbyFacilities.slice(0, 8);
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
    <section className="candidate-nearby mt-5 border-t pt-4" aria-labelledby="nearby-facilities-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="nearby-facilities-heading" className="font-semibold">Nearby facilities</h3>
          <p className="mt-1 text-xs text-muted-foreground">Individual places from the map layers you enable.</p>
        </div>
        <Button variant="outline" className="h-9 shrink-0 px-2 text-xs" onClick={onEnableNearbyLayers} disabled={!onEnableNearbyLayers || !availableNearbyTypes.some(type => !activeNearbyTypes.includes(type))}>Show all</Button>
      </div>
      <details className="mt-3 rounded-lg border bg-secondary/30 p-2" open={activeNearbyTypes.length === 0}>
        <summary className="min-h-9 cursor-pointer content-center text-xs font-medium">Facility layers · {activeNearbyTypes.length} on</summary>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {nearbyFacilityTypes.map(type => {
            const layer = mapLayers.find(([key]) => key === type);
            const Icon = mapLayerIcons[type] || MapPin;
            const enabled = visibleResourceTypes.includes(type);
            return <label key={type} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs hover:bg-secondary">
              <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={enabled} disabled={!availableNearbyTypes.includes(type) && !enabled} onChange={event => onToggleNearbyLayer?.(type, event.target.checked)} />
              <Icon aria-hidden="true" className="size-4 shrink-0" style={{ color: resourceColors[type] }} />
              <span className="min-w-0">{layer?.[1] || type}</span>
            </label>;
          })}
        </div>
      </details>
      {resourceState?.status === 'loading' && <p className="mt-3 text-xs text-muted-foreground" role="status">Loading facilities in the map area…</p>}
      {resourceState?.status === 'error' && <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-2 text-xs" role="alert"><span>Nearby facility data could not load.</span><Button variant="outline" className="h-9 px-2 text-xs" onClick={onRetryResources}>Retry</Button></div>}
      {resourceState?.status !== 'loading' && resourceState?.status !== 'error' && activeNearbyTypes.length === 0 && <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-xs"><p>{availableNearbyTypes.length ? 'Turn on facility layers to load places around this home.' : 'No facility layers have located records in the imported source data.'}</p>{availableNearbyTypes.length > 0 && <Button variant="soft" className="mt-2 h-9 px-3 text-xs" onClick={onEnableNearbyLayers}>Load nearby facilities</Button>}</div>}
      {resourceState?.status !== 'loading' && resourceState?.status !== 'error' && activeNearbyTypes.length > 0 && nearbyFacilities.length === 0 && <p className="mt-3 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">No facility points from these layers are in the loaded map area.</p>}
      {shownNearbyFacilities.length > 0 && <div className="mt-2 divide-y rounded-lg border">
        {shownNearbyFacilities.map(({ feature, distance }, index) => {
          const type = feature.properties?.resourceType;
          const layer = mapLayers.find(([key]) => key === type);
          const Icon = mapLayerIcons[type] || MapPin;
          const location = facilityLocationLabel(feature);
          const label = feature.properties?.name || 'Unnamed facility';
          return <div key={feature.id ?? `${type}-${index}`} className="flex items-center gap-2 p-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-background" style={{ borderColor: resourceColors[type], color: resourceColors[type] }}><Icon aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={label}>{label}</p>
              <p className="text-xs text-muted-foreground">{layer?.[1] || type} · {distanceLabel(distance)} straight-line</p>
              {location && <p className="truncate text-xs text-muted-foreground" title={location}>{location}</p>}
              <p className="text-[11px] text-muted-foreground">Source date: {feature.properties?.sourceVersion || 'not reported'}</p>
            </div>
            <Button variant="ghost" className="h-9 shrink-0 px-2 text-xs" aria-label={`Show ${label} on map`} onClick={() => onShowFacilityOnMap?.(feature)}><MapPin aria-hidden="true" className="size-3.5" />Show</Button>
          </div>;
        })}
      </div>}
      {nearbyFacilities.length > shownNearbyFacilities.length && <p className="mt-2 text-xs text-muted-foreground">Showing the {shownNearbyFacilities.length} closest loaded facilities.</p>}
      {activeNearbyTypes.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground">Distances are straight-line estimates. Results cover loaded map data and may be incomplete; a missing point does not confirm that no facility exists nearby.</p>}
    </section>
    <section className="candidate-services"><h3>Access and services</h3><dl className="mt-3 space-y-3">{[['School', home.school], ['Childcare', home.childcare], ['Care', home.care]].map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1">{value || 'Unavailable in this record'}</dd></div>)}</dl><div className="mt-4 border-t pt-3"><p className="mb-2 text-xs font-medium text-muted-foreground">Dengue cluster status</p><DengueStatus home={home} /></div><p className="mt-3 text-xs leading-6 text-muted-foreground">Distances describe straight-line proximity where verified coordinates are available. Travel times, accessible routes, service suitability, admissions and current vacancies are unavailable. Proximity does not guarantee admission.</p><div className="mt-3 flex flex-wrap gap-3"><a className="min-h-11 content-center text-primary underline" href="https://p1.placement.moe.gov.sg/" target="_blank" rel="noreferrer">Check official MOE registration guidance</a><a className="min-h-11 content-center text-primary underline" href={route} target="_blank" rel="noreferrer">Plan a route in Google Maps ↗</a></div><p className="text-xs text-muted-foreground">The route link shares only this recorded destination with Google Maps. Choose your origin there; saved personal locations are not added.</p></section>
    <AreaProfile homes={homes} home={home} />
    <AffordabilityPlanner key={home.id} initialPrice={home.price} />
  </div>;
}
