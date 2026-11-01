'use client';

import { resourceColors as RESOURCE_COLORS, resourceLabel } from '@/lib/map-layers';
import { evidenceCollection } from '@/lib/score-locations';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker as MapLibreMarker, Popup, setWorkerUrl } from 'maplibre-gl';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money, scoreLabel } from '@/lib/utils';
import { LoadingScene } from '@/components/loading-scene';
import { isMapAddressCandidate } from '@/lib/map-address-search';
import { hasMapCoordinates } from '@/lib/map-coordinates';
import { selectedHomeZoom } from '@/lib/map-zoom';
import { mapLayerMarkerSvg } from '@/lib/map-layer-icons';
import { dedupePointFeatures } from '@/lib/geo-cluster';
import { dengueSeverityColors, mapFeatureRevision } from '@/lib/map-layers';
import { filterCurrentDengueFeatures, evaluateDengueSnapshot } from '@/lib/dengue-status';
import { mapResourcePopupContent } from '@/lib/map-resource-popup';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const BUILDING_TILES = 'https://tiles.openfreemap.org/planet';
const INITIAL_CAMERA_INTENT = Object.freeze({ type: 'initial', request: 0 });

setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());



function makeHomeCollection(homes, selectedHome, hoveredHome) {
  const locatedHomes = new Map(homes.filter(hasMapCoordinates).map((home) => [String(home.id), home]));
  for (const home of [selectedHome, hoveredHome]) {
    if (hasMapCoordinates(home)) locatedHomes.set(String(home.id), home);
  }
  return {
    type: 'FeatureCollection',
    features: [...locatedHomes.values()].map((home) => ({
      type: 'Feature',
      id: String(home.id),
      geometry: { type: 'Point', coordinates: [Number(home.lng), Number(home.lat)] },
      properties: { homeId: String(home.id), selected: home.id === selectedHome?.id, hovered:home.id===hoveredHome?.id },
    })),
  };
}

