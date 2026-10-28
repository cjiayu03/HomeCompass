'use client';

import dynamic from 'next/dynamic';
import { LocateFixed, Layers3, UsersRound } from 'lucide-react';
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { MapAddressSearch } from '@/components/map-address-search';
import { distanceM } from '@/lib/planning';
import { LoadingScene } from '@/components/loading-scene';
import { getResourceDisplayName, MAP_RESOURCE_LAYERS } from '@/lib/map-resource-presentation';

class MapBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable('Your browser could not start the 3D map. The 2D map is available.');}
  render(){return this.state.failed?null:this.props.children;}
}

const MapView = dynamic(() => import('@/components/map-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Unfolding the map…" /></div> });
const Map3DView = dynamic(() => import('@/components/map-3d-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Building your 3D neighbourhood…" /></div> });

const DEFAULT_VISIBLE_RESOURCE_TYPES = ['silver_zone', 'dengue_cluster'];
const RESOURCE_GROUPS = [
  { label: 'Care & support', types: ['chas_clinic', 'dementia_gtp'] },
  { label: 'Children & learning', types: ['childcare', 'student_care', 'kindergarten', 'school_zone'] },
  { label: 'Neighbourhood safety', types: ['silver_zone', 'dengue_cluster'] },
];

function viewportLabel(bounds) {
  if (!bounds) return 'initial bounded sample; pan or zoom to load this viewport';
  return `${bounds.west.toFixed(3)}, ${bounds.south.toFixed(3)} to ${bounds.east.toFixed(3)}, ${bounds.north.toFixed(3)}`;
}

export function MapPanel({ homes, resources = [], resourceState, retryResources, sourceStatus, selectedHome, hoveredHome, onSelect, refreshViewport, viewportBounds, className }) {
  const {places,brief}=useWorkspace();
  const [reach,setReach]=useState(false);
  const [mapNotice,setMapNotice]=useState('');
  const [centerRequest, setCenterRequest] = useState(0);
  const [mapMode, setMapMode] = useState('2d');
  const [mapOptionsOpen, setMapOptionsOpen] = useState(false);
  const [addressTarget, setAddressTarget] = useState(null);
  const [addressRequest, setAddressRequest] = useState(0);
  const [addressFocused, setAddressFocused] = useState(false);
  const previousHomeId = useRef(selectedHome?.id);
  useEffect(() => {
    if (selectedHome?.id !== previousHomeId.current) setAddressFocused(false);
    previousHomeId.current = selectedHome?.id;
  }, [selectedHome?.id]);
  function selectAddress(candidate) { setAddressTarget(candidate); setAddressFocused(true); setAddressRequest(value => value + 1); }
  const fallback=useCallback(message=>{setMapNotice(message);setMapMode('2d');},[]);
  const anchors=useMemo(()=>reach?(brief.placeConstraints||[]).map(c=>{const place=places.find(p=>p.id===c.placeId);return place&&place.latitude!=null&&place.longitude!=null?{id:place.id,label:place.label,lat:Number(place.latitude),lng:Number(place.longitude),radius:Number(c.maxDistanceM)}:null;}).filter(a=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&Number.isFinite(a.radius)&&a.radius>=0):[],[reach,brief.placeConstraints,places]);
  const inReach=anchors.length?homes.filter(home=>anchors.every(a=>{const d=distanceM(a,home);return d!=null&&d<=a.radius;})).length:0;
  const nearest=useMemo(()=>!selectedHome?[]:resources.filter(f=>f.geometry?.type==='Point').map(f=>({name:getResourceDisplayName(f.properties),distance:distanceM(selectedHome,{lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]})})).filter(f=>f.distance!=null).sort((a,b)=>a.distance-b.distance).slice(0,3),[selectedHome,resources]);
  const [visibleResourceTypes, setVisibleResourceTypes] = useState(DEFAULT_VISIBLE_RESOURCE_TYPES);
  const mappedCount = homes.filter((home) => home.lat !== null && home.lat !== undefined && home.lng !== null && home.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))).length;
  const counts = resources.reduce((result, feature) => { const type = feature.properties?.resourceType; result[type] = (result[type] || 0) + 1; return result; }, {});
  const activeLayerSummary = `${visibleResourceTypes.length} of ${MAP_RESOURCE_LAYERS.length} categories shown`;
  function toggleLayer(type, checked) { setVisibleResourceTypes((current) => checked ? [...new Set([...current, type])] : current.filter((item) => item !== type)); }
  return (
    <section className={cn('relative isolate z-0 h-[clamp(360px,50dvh,440px)] min-h-0 overflow-hidden rounded-xl border bg-secondary shadow-soft lg:h-full', className)} aria-label={mapMode === '3d' ? 'Movable 3D neighborhood map' : 'Movable OpenStreetMap view'}>
      <div className="absolute inset-0 z-0">{mapMode === '3d'
        ? <MapBoundary onUnavailable={fallback}><Map3DView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onUnavailable={fallback} onSelect={onSelect} centerRequest={centerRequest} addressTarget={addressTarget} addressRequest={addressRequest} addressFocused={addressFocused} onViewportChange={refreshViewport} /></MapBoundary>
        : <MapView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onSelect={onSelect} centerRequest={centerRequest} addressTarget={addressTarget} addressRequest={addressRequest} addressFocused={addressFocused} onViewportChange={refreshViewport} />}</div>
      <MapAddressSearch selectedAddress={addressTarget} onSelect={selectAddress} onClear={() => { setAddressTarget(null); setAddressFocused(false); }} optionsOpen={mapOptionsOpen} onSearchStart={() => setMapOptionsOpen(false)} />
      <div className="pointer-events-none absolute right-0 top-0 z-10 flex items-start gap-2 p-3">
        <details className="pointer-events-auto" open={mapOptionsOpen} onToggle={event => setMapOptionsOpen(event.currentTarget.open)}>
          <summary aria-label={`Map options, ${visibleResourceTypes.length} nearby categories shown${reach ? ', family reach on' : ''}${resourceState?.status === 'error' ? ', nearby data unavailable' : ''}${mapNotice ? ', map warning' : ''}`} className="glass-card flex h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            <Layers3 aria-hidden="true" className="size-4 text-primary" />
            <span className="hidden sm:inline">Map options</span>
            <span aria-hidden="true" className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">{visibleResourceTypes.length}</span>
            {reach && <span aria-hidden="true" className="size-2 rounded-full bg-primary" />}
            {(resourceState?.status === 'error' || mapNotice) && <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />}
          </summary>
          <div className="absolute right-3 top-14 z-[80] max-h-[24rem] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border bg-popover p-3 text-popover-foreground shadow-float sm:max-h-[28rem]">
            <section aria-labelledby="map-layers-heading">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="map-layers-heading" className="text-sm font-semibold">Show nearby</h3>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{activeLayerSummary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" className="h-9 rounded-md px-2 text-xs" onClick={() => setVisibleResourceTypes(DEFAULT_VISIBLE_RESOURCE_TYPES)}>Reset</Button>
                  <Button variant="ghost" className="h-9 rounded-md px-2 text-xs" onClick={() => setVisibleResourceTypes([])}>Clear</Button>
                </div>
              </div>
              <p className="mt-1 text-xs leading-4 text-muted-foreground">Counts show this map area. Tap a count marker to zoom in.</p>
              <div className="mt-3 space-y-3">
                {RESOURCE_GROUPS.map((group) => {
                  const groupLayers = group.types.map((type) => MAP_RESOURCE_LAYERS.find((layer) => layer.type === type)).filter(Boolean);
                  const selectedCount = groupLayers.filter(({ type }) => visibleResourceTypes.includes(type)).length;
                  return (
                    <div key={group.label}>
                      <div className="mb-1 flex items-center justify-between gap-2 px-1">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h4>
                        {selectedCount > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{selectedCount} selected</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {groupLayers.map(({ type, pluralLabel, color, Icon }) => {
                          const isSelected = visibleResourceTypes.includes(type);
                          const count = counts[type] || 0;
                          return (
                            <button
                              key={type}
                              type="button"
                              aria-pressed={isSelected}
                              aria-label={`${pluralLabel}, ${count} in this map area, ${isSelected ? 'shown' : 'hidden'}`}
                              onClick={() => toggleLayer(type, !isSelected)}
                              className={cn(
                                'flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                                isSelected ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border bg-background hover:bg-secondary',
                              )}
                            >
                              <span className="grid size-6 shrink-0 place-items-center rounded-full border" style={{ borderColor: color, backgroundColor: isSelected ? color : 'transparent' }}>
                                <Icon aria-hidden="true" className="size-3.5" style={{ color: isSelected ? '#fff' : color }} />
                              </span>
                              <span className="min-w-0 flex-1 text-[11px] font-medium leading-tight">{pluralLabel}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="mt-3 border-t pt-3" aria-labelledby="map-view-heading">
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

            {resourceState?.status === 'loading' && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" role="status">Loading nearby map data…</p>}
            {resourceState?.status === 'error' && <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs" role="alert"><span>Nearby map data could not load.</span><Button variant="outline" className="h-9 rounded-lg px-3 text-xs" onClick={retryResources}>Retry</Button></div>}
          </div>
        </details>
        <Button size="icon" variant="outline" className="h-11 w-11" aria-label="Center map on Singapore" onClick={() => { setAddressTarget(null); setAddressFocused(false); setCenterRequest((value) => value + 1); }}><LocateFixed className="size-4" /></Button>
      </div>

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
