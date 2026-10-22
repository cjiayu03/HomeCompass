'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibreMap, Popup, setWorkerUrl } from 'maplibre-gl';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money, scoreLabel } from '@/lib/utils';
import { LoadingScene } from '@/components/loading-scene';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const BUILDING_TILES = 'https://tiles.openfreemap.org/planet';

setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());

const RESOURCE_COLORS = {
  silver_zone: '#68886c', dementia_gtp: '#697d91', chas_clinic: '#7887a2', childcare: '#8a7898',
  student_care: '#6e8b7c', kindergarten: '#627f90', moe_school: '#596f88', school_zone: '#8291a6',
  dengue_cluster: '#b65360',
};

function hasCoordinates(item) {
  return item?.lat !== null && item?.lat !== undefined
    && item?.lng !== null && item?.lng !== undefined
    && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
}

function makeHomeCollection(homes, selectedHome, hoveredHome) {
  return {
    type: 'FeatureCollection',
    features: homes.filter(hasCoordinates).map((home) => ({
      type: 'Feature',
      id: String(home.id),
      geometry: { type: 'Point', coordinates: [Number(home.lng), Number(home.lat)] },
      properties: { homeId: String(home.id), selected: home.id === selectedHome?.id, hovered:home.id===hoveredHome?.id },
    })),
  };
}

function makeResourceCollection(resources, visibleTypes) {
  return {
    type: 'FeatureCollection',
    features: resources.filter((feature) => (
      feature?.geometry && visibleTypes.includes(feature.properties?.resourceType)
    )),
  };
}

function setSourceData(map, sourceId, data) {
  const source = map.getSource(sourceId);
  if (source && typeof source.setData === 'function') source.setData(data);
}

function popupContent(title, detail, meta, sourceUrl) {
  const root = document.createElement('div');
  const heading = document.createElement('strong');
  heading.textContent = title || 'Map feature';
  root.appendChild(heading);
  for (const line of [detail, meta]) {
    if (!line) continue;
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    root.appendChild(paragraph);
  }
  try {
    const source = new URL(sourceUrl);
    if (source.protocol === 'https:' && source.hostname.endsWith('data.gov.sg')) {
      const link = document.createElement('a');
      link.href = source.href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Open official source';
      root.appendChild(link);
    }
  } catch { /* Source links are optional. */ }
  return root;
}

function reachCollection(anchors){return {type:'FeatureCollection',features:anchors.filter(a=>a.radius>0).map(a=>({type:'Feature',properties:{name:a.label},geometry:{type:'Polygon',coordinates:[Array.from({length:65},(_,i)=>{const angle=i/64*2*Math.PI;return [a.lng+Math.cos(angle)*a.radius/(111320*Math.cos(a.lat*Math.PI/180)),a.lat+Math.sin(angle)*a.radius/110574];})]}}))};}

