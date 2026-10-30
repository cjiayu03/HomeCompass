export const HOME_FOCUS_MIN_ZOOM = 17;

export function selectedHomeZoom(currentZoom) {
  return Math.max(Number(currentZoom) || 0, HOME_FOCUS_MIN_ZOOM);
}

export function facilityClusterRadius(zoom) {
  if (zoom >= 17) return 1;
  if (zoom >= 15) return 12;
  return 48;
}
