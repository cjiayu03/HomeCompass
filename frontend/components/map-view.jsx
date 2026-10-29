'use client';

import { resourceColors, resourceLabel } from '@/lib/map-layers';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { clusterPointFeatures } from '@/lib/geo-cluster';
import { MapViewportListener } from '@/components/map-viewport-listener';
import { money } from '@/lib/utils';

const markerIconCache = new Map();
function makeMarkerIcon(selected, hovered) {
  const key = `${Boolean(selected)}:${Boolean(hovered)}`;
  if (markerIconCache.has(key)) return markerIconCache.get(key);
  const icon = L.divIcon({ className: '', html: `<span class="map-marker ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}"><span>${selected ? '★' : '•'}</span></span>`, iconSize: selected ? [39, 39] : [34, 34], iconAnchor: selected ? [7, 34] : [6, 30], popupAnchor: [10, -28] });
  markerIconCache.set(key, icon);
  return icon;
}

function FlyToSelected({ home }) {
  const map = useMap();
  useEffect(() => {
    map.closePopup();
    if (!hasCoordinates(home)) return;
    const sidebar = map.getContainer().closest('.explore-desk')?.querySelector('.map-research-sidebar[data-state="open"]');
    const leftInset = sidebar?.getBoundingClientRect().width || 0;
    const rightInset = map.getContainer().closest('.explore-desk')?.querySelector('.map-record-details')?.getBoundingClientRect().width || 0;
    const size = map.getSize();
    // A narrow phone panel must be collapsed before there is room to inspect the map.
    if (size.x - leftInset - rightInset < 160) return;
    const point = map.latLngToContainerPoint([home.lat, home.lng]);
    if (point.x < leftInset + 40 || point.x > size.x - rightInset - 40 || point.y < 40 || point.y > size.y - 40) {
      map.panInside([home.lat, home.lng], { paddingTopLeft: [leftInset + 40, 40], paddingBottomRight: [rightInset + 40, 40], animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: .25 });
    }
  }, [home?.id, home?.lat, home?.lng, map]);
  return null;
}

