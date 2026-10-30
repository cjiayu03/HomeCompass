import { SINGAPORE_MAP_BOUNDS } from '@/lib/map-address-search';

export function hasMapCoordinates(home) {
  const rawLatitude = home?.lat;
  const rawLongitude = home?.lng;
  if (rawLatitude == null || rawLongitude == null) return false;
  if ((typeof rawLatitude === 'string' && !rawLatitude.trim())
    || (typeof rawLongitude === 'string' && !rawLongitude.trim())
    || typeof rawLatitude === 'boolean' || typeof rawLongitude === 'boolean') return false;

  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= SINGAPORE_MAP_BOUNDS.latitude.min
    && latitude <= SINGAPORE_MAP_BOUNDS.latitude.max
    && longitude >= SINGAPORE_MAP_BOUNDS.longitude.min
    && longitude <= SINGAPORE_MAP_BOUNDS.longitude.max;
}
