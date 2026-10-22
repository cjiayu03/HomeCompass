'use client';

import dynamic from 'next/dynamic';
import { Crosshair, ExternalLink, LocateFixed, Layers3 } from 'lucide-react';
import { Component, useCallback, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { distanceM } from '@/lib/planning';
import { LoadingScene } from '@/components/loading-scene';

class MapBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable('Your browser could not start the 3D map. The 2D map is available.');}
  render(){return this.state.failed?null:this.props.children;}
}

const MapView = dynamic(() => import('@/components/map-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Unfolding the map…" /></div> });
const Map3DView = dynamic(() => import('@/components/map-3d-view'), { ssr: false, loading: () => <div className="grid h-full min-h-0 place-items-center bg-background"><LoadingScene label="Building your 3D neighbourhood…" /></div> });

const mapLayers = [
  ['silver_zone', 'Silver Zones', '#68886c'], ['dementia_gtp', 'Dementia-friendly points', '#697d91'],
  ['chas_clinic', 'CHAS clinics', '#7887a2'], ['childcare', 'Child care', '#8a7898'], ['student_care', 'Student care', '#6e8b7c'],
  ['kindergarten', 'Kindergartens', '#627f90'], ['school_zone', 'School zones', '#8291a6'], ['dengue_cluster', 'Active dengue clusters', '#b65360'],
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
  const fallback=useCallback(message=>{setMapNotice(message);setMapMode('2d');},[]);
  const anchors=useMemo(()=>reach?(brief.placeConstraints||[]).map(c=>{const place=places.find(p=>p.id===c.placeId);return place&&place.latitude!=null&&place.longitude!=null?{id:place.id,label:place.label,lat:Number(place.latitude),lng:Number(place.longitude),radius:Number(c.maxDistanceM)}:null;}).filter(a=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&Number.isFinite(a.radius)&&a.radius>=0):[],[reach,brief.placeConstraints,places]);
  const inReach=anchors.length?homes.filter(home=>anchors.every(a=>{const d=distanceM(a,home);return d!=null&&d<=a.radius;})).length:0;
  const nearest=useMemo(()=>!selectedHome?[]:resources.filter(f=>f.geometry?.type==='Point').map(f=>({name:f.properties?.name||f.properties?.resourceType,distance:distanceM(selectedHome,{lng:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]})})).filter(f=>f.distance!=null).sort((a,b)=>a.distance-b.distance).slice(0,3),[selectedHome,resources]);
  const [visibleResourceTypes, setVisibleResourceTypes] = useState(['silver_zone', 'dengue_cluster']);
  const mappedCount = homes.filter((home) => home.lat !== null && home.lat !== undefined && home.lng !== null && home.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))).length;
  const visibleFeatureCount = resources.filter((feature) => visibleResourceTypes.includes(feature.properties?.resourceType)).length;
  const counts = resources.reduce((result, feature) => { const type = feature.properties?.resourceType; result[type] = (result[type] || 0) + 1; return result; }, {});
  function toggleLayer(type, checked) { setVisibleResourceTypes((current) => checked ? [...new Set([...current, type])] : current.filter((item) => item !== type)); }
  return (
    <section className={cn('relative isolate z-0 h-[clamp(360px,50dvh,440px)] min-h-0 overflow-hidden rounded-xl border bg-secondary shadow-soft lg:h-full', className)} aria-label={mapMode === '3d' ? 'Movable 3D neighborhood map' : 'Movable OpenStreetMap view'}>
      <div className="absolute inset-0 z-0">{mapMode === '3d'
        ? <MapBoundary onUnavailable={fallback}><Map3DView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onUnavailable={fallback} onSelect={onSelect} centerRequest={centerRequest} onViewportChange={refreshViewport} /></MapBoundary>
        : <MapView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} hoveredHome={hoveredHome} anchors={anchors} onSelect={onSelect} centerRequest={centerRequest} onViewportChange={refreshViewport} />}</div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3">
        <div className="glass-card pointer-events-auto rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className="size-2 rounded-full bg-primary" />{mapMode === '3d' ? '3D neighborhood' : 'OpenStreetMap'}</div>
          <div className="mt-2 inline-flex rounded-lg border bg-background/80 p-0.5" role="group" aria-label="Map view mode">
            <Button variant={mapMode === '2d' ? 'soft' : 'ghost'} className="h-11 min-w-11 px-3 text-sm" aria-pressed={mapMode === '2d'} onClick={() => setMapMode('2d')}>2D</Button>
            <Button variant={mapMode === '3d' ? 'soft' : 'ghost'} className="h-11 min-w-11 px-3 text-sm" aria-pressed={mapMode === '3d'} onClick={() => setMapMode('3d')}>3D</Button>
          </div>
          <p className="mt-1 max-w-52 text-xs leading-4 text-muted-foreground">{mapMode === '3d' ? 'Building shapes and heights are approximate.' : 'Hover a home card to locate it · drag to browse'}</p>
          {hoveredHome && (hoveredHome.lat == null || hoveredHome.lng == null || !Number.isFinite(Number(hoveredHome.lat)) || !Number.isFinite(Number(hoveredHome.lng))) && <p role="status" className="mt-2 max-w-52 text-xs">{hoveredHome.address}: map location unavailable.</p>}
          <button className="mt-2 min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-secondary" aria-pressed={reach} onClick={()=>setReach(v=>!v)}>Family reach {reach?'on':'off'}</button>
          {reach&&<p className="mt-1 max-w-52 text-[11px] leading-4 text-muted-foreground">{anchors.length?`${inReach} loaded records within all ${anchors.length} distance rings. Straight-line distances, not routes.`:'Select saved places and distance limits in Filters to draw their reach.'}</p>}
          {mapNotice&&<p role="status" className="mt-2 max-w-52 text-[11px] leading-4">{mapNotice}<button className="ml-2 underline" onClick={()=>setMapNotice('')}>Dismiss</button></p>}
        </div>
        <div className="pointer-events-auto flex gap-2">
          <details className="glass-card relative rounded-lg px-3 py-2 text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold"><Layers3 className="size-3.5 text-primary" />Layers <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px]">{visibleResourceTypes.length}</span></summary>
            <div className="absolute right-0 top-11 z-[80] w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-float">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Map layers</p>
                <div className="flex gap-2">
                  <button className="text-[10px] text-primary hover:underline" onClick={() => setVisibleResourceTypes(mapLayers.filter(([type]) => counts[type]).map(([type]) => type))}>All</button>
                  <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => setVisibleResourceTypes([])}>Clear</button>
                </div>
              </div>
              <div className="space-y-1">
                {mapLayers.map(([type, label, color]) => (
                  <label key={type} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/70">
                    <input type="checkbox" className="size-3.5 accent-primary" checked={visibleResourceTypes.includes(type)} disabled={!counts[type]} onChange={(event) => toggleLayer(type, event.target.checked)} />
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{(counts[type] || 0).toLocaleString()}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 border-t pt-2 text-[10px] leading-4 text-muted-foreground">Distances use located points in the current snapshots; route times are not provided.</p>
            </div>
          </details>
          <Button size="icon" variant="outline" aria-label="Center map on Singapore" onClick={() => setCenterRequest((value) => value + 1)}><LocateFixed className="size-4" /></Button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-3">
        <div className="glass-card pointer-events-auto max-w-[48%] rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
          {selectedHome&&<details className="mb-2 max-w-56"><summary className="cursor-pointer font-semibold text-foreground">{selectedHome.address}</summary><p className="mt-1">Nearest points in the loaded source features:</p>{nearest.length?nearest.map((r,i)=><p key={i}>{r.name}: {Math.round(r.distance)} m</p>):<p>No nearby point evidence loaded.</p>}<p className="mt-1">Straight-line estimates; viewport data may be incomplete.</p></details>}
          <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold text-foreground"><span className="size-2 rounded-full bg-primary" />Home <span className="size-2 rounded-full bg-accent-foreground" />Selected <span className="size-2 rounded-full bg-[#7887a2]" />Services <span className="size-2 rounded-full bg-[#b65360]" />Dengue</div>
          <p>{mapMode === '3d' ? 'OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors' : '© OpenStreetMap contributors'}</p>
        </div>
        <div className="glass-card pointer-events-auto flex max-w-[48%] flex-col items-end gap-1 rounded-lg px-3 py-2 text-[11px] font-medium">
          <span className="flex flex-wrap items-center gap-2"><Crosshair className="size-3.5 text-primary" />{mappedCount} mapped / {homes.length} homes <a className="text-primary hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" aria-label="OpenStreetMap attribution"><ExternalLink className="inline size-3" /></a></span>
          <span aria-live="polite" className="text-right text-[10px] text-muted-foreground">{resourceState?.status==='loading'?'Loading services…':`${visibleFeatureCount} layer features visible`}</span>
          {resourceState?.status==='error'&&<button className="text-right text-[11px] text-destructive underline" onClick={retryResources}>Service data unavailable · retry</button>}
          <a href="/sources" className="text-[10px] text-primary underline">Source dates & coverage</a>
        </div>
      </div>
    </section>
  );
}