function HoverPreview({ home }) {
  const map = useMap();
  useEffect(() => {
    if (!hasCoordinates(home)) return;
    // Avoid camera jumps while someone quickly scans through the results.
    const timer = window.setTimeout(() => {
      map.panInside([Number(home.lat), Number(home.lng)], {
        paddingTopLeft: [44, 240], paddingBottomRight: [44, 90],
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        duration: 0.3,
      });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [map, home?.id, home?.lat, home?.lng]);
  if (!hasCoordinates(home)) return null;
  return <CircleMarker center={[Number(home.lat), Number(home.lng)]} radius={23} interactive={false} pathOptions={{ color: 'hsl(var(--primary))', weight: 2, fillOpacity: 0.12 }}>
    <Tooltip permanent direction="top" offset={[0, -28]} opacity={1} className="home-hover-label"><strong>{home.address}</strong><br />{money(home.price)} · {home.type}</Tooltip>
  </CircleMarker>;
}

function FitHomes({ homes }) {
  const map = useMap();
  const key=homes.map(h=>`${h.lat},${h.lng}`).sort().join(';');
  useEffect(() => { if (homes.length > 1) map.fitBounds(L.latLngBounds(homes.map((home) => [home.lat, home.lng])), { padding: [42, 42], maxZoom: 12 }); else if(homes.length===1)map.setView([homes[0].lat,homes[0].lng],14); }, [key, map]);
  return null;
}

function ResizeMap(){const map=useMap();useEffect(()=>{const observer=new ResizeObserver(()=>map.invalidateSize({pan:false,debounceMoveend:true}));observer.observe(map.getContainer());return()=>observer.disconnect();},[map]);return null;}

function ResetSingapore({ request }) {
  const map = useMap();
  useEffect(() => { if (request) map.flyTo([1.3521, 103.8198], 11, { duration: 0.65 }); }, [request, map]);
  return null;
}

function hasCoordinates(home) {
  return home?.lat !== null && home?.lat !== undefined && home?.lng !== null && home?.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng));
}


function readViewport(map) {
  const bounds = map.getBounds();
  const size = map.getSize();
  return {
    zoom: map.getZoom(),
    west: bounds.getWest(),
    east: bounds.getEast(),
    south: bounds.getSouth(),
    north: bounds.getNorth(),
    width: size.x,
    height: size.y,
  };
}

function ResourceFeatures({ features, visibleTypes }) {
  const map = useMap();
  const [viewport, setViewport] = useState(() => readViewport(map));
  const updateViewport = useCallback(() => setViewport(readViewport(map)), [map]);
  useMapEvents({ moveend: updateViewport, zoomend: updateViewport, resize: updateViewport });
  const cellSize = useMemo(() => {
    const longitudePerPixel = Math.abs(viewport.east - viewport.west) / Math.max(viewport.width, 1);
    const latitudePerPixel = Math.abs(viewport.north - viewport.south) / Math.max(viewport.height, 1);
    const visibleCellSize = Math.max(longitudePerPixel, latitudePerPixel) * 48;
    return Number.isFinite(visibleCellSize) && visibleCellSize > 0
      ? visibleCellSize
      : 0.02 / (2 ** Math.max(viewport.zoom - 11, 0));
  }, [viewport]);
  const mapped = useMemo(() => clusterPointFeatures(
    (Array.isArray(features) ? features : []).filter((feature) => feature?.geometry && visibleTypes.includes(feature.properties?.resourceType)),
    { cellSize },
  ), [features, visibleTypes, cellSize]);
  const collection = useMemo(() => ({ type: 'FeatureCollection', features: mapped }), [mapped]);
  const renderKey = useMemo(() => JSON.stringify(mapped), [mapped]);
  const style = (feature) => {
    const type = feature?.properties?.resourceType;
    const color = resourceColors[type] || '#718096';
    return { color, weight: type === 'dengue_cluster' ? 2 : 1.25, opacity: 0.8, fillColor: color, fillOpacity: type === 'dengue_cluster' ? 0.14 : 0.08, dashArray: type === 'school_zone' ? '4 5' : undefined };
  };
  const onEachFeature = (feature, layer) => {
    const properties = feature?.properties || {};
    const popup = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = properties.cluster ? `${properties.count} locations` : properties.name || 'Source feature';
    popup.appendChild(name);
    if (properties.cluster && properties.name) {
      const representative = document.createElement('p');
      representative.textContent = `Representative: ${properties.name}`;
      popup.appendChild(representative);
    }
    const type = document.createElement('p');
    type.textContent = resourceLabel(properties.resourceType);
    popup.appendChild(type);
    const date = document.createElement('small');
    date.textContent = `Source date: ${properties.sourceVersion || 'not reported'}`;
    popup.appendChild(date);
    try {
      const source = new URL(properties.sourceUrl);
      if (source.protocol === 'https:' && source.hostname.endsWith('data.gov.sg')) {
        const link = document.createElement('a');
        link.href = source.href;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Open official source';
        popup.appendChild(link);
      }
    } catch { /* A source link is optional; never put upstream strings into HTML. */ }
    layer.bindPopup(popup);
  };
  const pointToLayer = (feature, latlng) => {
    if (feature?.properties?.cluster) {
      const count = Number.isInteger(feature.properties.count) ? feature.properties.count : 0;
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:grid;place-items:center;width:36px;height:36px;border:2px solid #fff;border-radius:999px;background:${resourceColors[feature.properties.resourceType] || '#42624f'};color:#fff;font-size:12px;font-weight:800;box-shadow:0 4px 12px rgba(15,23,42,.32)">${count}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      return L.marker(latlng, { icon });
    }
    return L.circleMarker(latlng, { radius: 5, color: '#ffffff', weight: 1.5, fillColor: resourceColors[feature?.properties?.resourceType] || '#718096', fillOpacity: 0.92 });
  };
  return <GeoJSON key={renderKey} data={collection} style={style} pointToLayer={pointToLayer} onEachFeature={onEachFeature} />;
}

const MemoResourceFeatures = memo(ResourceFeatures);
const HomeMarker = memo(function HomeMarker({ home, selected, hovered, onSelect }) {
  const events = useMemo(() => ({ click: () => onSelect(home) }), [onSelect, home]);
  return <Marker title={home.address} alt={`Map marker for ${home.address}`} position={[home.lat, home.lng]} icon={makeMarkerIcon(selected, hovered)} zIndexOffset={hovered ? 1000 : 0} eventHandlers={events} />;
});

export default memo(function MapView({ homes, resources = [], visibleResourceTypes = [], selectedHome, hoveredHome, anchors=[], onSelect, centerRequest, onViewportChange }) {
  const mappedHomes = useMemo(() => homes.filter(hasCoordinates), [homes]);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  return <MapContainer center={[1.3521, 103.8198]} zoom={11} scrollWheelZoom zoomControl className="h-full min-h-0 w-full">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url={tileUrl} />
    <ResizeMap/><MapViewportListener onBoundsChange={onViewportChange} /><FitHomes homes={mappedHomes} /><FlyToSelected home={selectedHome} /><ResetSingapore request={centerRequest} /><MemoResourceFeatures features={resources} visibleTypes={visibleResourceTypes} /><HoverPreview home={hoveredHome} />
    {anchors.map((anchor,i)=><Circle key={anchor.id} center={[anchor.lat,anchor.lng]} radius={anchor.radius} pathOptions={{color:['#42624f','#627f90','#8a7898'][i%3],fillOpacity:0.08,weight:2,dashArray:'5 5'}}><Popup>{anchor.label}: {anchor.radius.toLocaleString()} m straight-line reach</Popup></Circle>)}
    {mappedHomes.map(home => <HomeMarker key={home.id} home={home} selected={home.id === selectedHome?.id} hovered={home.id === hoveredHome?.id} onSelect={onSelect} />)}
  </MapContainer>;
});
