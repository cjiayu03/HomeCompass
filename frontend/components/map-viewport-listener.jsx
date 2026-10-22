'use client';

import { useMap, useMapEvents } from 'react-leaflet';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeViewportBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const coordinates = [bounds.west, bounds.south, bounds.east, bounds.north];
  if (coordinates.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) return null;
  const normalized = {
    west: clamp(bounds.west, -180, 180),
    south: clamp(bounds.south, -90, 90),
    east: clamp(bounds.east, -180, 180),
    north: clamp(bounds.north, -90, 90),
  };
  if (normalized.west >= normalized.east || normalized.south >= normalized.north) return null;
  return normalized;
}

export function MapViewportListener({ onBoundsChange }) {
  const map = useMap();
  useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      const normalized = normalizeViewportBounds({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
      if (normalized && typeof onBoundsChange === 'function') onBoundsChange(normalized);
    },
  });
  return null;
}
