'use client';

import { useEffect, useMemo } from 'react';
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Badge } from '@/components/ui/badge';
import { money, scoreLabel } from '@/lib/utils';

function makeMarkerIcon(selected) {
  return L.divIcon({ className: '', html: `<span class="map-marker ${selected ? 'selected' : ''}"><span>${selected ? '★' : '•'}</span></span>`, iconSize: selected ? [39, 39] : [34, 34], iconAnchor: selected ? [7, 34] : [6, 30], popupAnchor: [10, -28] });
}

function FlyToSelected({ home }) {
  const map = useMap();
  useEffect(() => { if (hasCoordinates(home)) map.flyTo([home.lat, home.lng], Math.max(map.getZoom(), 13), { duration: 0.65 }); }, [home, map]);
  return null;
}

function FitHomes({ homes }) {
  const map = useMap();
  useEffect(() => { if (homes.length > 1) map.fitBounds(L.latLngBounds(homes.map((home) => [home.lat, home.lng])), { padding: [42, 42], maxZoom: 12 }); }, [homes, map]);
  return null;
}

function ResetSingapore({ request }) {
  const map = useMap();
  useEffect(() => { if (request) map.flyTo([1.3521, 103.8198], 11, { duration: 0.65 }); }, [request, map]);
  return null;
}

function hasCoordinates(home) {
  return home?.lat !== null && home?.lat !== undefined && home?.lng !== null && home?.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng));
}

const resourceColors = {
  silver_zone: '#68886c', dementia_gtp: '#697d91', chas_clinic: '#7887a2', childcare: '#8a7898',
  student_care: '#6e8b7c', kindergarten: '#627f90', moe_school: '#596f88', school_zone: '#8291a6',
  dengue_cluster: '#b65360',
};

function resourceLabel(type) {
  return ({ silver_zone: 'Silver Zone', dementia_gtp: 'Dementia-friendly point', chas_clinic: 'CHAS clinic', childcare: 'Child care', student_care: 'Student care', kindergarten: 'Kindergarten', moe_school: 'MOE school', school_zone: 'School zone', dengue_cluster: 'Active dengue cluster' })[type] || type;
}

function ResourceFeatures({ features, visibleTypes }) {
  const mapped = useMemo(() => features.filter((feature) => feature.geometry && visibleTypes.includes(feature.properties?.resourceType)), [features, visibleTypes]);
  const collection = useMemo(() => ({ type: 'FeatureCollection', features: mapped }), [mapped]);
  const style = (feature) => {
    const type = feature?.properties?.resourceType;
    const color = resourceColors[type] || '#718096';
    return { color, weight: type === 'dengue_cluster' ? 2 : 1.25, opacity: 0.8, fillColor: color, fillOpacity: type === 'dengue_cluster' ? 0.14 : 0.08, dashArray: type === 'school_zone' ? '4 5' : undefined };
  };
  const pointToLayer = (feature, latlng) => L.circleMarker(latlng, { radius: 5, color: '#ffffff', weight: 1.5, fillColor: resourceColors[feature?.properties?.resourceType] || '#718096', fillOpacity: 0.92 });
  const onEachFeature = (feature, layer) => {
    const properties = feature?.properties || {};
    const popup = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = properties.name || 'Source feature';
    popup.appendChild(name);
    const type = document.createElement('p');
    type.textContent = resourceLabel(properties.resourceType);
    popup.appendChild(type);
    const date = document.createElement('small');
    date.textContent = `Source snapshot: ${properties.retrievedAt ? new Date(properties.retrievedAt).toLocaleDateString() : 'date unavailable'}`;
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
  return <GeoJSON data={collection} style={style} pointToLayer={pointToLayer} onEachFeature={onEachFeature} />;
}

export default function MapView({ homes, resources = [], visibleResourceTypes = [], selectedHome, onSelect, centerRequest }) {
  const mappedHomes = useMemo(() => homes.filter(hasCoordinates), [homes]);
  const icons = useMemo(() => Object.fromEntries(mappedHomes.map((home) => [home.id, makeMarkerIcon(home.id === selectedHome?.id)])), [mappedHomes, selectedHome?.id]);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  return <MapContainer center={[1.3521, 103.8198]} zoom={11} scrollWheelZoom zoomControl className="h-full min-h-[420px] w-full"><TileLayer attribution="&copy; OpenStreetMap contributors" url={tileUrl} /><FitHomes homes={mappedHomes} /><FlyToSelected home={selectedHome} /><ResetSingapore request={centerRequest} /><ResourceFeatures features={resources} visibleTypes={visibleResourceTypes} />{mappedHomes.map((home) => <Marker key={home.id} position={[home.lat, home.lng]} icon={icons[home.id]} eventHandlers={{ click: () => onSelect(home) }}><Popup><div className="flex flex-col gap-2"><div><p className="font-semibold">{home.address}</p><p className="text-xs opacity-70">{home.town} · {money(home.price)}</p></div>{home.score !== null && home.score !== undefined && Number.isFinite(Number(home.score)) && <Badge>{home.score}/100 · {scoreLabel(home.score)}</Badge>}<p className="text-xs leading-4 opacity-75">{home.school || 'School distance unavailable'}<br />{home.childcare || 'Childcare distance unavailable'}<br />{home.care || 'Care distance unavailable'}</p></div></Popup></Marker>)}</MapContainer>;
}
