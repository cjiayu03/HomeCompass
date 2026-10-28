'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Badge } from '@/components/ui/badge';
import { clusterPointFeatures } from '@/lib/geo-cluster';
import { MapViewportListener } from '@/components/map-viewport-listener';
import { money, scoreLabel } from '@/lib/utils';
import {
  createResourceMarkerSvg,
  getResourceDisplayName,
  getResourcePresentation,
  getResourceTypeLabel,
  getResourceTypePluralLabel,
} from '@/lib/map-resource-presentation';

function makeMarkerIcon(selected, hovered) {
  return L.divIcon({ className: '', html: `<span class="map-marker ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}"><span>${selected ? '★' : '•'}</span></span>`, iconSize: selected ? [39, 39] : [34, 34], iconAnchor: selected ? [7, 34] : [6, 30], popupAnchor: [10, -28] });
}

function FlyToSelected({ home }) {
  const map = useMap();
  useEffect(() => { if (hasCoordinates(home)) map.flyTo([home.lat, home.lng], Math.max(map.getZoom(), 13), { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.65 }); }, [home?.id, home?.lat, home?.lng, map]);
  return null;
}

function HoverPreview({ home, addressTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!hasCoordinates(home) || addressTarget) return;
    // Avoid camera jumps while someone quickly scans through the results.
    const timer = window.setTimeout(() => {
      map.panInside([Number(home.lat), Number(home.lng)], {
        paddingTopLeft: [44, 240], paddingBottomRight: [44, 90],
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        duration: 0.3,
      });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [map, home?.id, home?.lat, home?.lng, addressTarget]);
  if (!hasCoordinates(home)) return null;
  return <CircleMarker center={[Number(home.lat), Number(home.lng)]} radius={23} interactive={false} pathOptions={{ color: 'hsl(var(--primary))', weight: 2, fillOpacity: 0.12 }}>
    <Tooltip permanent direction="top" offset={[0, -28]} opacity={1} className="home-hover-label"><strong>{home.address}</strong><br />{money(home.price)} · {home.type}</Tooltip>
  </CircleMarker>;
}

function FitHomes({ homes, addressTarget }) {
  const map = useMap();
  const lastKey = useRef(null);
  const key=homes.map(h=>`${h.lat},${h.lng}`).sort().join(';');
  useEffect(() => { if (addressTarget) { lastKey.current = key; return; } if (lastKey.current === key) return; lastKey.current = key; if (homes.length > 1) map.fitBounds(L.latLngBounds(homes.map((home) => [home.lat, home.lng])), { padding: [42, 42], maxZoom: 12 }); else if(homes.length===1)map.setView([homes[0].lat,homes[0].lng],14); }, [key, map, addressTarget]);
  return null;
}

function FlyToAddress({ target, request, focused }) {
  const map = useMap();
  useEffect(() => { if (target && focused) map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.65 }); }, [map, request, focused]);
  return null;
}

function ResizeMap(){const map=useMap();useEffect(()=>{const observer=new ResizeObserver(()=>map.invalidateSize({pan:false}));observer.observe(map.getContainer());return()=>observer.disconnect();},[map]);return null;}

function ResetSingapore({ request }) {
  const map = useMap();
  useEffect(() => { if (request) map.flyTo([1.3521, 103.8198], 11, { duration: 0.65 }); }, [request, map]);
  return null;
}

function hasCoordinates(home) {
  return home?.lat !== null && home?.lat !== undefined && home?.lng !== null && home?.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng));
}

const resourceMarkerIcons = new Map();

function resourceMarkerIcon(type) {
  if (resourceMarkerIcons.has(type)) return resourceMarkerIcons.get(type);
  const presentation = getResourcePresentation(type);
  const icon = L.divIcon({
    className: '',
    html: `<span class="map-resource-icon" role="img" aria-label="${presentation.label}">${createResourceMarkerSvg(type)}</span>`,
    iconSize: [32, 44],
    iconAnchor: [16, 43],
    popupAnchor: [0, -39],
  });
  resourceMarkerIcons.set(type, icon);
  return icon;
}

