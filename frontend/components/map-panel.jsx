'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import {
  Layers3,
  LocateFixed,
  UsersRound,
} from 'lucide-react';
import { createElement, Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { distanceM } from '@/lib/planning';
import { LoadingScene } from '@/components/loading-scene';
import { mapLayers, resourceColors, resourceLabel } from '@/lib/map-layers';
import { sourceFreshness } from '@/components/evidence-helpers';
import { DengueLayerSummary, DengueMapLegend, useDengueNow } from '@/components/dengue-status';
import { evaluateDengueSnapshot, filterCurrentDengueFeatures } from '@/lib/dengue-status';
import { MapAddressSearch } from '@/components/map-address-search';
import { hasMapCoordinates } from '@/lib/map-coordinates';
import { mapLayerIcons } from '@/lib/map-layer-icons';
import { dedupePointFeatures, facilityLocationLabel } from '@/lib/geo-cluster';
import { requestJson } from '@/lib/api-client';
import { matchHomeMapCandidate, normalizeMapAddressCandidates } from '@/lib/map-address-search';
import { selectedEvidenceLocations } from '@/lib/score-locations';

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

function newestDenguePolicy(...policies) {
  return policies.filter(policy => policy && typeof policy === 'object')
    .sort((left, right) => (Date.parse(right.checkedAt || '') || 0) - (Date.parse(left.checkedAt || '') || 0))[0] || null;
}

export function MapPanel({ controlsTarget, cameraIntent, onCameraIntent, onAddressSelected, homes, resources = [], resourceState, retryResources, sourceStatus, selectedHome, hoveredHome, onSelect, facilityFocus, visibleResourceTypes: controlledResourceTypes, onVisibleResourceTypesChange, refreshViewport, viewportBounds, onSearchArea, searchBusy = false, className }) {
  const {places,brief: currentBrief,appliedBrief,mapResourceTypes,setMapResourceTypes,sourceState}=useWorkspace();
  const brief = appliedBrief || currentBrief;
  const [reach,setReach]=useState(false);
  const [mapNotice,setMapNotice]=useState('');
  const [centerRequest, setCenterRequest] = useState(0);
  const [mapMode, setMapMode] = useState('2d');
  const [mapOptionsOpen, setMapOptionsOpen] = useState(false);
  const [addressTarget, setAddressTarget] = useState(null);
  const [addressRequest, setAddressRequest] = useState(0);
  const [resolvedHomeLocation, setResolvedHomeLocation] = useState(null);
  const [homeLocationStatus, setHomeLocationStatus] = useState(null);
  const homeLocationCache = useRef(new Map());
  const [localCameraIntent, setLocalCameraIntent] = useState({ type: 'initial', request: 0 });
  const activeCameraIntent = cameraIntent || localCameraIntent;
  const addressFocused = Boolean(addressTarget) && activeCameraIntent.type === 'address';
  const locationTarget = hoveredHome || selectedHome;
  useEffect(() => {
    setResolvedHomeLocation(null);
    setHomeLocationStatus(null);
    if (!locationTarget || hasMapCoordinates(locationTarget) || addressTarget) return undefined;

    const address = String(locationTarget.address || '').trim();
    if (!address) return undefined;
    const cacheKey = address.toLocaleUpperCase('en-SG');
    let active = true;
    let controller;
    const timer = window.setTimeout(async () => {
      setHomeLocationStatus({ id: locationTarget.id, state: 'loading' });
      try {
        let candidate = homeLocationCache.current.get(cacheKey);
        if (!homeLocationCache.current.has(cacheKey)) {
          controller = new AbortController();
          const response = await requestJson('/api/v1/map/home-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: address }),
            signal: controller.signal,
          });
          const candidates = normalizeMapAddressCandidates(response?.items);
          candidate = matchHomeMapCandidate(locationTarget, candidates);
          homeLocationCache.current.set(cacheKey, candidate || null);
        }
        if (!active) return;
        if (!candidate) {
          setHomeLocationStatus({ id: locationTarget.id, state: 'unavailable' });
          return;
        }
        setResolvedHomeLocation({
          id: locationTarget.id,
          lat: candidate.latitude,
          lng: candidate.longitude,
          mapLocationPrecision: 'block',
        });
        setHomeLocationStatus({ id: locationTarget.id, state: 'resolved' });
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        setHomeLocationStatus({ id: locationTarget.id, state: 'unavailable' });
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [locationTarget?.id, locationTarget?.address, locationTarget?.lat, locationTarget?.lng, addressTarget]);
  const resolvedTarget = resolvedHomeLocation?.id === locationTarget?.id ? resolvedHomeLocation : null;
  const mapSelectedHome = selectedHome && resolvedTarget?.id === selectedHome.id
    ? { ...selectedHome, ...resolvedTarget }
    : selectedHome;
  const mapHoveredHome = hoveredHome && resolvedTarget?.id === hoveredHome.id
    ? { ...hoveredHome, ...resolvedTarget }
    : hoveredHome;
  const visibleHomeLocationStatus = homeLocationStatus?.id === locationTarget?.id ? homeLocationStatus : null;
  const fallback=useCallback(message=>{setMapNotice(message);setMapMode('2d');},[]);
  function registerCameraIntent(type) {
    if (onCameraIntent) onCameraIntent(type);
    else setLocalCameraIntent((current) => ({ type, request: current.request + 1 }));
  }
  function selectAddress(candidate) {
    setAddressTarget(candidate);
    registerCameraIntent('address');
    setAddressRequest((value) => value + 1);
    onAddressSelected?.();
  }
  const anchors=useMemo(()=>reach?(brief.placeConstraints||[]).map(c=>{const place=places.find(p=>p.id===c.placeId);return place&&place.latitude!=null&&place.longitude!=null?{id:place.id,label:place.label,lat:Number(place.latitude),lng:Number(place.longitude),radius:Number(c.maxDistanceM)}:null;}).filter(a=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lng)&&Number.isFinite(a.radius)&&a.radius>=0):[],[reach,brief.placeConstraints,places]);
  const inReach=anchors.length?homes.filter(home=>anchors.every(a=>{const d=distanceM(a,home);return d!=null&&d<=a.radius;})).length:0;
  const [localVisibleResourceTypes, setLocalVisibleResourceTypes] = useState(() => mapResourceTypes || ['silver_zone']);
  const visibleResourceTypes = controlledResourceTypes ?? localVisibleResourceTypes;
  const evidenceLocations = useMemo(() => selectedEvidenceLocations(mapSelectedHome, places), [mapSelectedHome, places]);
  const [routeState, setRouteState] = useState({ key: '', routes: {}, loading: false });
  const routeCache = useRef(new Map());
  const routeKey = JSON.stringify([mapSelectedHome?.id, mapSelectedHome?.lat, mapSelectedHome?.lng, evidenceLocations.map(item => [item.id, item.lat, item.lng])]);
  useEffect(() => {
    if (!hasMapCoordinates(mapSelectedHome) || !evidenceLocations.length) {
      setRouteState({ key: routeKey, routes: {}, loading: false });
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setRouteState({ key: routeKey, routes: {}, loading: true });
    Promise.all(evidenceLocations.map(async item => {
      const body = { start_lat: Number(mapSelectedHome.lat), start_lng: Number(mapSelectedHome.lng), end_lat: Number(item.lat), end_lng: Number(item.lng) };
      const key = JSON.stringify(body);
      try {
        let route = routeCache.current.get(key);
        if (!route) {
          route = await requestJson('/api/v1/map/walking-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
          if (!Array.isArray(route.coordinates) || route.coordinates.length < 2 || !route.coordinates.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) throw new Error('Invalid route');
          if (routeCache.current.size >= 100) routeCache.current.delete(routeCache.current.keys().next().value);
          routeCache.current.set(key, route);
        }
        return [item.id, route];
      } catch { return [item.id, null]; }
    })).then(entries => { if (active) setRouteState({ key: routeKey, routes: Object.fromEntries(entries), loading: false }); });
    return () => { active = false; controller.abort(); };
  }, [routeKey]);
  const routedEvidenceLocations = useMemo(() => evidenceLocations.map(item => ({ ...item, route: routeState.key === routeKey ? routeState.routes[item.id] : null })), [evidenceLocations, routeState, routeKey]);
  const dengueSource = sourceStatus?.items?.find(source => source.resourceType === 'dengue_cluster');
  const denguePolicy = newestDenguePolicy(resourceState?.dengue, dengueSource?.dengue);
  const dengueNow = useDengueNow(denguePolicy?.validUntil);
  const currentDenguePolicy = evaluateDengueSnapshot(denguePolicy, dengueNow);
  const currentResources = useMemo(() => filterCurrentDengueFeatures(resources, denguePolicy, dengueNow), [resources, denguePolicy, dengueNow]);
  const nearest=useMemo(()=>!mapSelectedHome?[]:dedupePointFeatures(currentResources).filter(f=>f.geometry?.type==='Point'&&visibleResourceTypes.includes(f.properties?.resourceType)).map(feature=>({feature,name:feature.properties?.name||resourceLabel(feature.properties?.resourceType),distance:distanceM(mapSelectedHome,{lng:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1]})})).filter(f=>f.distance!=null).sort((a,b)=>a.distance-b.distance).slice(0,3),[mapSelectedHome,currentResources,visibleResourceTypes]);
  const mappedCount = homes.filter(hasMapCoordinates).length;
  const unlocatedCount = Math.max(0, homes.length - mappedCount);
  const counts = currentResources.reduce((result, feature) => { const type = feature.properties?.resourceType; result[type] = (result[type] || 0) + 1; return result; }, {});
  const availableCounts = resourceState?.counts?.length ? Object.fromEntries(resourceState.counts.map(item => [item.resourceType, Math.max(0, item.total - (item.unlocated || 0))])) : counts;
  availableCounts.dengue_cluster = currentDenguePolicy.usable ? Number(currentDenguePolicy.rows) || 0 : 0;
  function selectLayers(types) {
    if (onVisibleResourceTypesChange) onVisibleResourceTypesChange(types);
    else {
      setLocalVisibleResourceTypes(types);
      setMapResourceTypes?.(types);
    }
  }
  function toggleLayer(type, checked) { selectLayers(checked ? [...new Set([...visibleResourceTypes, type])] : visibleResourceTypes.filter(item => item !== type)); }
  const mapControls = (
<div className="map-tools pointer-events-none absolute right-0 top-0 z-10 flex items-start gap-2 p-3">
        <details className="pointer-events-auto" open={mapOptionsOpen} onToggle={(event) => setMapOptionsOpen(event.currentTarget.open)}>
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
                  const LayerIcon = mapLayerIcons[type] || LocateFixed;
                  const source = sourceStatus?.items?.find(item => item.resourceType === type);
                  const review = sourceFreshness(source);
                  return (
                  <label key={type} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-secondary/70">
                    <input type="checkbox" className="size-4 accent-primary" checked={visibleResourceTypes.includes(type)} disabled={type !== 'dengue_cluster' && !availableCounts[type]} onChange={(event) => toggleLayer(type, event.target.checked)} />
                    <LayerIcon aria-hidden="true" className="size-4 shrink-0" style={{ color }} strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 text-xs">
                      {type === 'dengue_cluster' ? 'Dengue clusters' : label}
                      {['community_club', 'eldercare', 'park_facility'].includes(type) && review.state === 'unavailable' && <span className="mt-1 block text-muted-foreground">Data unavailable</span>}
                      {type === 'dengue_cluster' && <DengueLayerSummary policy={denguePolicy} now={dengueNow} />}
                    </span>
                    <span className="text-xs text-muted-foreground">{(availableCounts[type] || 0).toLocaleString()}</span>
                  </label>
                ); })}
              </div>
            </section>

            <details className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">About map data</summary>
              <div className="mt-2 space-y-2 leading-5">
                <p>Counts are located records in the imported source snapshots. Markers show the loaded map area.</p>
                {unlocatedCount > 0 && <p>{mappedCount} of {homes.length} loaded records have map locations; {unlocatedCount} are omitted until verified coordinates are available.</p>}
                <p>MOH eldercare covers eldercare services, not all health facilities.</p>
                {['community_club', 'eldercare', 'park_facility'].map(type => {
                  const source = sourceStatus?.items?.find(item => item.resourceType === type);
                  const review = sourceFreshness(source);
                  return <p key={type}>{resourceLabel(type)}: {review.label}{source?.sourceUpdatedAt ? ` · ${source.sourceUpdatedAt.slice(0, 10)}` : ''}.</p>;
                })}
                {currentDenguePolicy.reason && <p>Dengue: {currentDenguePolicy.reason}</p>}
              </div>
            </details>
            {resourceState?.hasMore && <p className="mt-2 text-xs leading-4 text-muted-foreground" role="status">Zoom in to load more facilities.</p>}
            {resourceState?.status === 'loading' && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" role="status">Loading nearby map data…</p>}
            {resourceState?.status === 'error' && <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs" role="alert"><span>{resources.length ? "Update failed; showing previous results. " : "Nearby map data could not load. "}{resourceState.error?.message}</span><Button variant="outline" className="h-9 rounded-lg px-3 text-xs" aria-label="Retry resource data" onClick={retryResources}>Retry</Button></div>}
          </div>
        </details>
        <Button size="icon" variant="outline" className="pointer-events-auto h-11 w-11" aria-label="Center map on Singapore" onClick={() => { setAddressTarget(null); registerCameraIntent('reset'); setCenterRequest((value) => value + 1); }}><LocateFixed className="size-4" /></Button>
      </div>
  );
  return (
    <section className={cn('relative isolate z-0 h-[clamp(360px,50dvh,440px)] min-h-0 overflow-hidden rounded-xl border bg-secondary shadow-soft lg:h-full', className)} aria-label={mapMode === '3d' ? 'Movable 3D neighborhood map' : 'Movable OpenStreetMap view'}>
      <div className="absolute inset-0 z-0">{mapMode === '3d'
        ? <MapBoundary onUnavailable={fallback}><Map3DView homes={homes} resources={currentResources} visibleResourceTypes={visibleResourceTypes} denguePolicy={denguePolicy} dengueNow={dengueNow} selectedHome={mapSelectedHome} evidenceLocations={routedEvidenceLocations} hoveredHome={mapHoveredHome} anchors={anchors} onUnavailable={fallback} onSelect={onSelect} cameraIntent={activeCameraIntent} homeFocusRequest={activeCameraIntent.type === 'home' ? activeCameraIntent.request : 0} facilityFocus={facilityFocus} centerRequest={centerRequest} addressTarget={addressTarget} addressRequest={addressRequest} addressFocused={addressFocused} onViewportChange={refreshViewport} /></MapBoundary>
        : <MapView homes={homes} resources={currentResources} visibleResourceTypes={visibleResourceTypes} denguePolicy={denguePolicy} dengueNow={dengueNow} selectedHome={mapSelectedHome} evidenceLocations={routedEvidenceLocations} hoveredHome={mapHoveredHome} anchors={anchors} onSelect={onSelect} cameraIntent={activeCameraIntent} homeFocusRequest={activeCameraIntent.type === 'home' ? activeCameraIntent.request : 0} facilityFocus={facilityFocus} centerRequest={centerRequest} addressTarget={addressTarget} addressRequest={addressRequest} addressFocused={addressFocused} onViewportChange={refreshViewport} />}</div>
      {(unlocatedCount > 0 || visibleHomeLocationStatus || (mapSelectedHome && !addressTarget) || visibleResourceTypes.includes('dengue_cluster')) && <div data-testid="map-evidence-overlays" className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex max-h-[calc(100%-4rem)] flex-col gap-2 overflow-y-auto sm:max-h-none sm:flex-row sm:items-end sm:justify-between sm:overflow-visible">
        <div className="pointer-events-none flex min-w-0 flex-col items-start gap-2 sm:max-w-[min(24rem,calc(50%-0.5rem))]">
          {unlocatedCount > 0 && <p role="status" aria-label="Map location coverage" className="glass-card max-w-full rounded-lg px-3 py-2 text-xs leading-4 text-foreground shadow-soft">{mappedCount} of {homes.length} loaded records have map locations. {unlocatedCount} lack verified coordinates, so they cannot appear as pins yet.</p>}
          {visibleHomeLocationStatus && <p role="status" className="glass-card max-w-full rounded-lg px-3 py-2 text-xs leading-4 text-foreground shadow-soft">
            {visibleHomeLocationStatus.state === 'loading' && `Finding ${locationTarget.address} on the map…`}
            {visibleHomeLocationStatus.state === 'resolved' && `Approximate block location shown for ${locationTarget.address}.`}
            {visibleHomeLocationStatus.state === 'unavailable' && `No verified block location found for ${locationTarget.address}.`}
          </p>}
          {mapSelectedHome && !addressTarget && <details key={mapSelectedHome.id} data-testid="selected-home-map-summary" className="score-map-legend glass-card pointer-events-auto w-fit max-w-full rounded-lg px-3 py-2 text-xs">
            <summary className="min-h-8 cursor-pointer font-semibold text-foreground">{evidenceLocations.length ? `${evidenceLocations.length} supporting location${evidenceLocations.length === 1 ? '' : 's'}` : 'Score locations'}{evidenceLocations.length > 0 && (routeState.loading || routeState.key !== routeKey ? ' · Loading routes' : Object.values(routeState.routes).some(route => !route) ? ' · Routes unavailable' : '')}</summary>
            <div className="max-h-44 overflow-y-auto overscroll-contain"><p className="mb-2 text-muted-foreground">{mapSelectedHome.address}</p>
              {evidenceLocations.length ? <ul className="space-y-2">{evidenceLocations.map(item => <li key={item.id} className="flex gap-2"><span aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: item.color }}>{createElement(mapLayerIcons[item.resourceType] || LocateFixed, { className: 'size-4' })}</span><div><p className="font-medium">{item.name}</p><p className="text-muted-foreground">{item.label} · {Number.isFinite(item.distanceM) ? `${Math.round(item.distanceM).toLocaleString()} m` : 'Distance unavailable'}</p><p className="text-muted-foreground">{item.context}</p></div></li>)}</ul> : <p className="text-muted-foreground">{Array.isArray(mapSelectedHome.scoreLocations) ? 'No mapped amenity evidence is available for this record.' : 'Reload results to see the locations supporting this score.'}</p>}
              <p className="mt-2 font-medium">Nearest places in enabled layers:</p>
              {nearest.length ? nearest.map(({ feature, name, distance }, index) => {
                const type = feature.properties?.resourceType;
                const LayerIcon = mapLayerIcons[type] || LocateFixed;
                const location = facilityLocationLabel(feature);
                return <div key={feature.id ?? index} className="mt-1 flex items-start gap-1.5">
                  <LayerIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" style={{ color: resourceColors[type] }} />
                  <span>{name} · {resourceLabel(type)} · {Math.round(distance)} m{location ? ` · ${location}` : ''}</span>
                </div>;
              }) : <p>Turn on facility layers in Map options to see places near this home.</p>}
              <p className="mt-2 text-muted-foreground">{routeState.loading ? 'Loading walking routes…' : Object.values(routeState.routes).some(route => !route) ? 'Some walking routes are unavailable.' : 'Paths show OneMap walking routes.'} Score distances remain straight-line. On the 2D map, overlapping markers are spaced apart and linked to their actual locations.</p></div>
          </details>}
        </div>
        {visibleResourceTypes.includes('dengue_cluster') && <div className="pointer-events-auto w-full max-w-[min(22rem,100%)] self-end sm:w-auto">
          <DengueMapLegend policy={denguePolicy} now={dengueNow} visibleFeatureCount={currentResources.filter(feature => feature.properties?.resourceType === 'dengue_cluster').length} nationalRowCount={currentDenguePolicy.usable ? Number(currentDenguePolicy.rows) || 0 : null} sourceLoading={sourceState?.status === 'loading' || resourceState?.status === 'loading'} sourceError={sourceState?.status === 'error' || resourceState?.status === 'error'} />
        </div>}
      </div>}
      {onSearchArea && <div className="map-search-area-control absolute left-3 top-3 z-10"><Button variant="outline" disabled={searchBusy || !viewportBounds} onClick={onSearchArea}>{searchBusy ? 'Searching…' : 'Search this area'}</Button></div>}
      {controlsTarget
        ? createPortal(<MapAddressSearch selectedAddress={addressTarget} onSelect={selectAddress} onClear={() => setAddressTarget(null)} optionsOpen={mapOptionsOpen} onSearchStart={() => setMapOptionsOpen(false)} />, controlsTarget)
        : <MapAddressSearch selectedAddress={addressTarget} onSelect={selectAddress} onClear={() => setAddressTarget(null)} optionsOpen={mapOptionsOpen} onSearchStart={() => setMapOptionsOpen(false)} />}
      {controlsTarget ? createPortal(mapControls, controlsTarget) : mapControls}

    </section>
  );
}
