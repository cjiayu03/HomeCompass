'use client';

import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const icon = L.divIcon({ className: 'map-marker', html: '<span aria-hidden="true">•</span>', iconSize: [30, 30], iconAnchor: [15, 30] });

function ClickLocation({ onChange }) {
  useMapEvents({ click: event => onChange({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.lng.toFixed(6)) }) });
  return null;
}

export default function PlaceEntryMap({ value, onChange }) {
  return <div className="h-56 overflow-hidden rounded-xl border" aria-label="Choose a personal place on the map"><MapContainer center={[1.3521, 103.8198]} zoom={11} className="h-full w-full"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' /><ClickLocation onChange={onChange} />{value && <Marker icon={icon} position={[value.latitude, value.longitude]} />}</MapContainer></div>;
}
