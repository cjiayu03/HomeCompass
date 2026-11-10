'use client';

import { mapFeatureRevision, resourceColors, resourceLabel } from '@/lib/map-layers';
import { spreadEvidencePoints } from '@/lib/score-locations';

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Popup, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { clusterPointFeatures } from '@/lib/geo-cluster';
import { MapViewportListener } from '@/components/map-viewport-listener';
import { money } from '@/lib/utils';
import { isMapAddressCandidate } from '@/lib/map-address-search';
import { hasMapCoordinates } from '@/lib/map-coordinates';
import { facilityClusterRadius, selectedHomeZoom } from '@/lib/map-zoom';
import { mapLayerClusterMarkup, mapLayerMarkerMarkup } from '@/lib/map-layer-icons';
import { dengueFeatureColor, filterCurrentDengueFeatures } from '@/lib/dengue-status';
import { mapResourcePopupContent } from '@/lib/map-resource-popup';

const markerIconCache = new Map();
const resourceMarkerIconCache = new Map();
function makeMarkerIcon(selected, hovered) {
  const key = `${Boolean(selected)}:${Boolean(hovered)}`;
  if (markerIconCache.has(key)) return markerIconCache.get(key);
  const icon = L.divIcon({ className: '', html: `<span class="map-marker ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''}"><span>${selected ? '★' : '•'}</span></span>`, iconSize: selected ? [39, 39] : [34, 34], iconAnchor: selected ? [7, 34] : [6, 30], popupAnchor: [10, -28] });
  markerIconCache.set(key, icon);
  return icon;
}

function makeResourceMarkerIcon(type) {
  if (resourceMarkerIconCache.has(type)) return resourceMarkerIconCache.get(type);
  const icon = L.divIcon({
    className: 'map-resource-marker-icon',
    html: mapLayerMarkerMarkup(type),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -13],
  });
  resourceMarkerIconCache.set(type, icon);
  return icon;
}