function makeResourceCollection(resources, visibleTypes, denguePolicy, dengueNow) {
  return {
    type: 'FeatureCollection',
    features: dedupePointFeatures(filterCurrentDengueFeatures(resources, denguePolicy, dengueNow).filter((feature) => (
      feature?.geometry && visibleTypes.includes(feature.properties?.resourceType)
    ))),
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

function visibleResourceFilter(types) {
  return types.length
    ? ['in', ['get', 'resourceType'], ['literal', types]]
    : ['==', 1, 0];
}

function loadResourceIconImages(map, isCurrent) {
  return Promise.all(Object.keys(RESOURCE_COLORS).map((type) => new Promise((resolve) => {
    const imageId = `hc-resource-icon-${type}`;
    if (map.hasImage?.(imageId)) {
      resolve(type);
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      if (!isCurrent()) {
        resolve(null);
        return;
      }
      try {
        map.addImage(imageId, image, { pixelRatio: 2 });
        resolve(type);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mapLayerMarkerSvg(type))}`;
  })));
}

function bindResourceInteractions(map, layerIds, activePopupRef, activePopupDengueRef) {
  for (const layerId of layerIds) {
    map.on('click', layerId, (event) => {
      const feature = event.features?.[0];
      const properties = feature?.properties || {};
      activePopupRef.current?.remove();
      const content = mapResourcePopupContent({ ...feature, properties });
      const popup = new Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
      activePopupRef.current = popup;
      activePopupDengueRef.current = properties.resourceType === 'dengue_cluster';
      if (activePopupDengueRef.current) content.addEventListener('toggle', () => {
        if (activePopupRef.current === popup) popup.setLngLat(event.lngLat);
      }, true);
    });
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
  }
}

function reachCollection(anchors){return {type:'FeatureCollection',features:anchors.filter(a=>a.radius>0).map(a=>({type:'Feature',properties:{name:a.label},geometry:{type:'Polygon',coordinates:[Array.from({length:65},(_,i)=>{const angle=i/64*2*Math.PI;return [a.lng+Math.cos(angle)*a.radius/(111320*Math.cos(a.lat*Math.PI/180)),a.lat+Math.sin(angle)*a.radius/110574];})]}}))};}

function visibleMapOffset(map) {
  const container = map.getContainer();
  const width = container.clientWidth || container.getBoundingClientRect().width;
  const desk = container.closest('.explore-desk');
  const sidebar = desk?.querySelector('.map-research-sidebar[data-state="open"]');
  const details = desk?.querySelector('.map-record-details');
  const leftInset = sidebar?.getBoundingClientRect().width || 0;
  const rightInset = details?.getBoundingClientRect().width || 0;
  if (!width || width - leftInset - rightInset < 160) return [0, 0];
  const visibleCenterX = (leftInset + width - rightInset) / 2;
  return [visibleCenterX - width / 2, 0];
}

export default function Map3DView({ homes, resources, visibleResourceTypes, denguePolicy, dengueNow = Date.now(), selectedHome, evidenceLocations = [], hoveredHome, anchors=[], onUnavailable, onSelect, cameraIntent = INITIAL_CAMERA_INTENT, homeFocusRequest = 0, facilityFocus, centerRequest, addressTarget, addressRequest, addressFocused = false, onViewportChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const activePopupRef = useRef(null);
  const activePopupDengueRef = useRef(false);
  const previousDengueDataRevisionRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onViewportChangeRef = useRef(onViewportChange);
  const homesRef = useRef(homes);
  const addressFocusedRef = useRef(addressFocused);
  const addressTargetRef = useRef(addressTarget);
  const cameraIntentRef = useRef(cameraIntent);
  const visibleResourceTypesRef = useRef(visibleResourceTypes);
  const [mapReady, setMapReady] = useState(false);
  const [mapIssue, setMapIssue] = useState('');
  const [mapLayoutRevision, setMapLayoutRevision] = useState(0);

  const homeData = useMemo(() => makeHomeCollection(homes, selectedHome, hoveredHome), [homes, selectedHome?.id, selectedHome?.lat, selectedHome?.lng, hoveredHome?.id, hoveredHome?.lat, hoveredHome?.lng]);
  const evidenceCoordinates = JSON.stringify(evidenceLocations.map(item => [Number(item.lng), Number(item.lat)]));
  const evidenceData = useMemo(() => evidenceCollection(selectedHome, evidenceLocations), [selectedHome, evidenceLocations]);
  const resourceData = useMemo(() => makeResourceCollection(resources, visibleResourceTypes, denguePolicy, dengueNow), [resources, visibleResourceTypes, denguePolicy, dengueNow]);
  const dengueDataRevision = `${visibleResourceTypes.includes('dengue_cluster')}|${denguePolicy?.sourceUpdatedAt || ''}|${mapFeatureRevision(resourceData.features.filter((feature) => feature.properties?.resourceType === 'dengue_cluster'))}`;

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { homesRef.current = homes; }, [homes]);
  addressFocusedRef.current = addressFocused;
  addressTargetRef.current = addressTarget;
  cameraIntentRef.current = cameraIntent;
  visibleResourceTypesRef.current = visibleResourceTypes;
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
    map.on('resize', () => setMapLayoutRevision((revision) => revision + 1));

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
          'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 12, ['boolean',['get','hovered'],false],12, 7],
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#c56b28', '#f9f7ef'],
          'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], '#ffffff', '#355d42'],
          'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 3, 2],
        },
      });

      map.addSource('hc-resources', { type: 'geojson', data: resourceData });
      const baseResourceColor = ['match', ['get', 'resourceType'], ...Object.entries(RESOURCE_COLORS).flat(), '#718096'];
      const resourceColor = ['case',
        ['all', ['==', ['get', 'resourceType'], 'dengue_cluster'], ['>=', ['to-number', ['get', 'caseCount'], 0], 10]], dengueSeverityColors.red,
        ['==', ['get', 'resourceType'], 'dengue_cluster'], dengueSeverityColors.yellow,
        baseResourceColor,
      ];
      const isVisible = visibleResourceFilter(visibleResourceTypesRef.current);
      map.addLayer({
        id: 'hc-resource-polygons', type: 'fill', source: 'hc-resources',
        filter: ['all', ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], isVisible],
        paint: { 'fill-color': resourceColor, 'fill-opacity': ['case', ['==', ['get', 'resourceType'], 'dengue_cluster'], 0.18, 0.12] },
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
      // Keep the selected orange home markers above polygon fills and amenity symbols.
      map.moveLayer?.('hc-home-points');

      void loadResourceIconImages(map, () => mapRef.current === map).then((loadedTypes) => {
        if (mapRef.current !== map || !loadedTypes.some(Boolean) || map.getLayer?.('hc-resource-point-icons')) return;
        const availableTypes = loadedTypes.filter(Boolean);
        const visibleTypes = visibleResourceTypesRef.current.filter((type) => availableTypes.includes(type));
        map.addLayer({
          id: 'hc-resource-point-icons',
          type: 'symbol',
          source: 'hc-resources',
          filter: ['all', ['==', ['geometry-type'], 'Point'], visibleResourceFilter(visibleTypes)],
          layout: {
            'icon-image': ['concat', 'hc-resource-icon-', ['get', 'resourceType']],
            'icon-size': 0.85,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
        map.moveLayer?.('hc-home-points');
        map.setLayoutProperty?.('hc-resource-points', 'visibility', 'none');
        bindResourceInteractions(map, ['hc-resource-point-icons'], activePopupRef, activePopupDengueRef);
        map.addLayer({
          id: 'hc-score-icons', type: 'symbol', source: 'hc-score-evidence',
          filter: ['all', ['==', ['geometry-type'], 'Point'], ['in', ['get', 'resourceType'], ['literal', availableTypes]]],
          layout: { 'icon-image': ['concat', 'hc-resource-icon-', ['get', 'resourceType']], 'icon-size': 0.85, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        });
        map.setFilter('hc-score-points', ['all', ['==', ['geometry-type'], 'Point'], ['!', ['in', ['get', 'resourceType'], ['literal', availableTypes]]]]);
        map.on('click', 'hc-score-icons', event => {
          const properties = event.features?.[0]?.properties || {};
          activePopupRef.current?.remove();
          activePopupRef.current = new Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(event.lngLat).setDOMContent(popupContent(properties.name, `${properties.label} · ${properties.distanceLabel}`, properties.context, properties.sourceUrl)).addTo(map);
          activePopupDengueRef.current = false;
        });
        map.on('mouseenter', 'hc-score-icons', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'hc-score-icons', () => { map.getCanvas().style.cursor = ''; });
      });
      map.addSource('hc-score-evidence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'hc-score-connections', type: 'line', source: 'hc-score-evidence', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': .75, 'line-dasharray': [3, 4] } });
      map.addLayer({ id: 'hc-score-points', type: 'circle', source: 'hc-score-evidence', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
      const labelFont = map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout?.['text-font'])?.layout['text-font'] || ['Noto Sans Regular'];
      if (map.getStyle().glyphs) map.addLayer({ id: 'hc-score-labels', type: 'symbol', source: 'hc-score-evidence', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['concat', ['get', 'name'], '\n', ['get', 'label'], ' · ', ['get', 'distanceLabel']], 'text-font': labelFont, 'text-size': 12, 'text-anchor': 'bottom', 'text-offset': [0, -1.1], 'text-allow-overlap': false }, paint: { 'text-color': '#183d2e', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      map.on('click', 'hc-score-points', event => {
        const properties = event.features?.[0]?.properties || {};
        activePopupRef.current?.remove();
        activePopupRef.current = new Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(event.lngLat).setDOMContent(popupContent(properties.name, `${properties.label} · ${properties.distanceLabel}`, properties.context, properties.sourceUrl)).addTo(map);
        activePopupDengueRef.current = false;
      });
      map.on('mouseenter', 'hc-score-points', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hc-score-points', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'hc-home-points', (event) => {
        const feature = event.features?.[0];
        const home = homesRef.current.find((item) => String(item.id) === String(feature?.properties?.homeId));
        if (!home) return;
        onSelectRef.current?.(home);
        const score = home.score !== null && home.score !== undefined && Number.isFinite(Number(home.score))
          ? `${home.score}/100 · ${scoreLabel(home.score)}`
          : '';
        activePopupRef.current?.remove();
        activePopupRef.current = new Popup({ closeButton: true, maxWidth: '260px' })
          .setLngLat(event.lngLat)
          .setDOMContent(popupContent(home.address, `${home.town} · ${money(home.price)}`, score))
          .addTo(map);
        activePopupDengueRef.current = false;
      });

      bindResourceInteractions(map, ['hc-resource-polygons', 'hc-resource-lines', 'hc-resource-points'], activePopupRef, activePopupDengueRef);
      for (const layerId of ['hc-home-points']) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }

      setMapReady(true);
      const locatedHomes = homesRef.current.filter(hasMapCoordinates);
      if (addressFocusedRef.current && isMapAddressCandidate(addressTargetRef.current)) {
        const target = addressTargetRef.current;
        map.jumpTo({ center: [target.longitude, target.latitude], zoom: 15, offset: visibleMapOffset(map) });
      } else if (cameraIntentRef.current.type === 'reset') {
        map.jumpTo({ center: [103.8198, 1.3521], zoom: 11, pitch: 48, bearing: -18 });
      } else if (locatedHomes.length > 1) {
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
      activePopupRef.current?.remove();
      activePopupRef.current = null;
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
    if (previousDengueDataRevisionRef.current !== null
      && previousDengueDataRevisionRef.current !== dengueDataRevision
      && activePopupDengueRef.current) {
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      activePopupDengueRef.current = false;
    }
    previousDengueDataRevisionRef.current = dengueDataRevision;
    const isVisible = visibleResourceFilter(visibleResourceTypes);
    for (const layerId of ['hc-resource-polygons', 'hc-resource-lines', 'hc-resource-points', 'hc-resource-point-icons']) {
      if (map.getLayer && !map.getLayer(layerId)) continue;
      const geometryFilter = layerId === 'hc-resource-polygons'
        ? ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]
        : layerId === 'hc-resource-lines'
          ? ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]]
          : ['==', ['geometry-type'], 'Point'];
      map.setFilter(layerId, ['all', geometryFilter, isVisible]);
    }
  }, [mapReady, resourceData, visibleResourceTypes, dengueDataRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !activePopupDengueRef.current) return;
    if (!evaluateDengueSnapshot(denguePolicy, dengueNow).usable) {
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      activePopupDengueRef.current = false;
    }
  }, [mapReady, denguePolicy, dengueNow]);

  useEffect(() => {
    if (mapReady) setSourceData(mapRef.current, 'hc-score-evidence', evidenceData);
  }, [mapReady, evidenceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedHome || !hasMapCoordinates(selectedHome) || addressFocused) return;
    const coordinates = JSON.parse(evidenceCoordinates);
    if (coordinates.length) {
      const bounds = new LngLatBounds();
      bounds.extend([Number(selectedHome.lng), Number(selectedHome.lat)]);
      coordinates.forEach(point => bounds.extend(point));
      const container = map.getContainer();
      const desk = container.closest('.explore-desk');
      const left = desk?.querySelector('.map-research-sidebar[data-state="open"]')?.getBoundingClientRect().width || 0;
      const right = desk?.querySelector('.map-record-details')?.getBoundingClientRect().width || 0;
      if (container.clientWidth - left - right < 160) return;
      map.fitBounds(bounds, { padding: { top: 70, bottom: 100, left: left + 48, right: right + 48 }, maxZoom: 16, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350 });
      return;
    }
    map.flyTo({
      center: [Number(selectedHome.lng), Number(selectedHome.lat)],
      zoom: selectedHomeZoom(map.getZoom()),
      offset: visibleMapOffset(map),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
    });
  }, [mapReady, selectedHome?.id, selectedHome?.lat, selectedHome?.lng, homeFocusRequest, addressFocused, mapLayoutRevision, evidenceCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    const feature = facilityFocus?.feature;
    if (!mapReady || !map || feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (![longitude, latitude].every(Number.isFinite)) return;
    const properties = feature.properties || {};
    activePopupRef.current?.remove();
    const popup = new Popup({ closeButton: true, maxWidth: '280px', offset: 18 })
      .setLngLat([longitude, latitude])
      .setDOMContent(mapResourcePopupContent(feature))
      .addTo(map);
    activePopupRef.current = popup;
    activePopupDengueRef.current = properties.resourceType === 'dengue_cluster';
    map.flyTo({
      center: [longitude, latitude],
      zoom: Math.min(Math.max(map.getZoom() + 2, 17), 19),
      offset: visibleMapOffset(map),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550,
    });
    return () => {
      if (activePopupRef.current === popup) activePopupRef.current = null;
      popup.remove();
    };
  }, [mapReady, facilityFocus?.request, facilityFocus?.feature, mapLayoutRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !addressFocused || !isMapAddressCandidate(addressTarget)) return;
    map.flyTo({
      center: [addressTarget.longitude, addressTarget.latitude],
      zoom: Math.max(map.getZoom(), 15),
      offset: visibleMapOffset(map),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
    });
  }, [mapReady, addressTarget?.latitude, addressTarget?.longitude, addressRequest, addressFocused, mapLayoutRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !isMapAddressCandidate(addressTarget)) return;

    const element = document.createElement('div');
    element.className = 'map-address-marker maplibre-address-marker';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', `Selected map location: ${addressTarget.address}`);
    const pin = document.createElement('span');
    pin.className = 'map-address-marker-pin';
    pin.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'map-address-label';
    label.textContent = addressTarget.address;
    element.append(pin, label);

    const marker = new MapLibreMarker({ element, anchor: 'bottom' })
      .setLngLat([addressTarget.longitude, addressTarget.latitude])
      .addTo(map);
    return () => marker.remove();
  }, [mapReady, addressTarget?.address, addressTarget?.latitude, addressTarget?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !hasMapCoordinates(hoveredHome) || hoveredHome?.id === selectedHome?.id || addressTarget) return;
    let preview;
    const timer = window.setTimeout(() => {
      const location = [Number(hoveredHome.lng), Number(hoveredHome.lat)];
      map.flyTo({
        center: location,
        zoom: selectedHomeZoom(map.getZoom()),
        offset: visibleMapOffset(map),
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500,
      });
      const locationPrecision = hoveredHome.mapLocationPrecision === 'block' ? ' · Approximate block location · OneMap' : '';
      preview = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 20, maxWidth: '230px' })
        .setLngLat(location)
        .setDOMContent(popupContent(hoveredHome.address, `${money(hoveredHome.price)} · ${hoveredHome.type}`, `Historical record, not a current listing${locationPrecision}`))
        .addTo(map);
    }, 300);
    return () => { window.clearTimeout(timer); preview?.remove(); };
  }, [mapReady, hoveredHome?.id, hoveredHome?.lat, hoveredHome?.lng, selectedHome?.id, addressTarget]);

  useEffect(() => {
    if (!mapReady || !centerRequest || cameraIntent.type !== 'reset') return;
    mapRef.current?.flyTo({
      center: [103.8198, 1.3521],
      zoom: 11,
      pitch: 48,
      bearing: -18,
      offset: visibleMapOffset(mapRef.current),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
    });
  }, [mapReady, centerRequest, cameraIntent.type, cameraIntent.request, mapLayoutRevision]);

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