function clusterResourceFeatures(features, cellSize) {
  const groups = new Map();
  for (const feature of features) {
    const type = feature.properties?.resourceType || 'other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(feature);
  }
  return Array.from(groups, ([type, group]) => clusterPointFeatures(group, { cellSize })
    .map((feature) => feature.properties?.cluster ? { ...feature, id: `${type}:${feature.id}` } : feature))
    .flat();
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
  const mapped = useMemo(() => clusterResourceFeatures(
    (Array.isArray(features) ? features : []).filter((feature) => feature?.geometry && visibleTypes.includes(feature.properties?.resourceType)),
    cellSize,
  ), [features, visibleTypes, cellSize]);
  const collection = useMemo(() => ({ type: 'FeatureCollection', features: mapped }), [mapped]);
  const renderKey = useMemo(() => JSON.stringify(mapped), [mapped]);
  const style = (feature) => {
    const type = feature?.properties?.resourceType;
    const color = getResourcePresentation(type).color;
    return { color, weight: type === 'dengue_cluster' ? 2 : 1.25, opacity: 0.8, fillColor: color, fillOpacity: type === 'dengue_cluster' ? 0.14 : 0.08, dashArray: type === 'school_zone' ? '4 5' : undefined };
  };
  const onEachFeature = (feature, layer) => {
    const properties = feature?.properties || {};
    const popup = document.createElement('div');
    const name = document.createElement('strong');
    const typeLabel = getResourceTypeLabel(properties.resourceType);
    const displayName = getResourceDisplayName(properties);
    name.textContent = properties.cluster
      ? `${properties.count} ${getResourceTypePluralLabel(properties.resourceType)}`
      : displayName;
    popup.appendChild(name);
    if (properties.cluster && displayName !== typeLabel) {
      const representative = document.createElement('p');
      representative.textContent = `Example: ${displayName}`;
      popup.appendChild(representative);
    }
    if (!properties.cluster && displayName !== typeLabel) {
      const type = document.createElement('p');
      type.textContent = displayName === 'Clinic name unavailable'
        ? `${typeLabel} · name missing from saved data`
        : typeLabel;
      popup.appendChild(type);
    }
    const date = document.createElement('small');
    date.textContent = `Data checked: ${properties.retrievedAt ? new Date(properties.retrievedAt).toLocaleDateString() : 'date unavailable'}`;
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
    if (properties.cluster) {
      layer.on('click', () => {
        if (map.getZoom() < 17) {
          map.flyTo(layer.getLatLng(), Math.min(map.getZoom() + 2, 17), {
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.45,
          });
        } else {
          layer.bindPopup(popup).openPopup();
        }
      });
      return;
    }
    layer.bindPopup(popup);
  };
  const pointToLayer = (feature, latlng) => {
    if (feature?.properties?.cluster) {
      const count = Number.isInteger(feature.properties.count) ? feature.properties.count : 0;
      const color = getResourcePresentation(feature.properties.resourceType).color;
      const icon = L.divIcon({
        className: '',
        html: `<span style="display:grid;place-items:center;width:40px;height:40px;border:3px solid #fff;border-radius:999px;background:${color};color:#fff;font-size:13px;font-weight:800;box-shadow:0 4px 12px rgba(15,23,42,.38)" role="img" aria-label="${count} ${getResourceTypePluralLabel(feature.properties.resourceType)}">${count}</span>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      return L.marker(latlng, { icon });
    }
    const type = feature?.properties?.resourceType;
    const label = getResourceTypeLabel(type);
    return L.marker(latlng, {
      icon: resourceMarkerIcon(type),
      title: label,
      alt: `Map marker for ${label}`,
    });
  };
  return <GeoJSON key={renderKey} data={collection} style={style} pointToLayer={pointToLayer} onEachFeature={onEachFeature} />;
}

export default function MapView({ homes, resources = [], visibleResourceTypes = [], selectedHome, hoveredHome, anchors=[], onSelect, centerRequest, addressTarget, addressRequest, addressFocused, onViewportChange }) {
  const mappedHomes = useMemo(() => homes.filter(hasCoordinates), [homes]);
  const icons = useMemo(() => Object.fromEntries(mappedHomes.map((home) => [home.id, makeMarkerIcon(home.id === selectedHome?.id,home.id===hoveredHome?.id)])), [mappedHomes, selectedHome?.id,hoveredHome?.id]);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  return <MapContainer center={[1.3521, 103.8198]} zoom={11} scrollWheelZoom zoomControl={false} className="h-full min-h-0 w-full">
    <ZoomControl position="bottomright" /><TileLayer attribution="&copy; OpenStreetMap contributors" url={tileUrl} />
    <ResizeMap/><MapViewportListener onBoundsChange={onViewportChange} /><FitHomes homes={mappedHomes} addressTarget={addressFocused} /><FlyToSelected home={selectedHome} /><ResetSingapore request={centerRequest} /><FlyToAddress target={addressTarget} request={addressRequest} focused={addressFocused} /><ResourceFeatures features={resources} visibleTypes={visibleResourceTypes} /><HoverPreview home={hoveredHome} addressTarget={addressFocused} />
    {addressTarget && <CircleMarker className="map-address-pin" center={[addressTarget.latitude, addressTarget.longitude]} radius={9} pathOptions={{color: '#ffffff', weight: 3, fillColor: '#256b4b', fillOpacity: 1}}><Popup>{addressTarget.address}</Popup></CircleMarker>}
    {anchors.map((anchor,i)=><Circle key={anchor.id} center={[anchor.lat,anchor.lng]} radius={anchor.radius} pathOptions={{color:['#42624f','#627f90','#8a7898'][i%3],fillOpacity:0.08,weight:2,dashArray:'5 5'}}><Popup>{anchor.label}: {anchor.radius.toLocaleString()} m straight-line reach</Popup></Circle>)}
    {mappedHomes.map((home) => <Marker key={home.id} title={home.address} alt={`Map marker for ${home.address}`} position={[home.lat, home.lng]} icon={icons[home.id]} zIndexOffset={home.id===hoveredHome?.id?1000:0} eventHandlers={{ click: () => onSelect(home) }}><Popup><div className="flex flex-col gap-2"><div><p className="font-semibold">{home.address}</p><p className="text-xs opacity-70">{home.town} · {money(home.price)}</p></div>{home.score !== null && home.score !== undefined && Number.isFinite(Number(home.score)) && <Badge>{home.score}/100 · {scoreLabel(home.score)}</Badge>}<p className="text-xs leading-4 opacity-75">{home.school || 'School distance unavailable'}<br />{home.childcare || 'Childcare distance unavailable'}<br />{home.care || 'Care distance unavailable'}</p></div></Popup></Marker>)}
  </MapContainer>;
}