function zoomIntoCluster(map, feature) {
  const members = Array.isArray(feature?.properties?.members) ? feature.properties.members : [];
  const coordinates = members
    .map((member) => member.coordinates)
    .filter((position) => Array.isArray(position) && position.length >= 2 && position.slice(0, 2).every(Number.isFinite));
  const uniqueCoordinates = new Set(coordinates.map(([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (uniqueCoordinates.size > 1) {
    const bounds = L.latLngBounds(coordinates.map(([longitude, latitude]) => [latitude, longitude]));
    if (reducedMotion) map.fitBounds(bounds, { padding: [72, 72], maxZoom: 19, animate: false });
    else map.flyToBounds(bounds, { padding: [72, 72], maxZoom: 19, duration: 0.5 });
    return;
  }

  // Co-located facilities cannot separate spatially; keep their names in the popup.
  if (coordinates.length) return;

  const [longitude, latitude] = feature.geometry.coordinates;
  const zoom = Math.min(Math.max(map.getZoom() + 2, 16), 19);
  if (reducedMotion) map.setView([latitude, longitude], zoom, { animate: false });
  else map.flyTo([latitude, longitude], zoom, { duration: 0.5 });
}

function FocusResource({ facilityFocus }) {
  const map = useMap();
  useEffect(() => {
    const feature = facilityFocus?.feature;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return;
    const [longitude, latitude] = feature.geometry.coordinates;
    if (![longitude, latitude].every(Number.isFinite)) return;
    map.closePopup();
    const zoom = Math.min(Math.max(map.getZoom() + 2, 17), 19);
    const size = map.getSize();
    const desk = map.getContainer().closest('.explore-desk');
    const sidebar = desk?.querySelector('.map-research-sidebar[data-state="open"]');
    const details = desk?.querySelector('.map-record-details');
    const leftInset = sidebar?.getBoundingClientRect().width || 0;
    const rightInset = details?.getBoundingClientRect().width || 0;
    let center = [latitude, longitude];
    if (size.x - leftInset - rightInset >= 160) {
      const visibleCenterX = (leftInset + size.x - rightInset) / 2;
      const targetPoint = map.project(center, zoom);
      const shiftedCenter = map.unproject(targetPoint.subtract([visibleCenterX - size.x / 2, 0]), zoom);
      center = [shiftedCenter.lat, shiftedCenter.lng];
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: 0.55 });
    const popup = L.popup({ autoPan: true, maxWidth: 280 })
      .setLatLng([latitude, longitude])
      .setContent(mapResourcePopupContent(feature))
      .openOn(map);
    return () => popup.remove();
  }, [facilityFocus?.request, facilityFocus?.feature, map]);
  return null;
}

const mapAddressIcon = L.divIcon({
  className: '',
  html: '<span class="map-address-marker-pin" aria-hidden="true"></span>',
  iconSize: [32, 40],
  iconAnchor: [16, 38],
});

function FlyToSelected({ home, locations = [], request, addressFocused }) {
  const map = useMap();
  const locationCoordinates = JSON.stringify(locations.map(item => [Number(item.lat), Number(item.lng)]));
  useEffect(() => {
    map.closePopup();
    if (!hasMapCoordinates(home) || addressFocused) return;
    const sidebar = map.getContainer().closest('.explore-desk')?.querySelector('.map-research-sidebar[data-state="open"]');
    const leftInset = sidebar?.getBoundingClientRect().width || 0;
    const rightInset = map.getContainer().closest('.explore-desk')?.querySelector('.map-record-details')?.getBoundingClientRect().width || 0;
    const size = map.getSize();
    // A narrow phone panel must be collapsed before there is room to inspect the map.
    if (size.x - leftInset - rightInset < 160) return;
    const coordinates = JSON.parse(locationCoordinates);
    if (coordinates.length) {
      map.fitBounds(L.latLngBounds([[home.lat, home.lng], ...coordinates]), {
        paddingTopLeft: [leftInset + 48, 70], paddingBottomRight: [rightInset + 48, 100], maxZoom: 16,
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: .35,
      });
      return;
    }
    const zoom = selectedHomeZoom(map.getZoom());
    const visibleCenterX = (leftInset + size.x - rightInset) / 2;
    const targetPoint = map.project([Number(home.lat), Number(home.lng)], zoom);
    const shiftedCenter = map.unproject(targetPoint.subtract([visibleCenterX - size.x / 2, 0]), zoom);
    const center = [shiftedCenter.lat, shiftedCenter.lng];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) map.setView(center, zoom, { animate: false });
    else map.flyTo(center, zoom, { duration: 0.65 });
  }, [home?.id, home?.lat, home?.lng, request, addressFocused, locationCoordinates, map]);
  return null;
}

function FlyToAddress({ target, request, focused }) {
  const map = useMap();
  const [mapLayoutRevision, setMapLayoutRevision] = useState(0);
  useMapEvents({ resize: () => setMapLayoutRevision((revision) => revision + 1) });
  useEffect(() => {
    if (!focused || !isMapAddressCandidate(target)) return;
    map.closePopup();
    const zoom = Math.max(map.getZoom(), 15);
    const size = map.getSize();
    const desk = map.getContainer().closest('.explore-desk');
    const sidebar = desk?.querySelector('.map-research-sidebar[data-state="open"]');
    const details = desk?.querySelector('.map-record-details');
    const leftInset = sidebar?.getBoundingClientRect().width || 0;
    const rightInset = details?.getBoundingClientRect().width || 0;
    let center = [target.latitude, target.longitude];
    if (size.x - leftInset - rightInset >= 160) {
      // Center the pin in the part of the map that remains visible beside panels.
      const visibleCenterX = (leftInset + size.x - rightInset) / 2;
      const targetPoint = map.project(center, zoom);
      const mapCenterPoint = targetPoint.subtract([visibleCenterX - size.x / 2, 0]);
      const shiftedCenter = map.unproject(mapCenterPoint, zoom);
      center = [shiftedCenter.lat, shiftedCenter.lng];
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.setView(center, zoom, { animate: false });
    } else {
      map.flyTo(center, zoom, { duration: 0.65 });
    }
  }, [map, target?.latitude, target?.longitude, request, focused, mapLayoutRevision]);
  return null;
}

function AddressMarker({ target }) {
  if (!isMapAddressCandidate(target)) return null;
  return <Marker
    position={[target.latitude, target.longitude]}
    icon={mapAddressIcon}
    title={`Selected map location: ${target.address}`}
    alt={`Selected map location: ${target.address}`}
    zIndexOffset={2000}
  >
    <Tooltip permanent direction="top" offset={[0, -16]} opacity={1} className="map-address-label">{target.address}</Tooltip>
  </Marker>;
}

function HoverPreview({ home, selectedHome, addressTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!hasMapCoordinates(home) || home?.id === selectedHome?.id || addressTarget) return;
    // Give a result a brief hover dwell before opening its map location.
    const timer = window.setTimeout(() => {
      const latitude = Number(home.lat);
      const longitude = Number(home.lng);
      const zoom = selectedHomeZoom(map.getZoom());
      const desk = map.getContainer().closest('.explore-desk');
      const sidebar = desk?.querySelector('.map-research-sidebar[data-state="open"]');
      const details = desk?.querySelector('.map-record-details');
      const leftInset = sidebar?.getBoundingClientRect().width || 0;
      const rightInset = details?.getBoundingClientRect().width || 0;
      const size = map.getSize();
      if (size.x - leftInset - rightInset < 160) return;
      const visibleCenterX = (leftInset + size.x - rightInset) / 2;
      const targetPoint = map.project([latitude, longitude], zoom);
      const center = map.unproject(targetPoint.subtract([visibleCenterX - size.x / 2, 0]), zoom);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        map.setView(center, zoom, { animate: false });
      } else {
        map.flyTo(center, zoom, { duration: 0.5 });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [map, home?.id, home?.lat, home?.lng, selectedHome?.id, addressTarget]);
  if (!hasMapCoordinates(home) || home?.id === selectedHome?.id) return null;
  return <CircleMarker center={[Number(home.lat), Number(home.lng)]} radius={23} interactive={false} pathOptions={{ color: 'hsl(var(--primary))', weight: 2, fillOpacity: 0.12 }}>
    <Tooltip permanent direction="top" offset={[0, -28]} opacity={1} className="home-hover-label"><strong>{home.address}</strong><br />{money(home.price)} · {home.type}{home.mapLocationPrecision === 'block' && <><br /><span>Approximate block location · OneMap</span></>}</Tooltip>
  </CircleMarker>;
}

function FitHomes({ homes, selectedHome, addressTarget }) {
  const map = useMap();
  const lastKey = useRef(null);
  const key=homes.map(h=>`${h.lat},${h.lng}`).sort().join(';');
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (addressTarget || hasMapCoordinates(selectedHome)) return;
    if (homes.length > 1) map.fitBounds(L.latLngBounds(homes.map((home) => [home.lat, home.lng])), { padding: [42, 42], maxZoom: 12 });
    else if (homes.length === 1) map.setView([homes[0].lat, homes[0].lng], 14);
  }, [key, map, selectedHome?.id, selectedHome?.lat, selectedHome?.lng, addressTarget]);
  return null;
}

function ResizeMap(){const map=useMap();useEffect(()=>{const observer=new ResizeObserver(()=>map.invalidateSize({pan:false,debounceMoveend:true}));observer.observe(map.getContainer());return()=>observer.disconnect();},[map]);return null;}

function ResetSingapore({ request, cameraIntent }) {
  const map = useMap();
  useEffect(() => {
    if (!request || cameraIntent?.type !== 'reset') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) map.setView([1.3521, 103.8198], 11, { animate: false });
    else map.flyTo([1.3521, 103.8198], 11, { duration: 0.65 });
  }, [request, cameraIntent?.type, cameraIntent?.request, map]);
  return null;
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

function ResourceFeatures({ features, visibleTypes, denguePolicy, dengueNow }) {
  const map = useMap();
  const [viewport, setViewport] = useState(() => readViewport(map));
  const updateViewport = useCallback(() => setViewport(readViewport(map)), [map]);
  useMapEvents({ moveend: updateViewport, zoomend: updateViewport, resize: updateViewport });
  const cellSize = useMemo(() => {
    const longitudePerPixel = Math.abs(viewport.east - viewport.west) / Math.max(viewport.width, 1);
    const latitudePerPixel = Math.abs(viewport.north - viewport.south) / Math.max(viewport.height, 1);
    const clusterRadius = facilityClusterRadius(viewport.zoom);
    const visibleCellSize = Math.max(longitudePerPixel, latitudePerPixel) * clusterRadius;
    return Number.isFinite(visibleCellSize) && visibleCellSize > 0
      ? visibleCellSize
      : (0.02 * clusterRadius / 48) / (2 ** Math.max(viewport.zoom - 11, 0));
  }, [viewport]);
  const mapped = useMemo(() => clusterPointFeatures(
    filterCurrentDengueFeatures(features, denguePolicy, dengueNow)
      .filter((feature) => feature?.geometry && visibleTypes.includes(feature.properties?.resourceType)),
    { cellSize },
  ), [features, visibleTypes, cellSize, denguePolicy, dengueNow]);
  const collection = useMemo(() => ({ type: 'FeatureCollection', features: mapped }), [mapped]);
  const renderKey = useMemo(() => mapFeatureRevision(mapped), [mapped]);
  const style = (feature) => {
    const type = feature?.properties?.resourceType;
    const color = type === 'dengue_cluster' ? dengueFeatureColor(feature) : resourceColors[type] || '#718096';
    return { color, weight: type === 'dengue_cluster' ? 2 : 1.25, opacity: 0.88, fillColor: color, fillOpacity: type === 'dengue_cluster' ? 0.18 : 0.08, dashArray: type === 'school_zone' ? '4 5' : undefined };
  };
  const onEachFeature = (feature, layer) => {
    const properties = feature?.properties || {};
    if (!properties.cluster) {
      const content = mapResourcePopupContent(feature);
      if (properties.resourceType === 'dengue_cluster') {
        const popupLayout = () => ({
          maxHeight: Math.max(120, map.getSize().y - 360),
          autoPanPaddingTopLeft: [12, 128],
          autoPanPaddingBottomRight: [12, map.getSize().x < 640 ? 172 : 24],
        });
        layer.bindPopup(content, popupLayout());
        content.addEventListener('toggle', () => {
          const popup = layer.getPopup();
          if (!popup || !popup.isOpen()) return;
          const focused = content.contains(document.activeElement) ? document.activeElement : null;
          Object.assign(popup.options, popupLayout());
          popup.update();
          focused?.focus({ preventScroll: true });
        }, true);
      } else layer.bindPopup(content);
      return;
    }
    const popup = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = properties.cluster ? `${properties.count} nearby facilities` : properties.name || 'Source feature';
    popup.appendChild(name);
    if (properties.cluster) {
      const members = Array.isArray(properties.members) ? properties.members : [];
      if (members.length) {
        const list = document.createElement('ul');
        list.className = 'map-cluster-members';
        members.slice(0, 10).forEach((member) => {
          const item = document.createElement('li');
          item.textContent = member.location ? `${member.name || 'Unnamed facility'} · ${member.location}` : member.name || 'Unnamed facility';
          list.appendChild(item);
        });
        popup.appendChild(list);
        if (members.length > 10) {
          const more = document.createElement('p');
          more.textContent = `Zoom in to explore ${members.length - 10} more.`;
          popup.appendChild(more);
        }
      } else {
        const hint = document.createElement('p');
        hint.textContent = 'Zoom in to see the individual facilities.';
        popup.appendChild(hint);
      }
    }
    popup.appendChild(mapResourcePopupContent(feature, { includeTitle: false }));
    layer.bindPopup(popup);
    if (properties.cluster) layer.on('click', () => zoomIntoCluster(map, feature));
  };
  const pointToLayer = (feature, latlng) => {
    if (feature?.properties?.cluster) {
      const count = Number.isInteger(feature.properties.count) ? feature.properties.count : 0;
      const icon = L.divIcon({
        className: 'map-resource-cluster-icon-wrap',
        html: mapLayerClusterMarkup(feature.properties.resourceType, count),
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
      const layerName = resourceLabel(feature.properties.resourceType).toLowerCase();
      return L.marker(latlng, { icon, title: `${count} ${layerName} locations. Click to inspect or zoom to individual facilities.` });
    }
    const resourceType = feature?.properties?.resourceType;
    return L.marker(latlng, {
      icon: makeResourceMarkerIcon(resourceType),
      title: feature?.properties?.name || resourceLabel(resourceType),
    });
  };
  return <GeoJSON key={renderKey} data={collection} style={style} pointToLayer={pointToLayer} onEachFeature={onEachFeature} />;
}

const MemoResourceFeatures = memo(ResourceFeatures);
function EvidencePoint({ item, position }) {
  const evidenceIcon = useMemo(() => L.divIcon({
    className: 'map-resource-marker-icon score-evidence-marker',
    html: mapLayerMarkerMarkup(item.resourceType),
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -13],
  }), [item.resourceType]);
  return <Marker position={position} icon={evidenceIcon} title={`${item.label}: ${item.name}`} alt={`${item.label}: ${item.name}`}>
    <Tooltip direction="top" offset={[0, -10]} opacity={1} className="score-location-label"><strong>{item.name}</strong><br />{item.label}{Number.isFinite(item.distanceM) && <> · {Math.round(item.distanceM).toLocaleString()} m</>}</Tooltip>
    <Popup><strong>{item.name}</strong><br />{item.context}<br />{Number.isFinite(item.distanceM) ? `${Math.round(item.distanceM).toLocaleString()} m straight-line` : 'Distance unavailable'}{item.sourceVersion && <><br />Source: {item.sourceVersion}</>}</Popup>
  </Marker>;
}

function EvidenceMarkers({ home, locations }) {
  const map = useMap();
  const [revision, setRevision] = useState(0);
  const update = useCallback(() => setRevision(value => value + 1), []);
  useMapEvents({ zoomend: update, moveend: update, resize: update });
  const positions = useMemo(() => {
    const points = locations.map(item => map.latLngToLayerPoint([Number(item.lat), Number(item.lng)]));
    const homePoint = map.latLngToLayerPoint([Number(home.lat), Number(home.lng)]);
    return spreadEvidencePoints(points, homePoint).map(point => map.layerPointToLatLng(point));
  }, [map, home.lat, home.lng, locations, revision]);
  return locations.map((item, index) => {
    const actual = [Number(item.lat), Number(item.lng)];
    const position = positions[index];
    const route = item.route?.coordinates?.map(([lng, lat]) => [lat, lng]);
    return <Fragment key={item.id}>
      {route?.length >= 2 && <><Polyline positions={route} interactive={false} pathOptions={{ color: '#ffffff', weight: 8, opacity: 1 }} /><Polyline positions={route} interactive={false} pathOptions={{ className: 'score-evidence-connection', color: item.color, weight: 4.5, opacity: 1 }} /></>}
      {map.latLngToLayerPoint(actual).distanceTo(map.latLngToLayerPoint(position)) > 1 && <Polyline positions={[actual, position]} interactive={false} pathOptions={{ color: item.color, weight: 1.5, opacity: .8, dashArray: '2 3' }} />}
      <EvidencePoint item={item} position={position} />
    </Fragment>;
  });
}

const HomeMarker = memo(function HomeMarker({ home, selected, hovered, onSelect }) {
  const events = useMemo(() => ({ click: () => onSelect(home) }), [onSelect, home]);
  return <Marker title={home.address} alt={`Map marker for ${home.address}`} position={[home.lat, home.lng]} icon={makeMarkerIcon(selected, hovered)} zIndexOffset={selected ? 2000 : hovered ? 1000 : 0} eventHandlers={events} />;
});

export default memo(function MapView({ homes, resources = [], visibleResourceTypes = [], denguePolicy, dengueNow = Date.now(), selectedHome, evidenceLocations = [], hoveredHome, anchors=[], onSelect, cameraIntent, homeFocusRequest = 0, facilityFocus, centerRequest, addressTarget, addressRequest, addressFocused = false, onViewportChange }) {
  const mappedHomes = useMemo(() => homes.filter(hasMapCoordinates), [homes]);
  const markerHomes = useMemo(() => {
    const byId = new Map(mappedHomes.map((home) => [String(home.id), home]));
    for (const home of [selectedHome, hoveredHome]) {
      if (hasMapCoordinates(home)) byId.set(String(home.id), home);
    }
    return [...byId.values()];
  }, [mappedHomes, selectedHome?.id, selectedHome?.lat, selectedHome?.lng, hoveredHome?.id, hoveredHome?.lat, hoveredHome?.lng]);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  return <MapContainer center={[1.3521, 103.8198]} zoom={11} scrollWheelZoom zoomControl className="h-full min-h-0 w-full">
    <TileLayer attribution="&copy; OpenStreetMap contributors" url={tileUrl} />
    <ResizeMap/><MapViewportListener onBoundsChange={onViewportChange} /><FitHomes homes={mappedHomes} selectedHome={selectedHome} addressTarget={addressTarget} /><FlyToSelected locations={evidenceLocations} home={selectedHome} request={homeFocusRequest} addressFocused={addressFocused} /><FocusResource facilityFocus={facilityFocus} /><FlyToAddress target={addressTarget} request={addressRequest} focused={addressFocused} /><ResetSingapore request={centerRequest} cameraIntent={cameraIntent} /><MemoResourceFeatures features={resources} visibleTypes={visibleResourceTypes} denguePolicy={denguePolicy} dengueNow={dengueNow} /><HoverPreview home={hoveredHome} selectedHome={selectedHome} addressTarget={addressTarget} />
    {anchors.map((anchor,i)=><Circle key={anchor.id} center={[anchor.lat,anchor.lng]} radius={anchor.radius} pathOptions={{color:['#42624f','#627f90','#8a7898'][i%3],fillOpacity:0.08,weight:2,dashArray:'5 5'}}><Popup>{anchor.label}: {anchor.radius.toLocaleString()} m straight-line reach</Popup></Circle>)}
    {hasMapCoordinates(selectedHome) && <EvidenceMarkers home={selectedHome} locations={evidenceLocations} />}
    {markerHomes.map(home => <HomeMarker key={home.id} home={home} selected={home.id === selectedHome?.id} hovered={home.id === hoveredHome?.id} onSelect={onSelect} />)}
    <AddressMarker target={addressTarget} />
  </MapContainer>;
});
