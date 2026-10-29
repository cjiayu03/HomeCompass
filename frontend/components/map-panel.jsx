'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { LocateFixed, Layers3, UsersRound } from 'lucide-react';
import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { distanceM } from '@/lib/planning';
import { LoadingScene } from '@/components/loading-scene';
import { mapLayers } from '@/lib/map-layers';
import { sourceFreshness } from '@/components/evidence-helpers';

class MapBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable('Your browser could not start the 3D map. The 2D map is available.');}
  render(){return this.state.failed?null:this.props.children;}
}

const MapView = dynamic(() => import('@/components/map-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Unfolding the map…" /></div> });
const Map3DView = dynamic(() => import('@/components/map-3d-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Building your 3D neighbourhood…" /></div> });

function viewportLabel(bounds) {
  if (!bounds) return 'initial bounded sample; pan or zoom to load this viewport';
  return `${bounds.west.toFixed(3)}, ${bounds.south.toFixed(3)} to ${bounds.east.toFixed(3)}, ${bounds.north.toFixed(3)}`;
}

export function MapPanel({ controlsTarget, homes, resources = [], resourceState, retryResources, sourceStatus, selectedHome, hoveredHome, onSelect, refreshViewport, viewportBounds, onSearchArea, searchBusy = false, className }) {
  const {places,brief: currentBrief,appliedBrief,mapResourceTypes,setMapResourceTypes}=useWorkspace();
  const brief = appliedBrief || currentBrief;
  const [reach,setReach]=useState(false);
  const [mapNotice,setMapNotice]=useState('');
  const [centerRequest, setCenterRequest] = useState(0);
  const [mapMode, setMapMode] = useState('2d');
  const fallback=useCallback(message=>{setMapNotice(message);setMapMode('2d');},[]);
  const anchors=useMemo(()=>reach?(brief.placeConstraints||[]).map(c=>{const place=places.find(p=>p.id===c.placeId);return place&&place.latitude!=null&&place.longitude!=null?{id:place.id,label:place.label,lat:Number(place.latitude),lng:Number(place.longitude),radius:Number(c.maxDistanceM)}:null;}).filter(a=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&Number.isFinite(a.radius)&&a.radius>=0):[],[reach,brief.placeConstraints,places]);
  const inReach=anchors.length?homes.filter(home=>anchors.every(a=>{const d=distanceM(a,home);return d!=null&&d<=a.radius;})).length:0;
  const nearest=useMemo(()=>!selectedHome?[]:resources.filter(f=>f.geometry?.type==='Point').map(f=>({name:f.properties?.name||f.properties?.resourceType,distance:distanceM(selectedHome,{lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]})})).filter(f=>f.distance!=null).sort((a,b)=>a.distance-b.distance).slice(0,3),[selectedHome,resources]);
  const [visibleResourceTypes, setVisibleResourceTypes] = useState(() => mapResourceTypes || ['silver_zone']);
  const dengueSource = sourceStatus?.items?.find(source => source.resourceType === 'dengue_cluster');
  const dengueReview = sourceFreshness(dengueSource);
  const mappedCount = homes.filter((home) => home.lat !== null && home.lat !== undefined && home.lng !== null && home.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))).length;
  const counts = resources.reduce((result, feature) => { const type = feature.properties?.resourceType; result[type] = (result[type] || 0) + 1; return result; }, {});
  const availableCounts = resourceState?.counts?.length ? Object.fromEntries(resourceState.counts.map(item => [item.resourceType, Math.max(0, item.total - (item.unlocated || 0))])) : counts;
  function selectLayers(types) { setVisibleResourceTypes(types); setMapResourceTypes?.(types); }
  function toggleLayer(type, checked) { selectLayers(checked ? [...new Set([...visibleResourceTypes, type])] : visibleResourceTypes.filter(item => item !== type)); }
  const [compactViewport, setCompactViewport] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompactViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const mapControls = (
<div className="map-tools pointer-events-none absolute right-0 top-0 z-10 flex items-start gap-2 p-3">
        <details className="pointer-events-auto">
          <summary aria-label={`Map options${reach ? ', family reach on' : ''}${resourceState?.status === 'error' ? ', nearby data unavailable' : ''}${mapNotice ? ', map warning' : ''}`} className="glass-card flex h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <Layers3 aria-hidden="true" className="size-4 text-primary" />
            <span className="map-options-label">Map options</span>
            {reach && <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">Reach on</span>}
            {(resourceState?.status === 'error' || mapNotice) && <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />}
          </summary>
          <div className="absolute right-3 top-14 z-[80] max-h-[17rem] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border bg-popover p-3 text-popover-foreground shadow-float sm:max-h-[20rem]">
            <section aria-labelledby="map-view-heading">
              <h3 id="map-view-heading" className="mb-2 text-sm font-semibold">Map view</h3>
              <div className="grid grid-cols-2 gap-1 rounded-lg border bg-secondary/50 p-1" role="group" aria-label="Map view mode">
                <Button variant={mapMode === '2d' ? 'soft' : 'ghost'} className="h-11 w-full rounded-lg px-3 text-sm" aria-pressed={mapMode === '2d'} onClick={() => setMapMode('2d')}>2D</Button>
                <Button variant={mapMode === '3d' ? 'soft' : 'ghost'} className="h-11 w-full rounded-lg px-3 text-sm" aria-pressed={mapMode === '3d'} onClick={() => setMapMode('3d')}>3D</Button>
              </div>
              {mapMode === '3d' && <p className="mt-1 text-xs leading-4 text-muted-foreground">Building shapes and heights are approximate.</p>}
              {mapNotice && <div className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 p-2 text-xs leading-4" role="status"><span>{mapNotice}</span><Button variant="link" size="sm" className="ml-2 h-8 px-1 text-xs" onClick={() => setMapNotice('')}>Dismiss</Button></div>}
              {mappedCount < homes.length && <p className="mt-2 text-xs leading-4 text-muted-foreground" role="status">{mappedCount} of {homes.length} homes have map locations.</p>}
            </section>

            <section className="mt-3 border-t pt-3" aria-labelledby="family-reach-heading">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 id="family-reach-heading" className="text-sm font-semibold">Family reach</h3>
                  <p className="text-xs text-muted-foreground">Distance rings from saved places</p>
                </div>
                <Button variant={reach ? 'soft' : 'outline'} className="h-11 min-w-20 rounded-lg px-3 text-sm" aria-pressed={reach} onClick={() => setReach((value) => !value)}>
                  <UsersRound aria-hidden="true" className="size-4" />{reach ? 'On' : 'Off'}
                </Button>
              </div>
              {reach && <p className="mt-2 text-xs leading-4 text-muted-foreground">{anchors.length ? `${inReach} loaded records within all ${anchors.length} distance rings. Straight-line distances, not routes.` : 'Select saved places and distance limits in Filters to draw their reach.'}</p>}
            </section>

            <section className="mt-3 border-t pt-3" aria-labelledby="map-layers-heading">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h3 id="map-layers-heading" className="text-sm font-semibold">Nearby layers</h3>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="h-11 rounded-md px-2 text-xs" onClick={() => selectLayers(mapLayers.filter(([type]) => availableCounts[type]).map(([type]) => type))}>All</Button>
                  <Button variant="ghost" className="h-11 rounded-md px-2 text-xs" onClick={() => selectLayers([])}>Clear</Button>
                </div>
              </div>
              <div className="space-y-0.5">
                {mapLayers.map(([type, label, color]) => {
                  const source = sourceStatus?.items?.find(item => item.resourceType === type);
                  const review = sourceFreshness(source);
                  return (
                  <label key={type} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-secondary/70">
                    <input type="checkbox" className="size-4 accent-primary" checked={visibleResourceTypes.includes(type)} disabled={!availableCounts[type]} onChange={(event) => toggleLayer(type, event.target.checked)} />
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1 text-xs">{label}{['community_club', 'eldercare', 'park_facility'].includes(type) && <span className="mt-1 block text-xs text-muted-foreground">{review.label}{source?.sourceUpdatedAt && <> · <time className="whitespace-nowrap" dateTime={source.sourceUpdatedAt}>{source.sourceUpdatedAt.slice(0, 10)}</time></>}</span>}{type === 'eldercare' && <span className="mt-1 block text-xs text-muted-foreground">Eldercare only; other health facilities are not included.</span>}{type === 'dengue_cluster' && <span className="mt-1 block text-xs text-muted-foreground">{dengueReview.label} · updated {dengueSource?.sourceUpdatedAt || dengueSource?.version || 'unknown'}. Snapshot does not establish current risk.</span>}</span>
                    <span className="text-xs text-muted-foreground">{(availableCounts[type] || 0).toLocaleString()}</span>
                  </label>
                ); })}
              </div>
            </section>

            <p className="mt-3 text-xs leading-4 text-muted-foreground">Counts are located records in the imported source snapshots. Markers show the loaded map area.</p>
            {resourceState?.hasMore && <p className="mt-2 text-xs leading-4 text-muted-foreground" role="status">Some enabled layers exceed the map limit. Zoom in to see more local facilities.</p>}
            {resourceState?.status === 'loading' && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" role="status">Loading nearby map data…</p>}
            {resourceState?.status === 'error' && <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs" role="alert"><span>{resources.length ? "Update failed; showing previous results. " : "Nearby map data could not load. "}{resourceState.error?.message}</span><Button variant="outline" className="h-9 rounded-lg px-3 text-xs" aria-label="Retry resource data" onClick={retryResources}>Retry</Button></div>}
          </div>
        </details>
        <Button size="icon" variant="outline" className="h-11 w-11" aria-label="Center map on Singapore" onClick={() => setCenterRequest((value) => value + 1)}><LocateFixed className="size-4" /></Button>
      </div>
  );
  return (
    <section className={cn('relative isolate z-0 h-[clamp(360px,50dvh,440px)] min-h-0 overflow-hidden rounded-xl border bg-secondary shadow-soft lg:h-full', className)} aria-label={mapMode === '3d' ? 'Movable 3D neighborhood map' : 'Movable OpenStreetMap view'}>
      <div className="absolute inset-0 z-0">{mapMode === '3d'
        ? <MapBoundary onUnavailable={fallback}><Map3DView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onUnavailable={fallback} onSelect={onSelect} centerRequest={centerRequest} onViewportChange={refreshViewport} /></MapBoundary>
        : <MapView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onSelect={onSelect} centerRequest={centerRequest} onViewportChange={refreshViewport} />}</div>
      {onSearchArea && <div className="absolute left-3 top-3 z-10"><Button variant="outline" disabled={searchBusy || !viewportBounds} onClick={onSearchArea}>{searchBusy ? 'Searching…' : 'Search this area'}</Button></div>}
      {compactViewport && controlsTarget ? createPortal(mapControls, controlsTarget) : mapControls}

      {selectedHome && <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(24rem,calc(100%-1.5rem))]">
        <details className="glass-card pointer-events-auto rounded-lg px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">{selectedHome.address}</summary>
          <p className="mt-1">Nearest points in the loaded source features:</p>
          {nearest.length ? nearest.map((resource, index) => <p key={index}>{resource.name}: {Math.round(resource.distance)} m</p>) : <p>No nearby point evidence loaded.</p>}
          <p className="mt-1">Straight-line estimates; viewport data may be incomplete.</p>
        </details>
      </div>}
    </section>
  );
}