export default function Map3DView({ homes, resources, visibleResourceTypes, selectedHome, hoveredHome, anchors=[], onUnavailable, onSelect, centerRequest, onViewportChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onViewportChangeRef = useRef(onViewportChange);
  const homesRef = useRef(homes);
  const [mapReady, setMapReady] = useState(false);
  const [mapIssue, setMapIssue] = useState('');

  const homeData = useMemo(() => makeHomeCollection(homes, selectedHome,hoveredHome), [homes, selectedHome?.id,hoveredHome?.id]);
  const resourceData = useMemo(() => makeResourceCollection(resources, visibleResourceTypes), [resources, visibleResourceTypes]);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { homesRef.current = homes; }, [homes]);
  useEffect(()=>{if(mapIssue)onUnavailable?.(mapIssue);},[mapIssue,onUnavailable]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let styleLoaded = false;
    const loadTimer = window.setTimeout(() => {
      if (!styleLoaded) setMapIssue('The 3D map did not load. Try again or switch back to 2D.');
    }, 14000);
    let map;
    try { map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [103.8198, 1.3521],
      zoom: 11,
      pitch: 48,
      bearing: -18,
      maxPitch: 70,
      canvasContextAttributes: { antialias: true },
      attributionControl: true,
    }); } catch { window.clearTimeout(loadTimer);setMapIssue('3D is unavailable in this browser. Switched to the 2D map.');return undefined; }
    mapRef.current = map;

    const reportViewport = () => {
      const bounds = map.getBounds();
      const next = {
        west: bounds.getWest(), east: bounds.getEast(),
        south: bounds.getSouth(), north: bounds.getNorth(),
      };
      if (next.west < next.east && next.south < next.north) onViewportChangeRef.current?.(next);
    };
    map.on('moveend', reportViewport);
    map.on('zoomend', reportViewport);
    map.on('error', (event) => {
      if ((!styleLoaded || event?.sourceId === 'hc-buildings') && event?.error) {
        setMapIssue('The free 3D map service is unavailable right now. Switch back to 2D and try again later.');
      }
    });

    map.once('load', () => {
      styleLoaded = true;
      window.clearTimeout(loadTimer);
      setMapIssue('');
      map.addSource('hc-reach',{type:'geojson',data:reachCollection(anchors)});
      map.addLayer({id:'hc-reach-fill',type:'fill',source:'hc-reach',paint:{'fill-color':'#42624f','fill-opacity':0.1}});
      map.addLayer({id:'hc-reach-line',type:'line',source:'hc-reach',paint:{'line-color':'#42624f','line-width':2,'line-dasharray':[3,3]}});
      map.addSource('hc-buildings', { type: 'vector', url: BUILDING_TILES });
      map.addLayer({
        id: 'hc-building-extrusions',
        source: 'hc-buildings',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
          'fill-extrusion-color': '#9db3a2',
          'fill-extrusion-height': ['to-number', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['to-number', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.84,
        },
      }, map.getStyle().layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id);

      map.addSource('hc-homes', { type: 'geojson', data: homeData });
      map.addLayer({
        id: 'hc-home-points',
        type: 'circle',
        source: 'hc-homes',
        paint: {
          'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 10, ['boolean',['get','hovered'],false],12, 7],
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#355d42', '#f9f7ef'],
          'circle-stroke-color': '#355d42',
          'circle-stroke-width': 2,
        },
      });

      map.addSource('hc-resources', { type: 'geojson', data: resourceData });
      const resourceColor = ['match', ['get', 'resourceType'], ...Object.entries(RESOURCE_COLORS).flat(), '#718096'];
      const isVisible = visibleResourceTypes.length
        ? ['in', ['get', 'resourceType'], ['literal', visibleResourceTypes]]
        : ['==', 1, 0];
      map.addLayer({
        id: 'hc-resource-polygons', type: 'fill', source: 'hc-resources',
        filter: ['all', ['==', ['geometry-type'], 'Polygon'], isVisible],
        paint: { 'fill-color': resourceColor, 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'hc-resource-lines', type: 'line', source: 'hc-resources',
        filter: ['all', ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]], isVisible],
        paint: { 'line-color': resourceColor, 'line-width': 1.5, 'line-opacity': 0.82 },
      });
      map.addLayer({
        id: 'hc-resource-points', type: 'circle', source: 'hc-resources',
        filter: ['all', ['==', ['geometry-type'], 'Point'], isVisible],
        paint: { 'circle-radius': 5, 'circle-color': resourceColor, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      });

      map.on('click', 'hc-home-points', (event) => {
        const feature = event.features?.[0];
        const home = homesRef.current.find((item) => String(item.id) === String(feature?.properties?.homeId));
        if (!home) return;
        onSelectRef.current?.(home);
        const score = home.score !== null && home.score !== undefined && Number.isFinite(Number(home.score))
          ? `${home.score}/100 · ${scoreLabel(home.score)}`
          : '';
        new Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(event.lngLat)
          .setDOMContent(popupContent(home.address, `${home.town} · ${money(home.price)}`, score))
          .addTo(map);
      });

      for (const layerId of ['hc-resource-polygons', 'hc-resource-lines', 'hc-resource-points']) {
        map.on('click', layerId, (event) => {
          const properties = event.features?.[0]?.properties || {};
          const sourceDate = properties.retrievedAt
            ? `Source snapshot: ${new Date(properties.retrievedAt).toLocaleDateString()}`
            : 'Source date unavailable';
          new Popup({ closeButton: true, maxWidth: '260px' })
            .setLngLat(event.lngLat)
            .setDOMContent(popupContent(properties.name, properties.resourceType, sourceDate, properties.sourceUrl))
            .addTo(map);
        });
      }
      for (const layerId of ['hc-home-points', 'hc-resource-polygons', 'hc-resource-lines', 'hc-resource-points']) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }

      setMapReady(true);
      const locatedHomes = homesRef.current.filter(hasCoordinates);
      if (locatedHomes.length > 1) {
        const bounds = new LngLatBounds();
        locatedHomes.forEach((home) => bounds.extend([Number(home.lng), Number(home.lat)]));
        const sameBlock = bounds.getEast() - bounds.getWest() < 0.0001
          && bounds.getNorth() - bounds.getSouth() < 0.0001;
        if (sameBlock) map.jumpTo({ center: bounds.getCenter(), zoom: 14 });
        else map.fitBounds(bounds, { padding: 54, maxZoom: 14, duration: 0 });
      } else if (locatedHomes.length === 1) {
        map.jumpTo({ center: [Number(locatedHomes[0].lng), Number(locatedHomes[0].lat)], zoom: 14 });
      }
      reportViewport();
    });

    return () => {
      window.clearTimeout(loadTimer);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // The map is initialized once per 3D-view mount; changing data updates GeoJSON sources below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map?.getSource('hc-homes')) setSourceData(map, 'hc-homes', homeData);
  }, [homeData, mapReady]);
  useEffect(()=>{if(mapReady&&mapRef.current?.getSource('hc-reach'))setSourceData(mapRef.current,'hc-reach',reachCollection(anchors));},[mapReady,anchors]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getSource('hc-resources')) return;
    setSourceData(map, 'hc-resources', resourceData);
    const isVisible = visibleResourceTypes.length
      ? ['in', ['get', 'resourceType'], ['literal', visibleResourceTypes]]
      : ['==', 1, 0];
    for (const layerId of ['hc-resource-polygons', 'hc-resource-lines', 'hc-resource-points']) {
      const geometryFilter = layerId === 'hc-resource-polygons'
        ? ['==', ['geometry-type'], 'Polygon']
        : layerId === 'hc-resource-lines'
          ? ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]]
          : ['==', ['geometry-type'], 'Point'];
      map.setFilter(layerId, ['all', geometryFilter, isVisible]);
    }
  }, [mapReady, resourceData, visibleResourceTypes]);

  useEffect(() => {
    if (!mapReady || !selectedHome || !hasCoordinates(selectedHome)) return;
    mapRef.current?.flyTo({ center: [Number(selectedHome.lng), Number(selectedHome.lat)], zoom: Math.max(mapRef.current.getZoom(), 14), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
  }, [mapReady, selectedHome?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !hasCoordinates(hoveredHome)) return;
    let preview;
    const timer = window.setTimeout(() => {
      const location = [Number(hoveredHome.lng), Number(hoveredHome.lat)];
      const point = map.project(location);
      const { clientWidth, clientHeight } = map.getContainer();
      if (point.x < 44 || point.x > clientWidth - 44 || point.y < 240 || point.y > clientHeight - 90) {
        map.easeTo({ center: location, offset: [0, 45], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300 });
      }
      preview = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 20, maxWidth: '230px' })
        .setLngLat(location)
        .setDOMContent(popupContent(hoveredHome.address, `${money(hoveredHome.price)} · ${hoveredHome.type}`, 'Historical record, not a current listing'))
        .addTo(map);
    }, 140);
    return () => { window.clearTimeout(timer); preview?.remove(); };
  }, [mapReady, hoveredHome?.id, hoveredHome?.lat, hoveredHome?.lng]);

  useEffect(() => {
    if (centerRequest) mapRef.current?.flyTo({ center: [103.8198, 1.3521], zoom: 11, pitch: 48, bearing: -18, duration: 650 });
  }, [centerRequest]);

  return <div className="relative h-full w-full">
    <div ref={containerRef} className="absolute inset-0 h-full w-full" />
    {!mapReady && !mapIssue && <div className="absolute inset-0 z-[1] grid place-items-center bg-background"><LoadingScene label="Building your 3D neighbourhood…" detail="Loading the free map and building shapes." /></div>}
    <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-background/90 shadow-md backdrop-blur" role="group" aria-label="3D map controls">
      <Button size="icon" variant="ghost" className="rounded-none" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus className="size-4" /></Button>
      <Button size="icon" variant="ghost" className="rounded-none border-t" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus className="size-4" /></Button>
      <Button size="icon" variant="ghost" className="rounded-none border-t" aria-label="Reset 3D angle" onClick={() => mapRef.current?.easeTo({ pitch: 48, bearing: -18, duration: 350 })}><RotateCcw className="size-4" /></Button>
    </div>
    {mapIssue && <div role="alert" className="absolute left-1/2 top-1/2 z-10 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background/95 p-4 text-center text-sm shadow-lg">
      {mapIssue}
    </div>}
  </div>;
}
