const componentLabels = { school: 'School', childcare: 'Childcare', care: 'Care access', place: 'Saved place' };
const routeColors = { school: '#1555c0', childcare: '#9b238f', care: '#007c68', place: '#b54a15' };
// Offset only markers that would overlap, in screen pixels; coordinates stay unchanged.
export function spreadEvidencePoints(points, home) {
  const occupied = [home];
  return points.map(point => {
    const free = candidate => occupied.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= 36);
    let result = point;
    if (!free(result)) {
      outer: for (let radius = 40; ; radius += 40) {
        const steps = Math.max(8, Math.ceil(2 * Math.PI * radius / 40));
        for (let i = 0; i < steps; i++) {
          const angle = 2 * Math.PI * i / steps;
          const candidate = { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
          if (free(candidate)) { result = candidate; break outer; }
        }
      }
    }
    occupied.push(result);
    return result;
  });
}
const located = item => item?.lat != null && item?.lng != null && typeof item.lat !== 'boolean' && typeof item.lng !== 'boolean' && String(item.lat).trim() !== '' && String(item.lng).trim() !== '' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)) && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lng)) <= 180;

export function selectedEvidenceLocations(home, places = []) {
  if (!located(home)) return [];
  const amenities = (Array.isArray(home.scoreLocations) ? home.scoreLocations : []).filter(item => located(item) && Object.hasOwn(componentLabels, item.component) && item.component !== 'place').map(item => ({
    ...item, id: `${item.component}:${item.id}`, label: componentLabels[item.component],
    color: routeColors[item.component],
    context: item.usedInScore ? 'Used in score' : 'Nearby evidence · not included in score',
  }));
  const checks = (Array.isArray(home.placeDistances) ? home.placeDistances : []).flatMap(check => {
    const place = places.find(item => String(item.id) === String(check.placeId));
    const location = place && { lat: place.latitude, lng: place.longitude };
    if (!located(location)) return [];
    return [{ ...location, id: `place:${place.id}`, component: 'place', label: componentLabels.place, name: place.label || check.label || 'Saved place', distanceM: check.distanceM, color: routeColors.place, context: 'Search distance check · not part of score' }];
  });
  return [...amenities, ...checks].map(item => {
    const east = (Number(item.lng) - Number(home.lng)) * Math.cos(Number(home.lat) * Math.PI / 180);
    const north = Number(item.lat) - Number(home.lat);
    const labelDirection = Math.abs(east) > Math.abs(north) ? (east >= 0 ? 'right' : 'left') : (north >= 0 ? 'top' : 'bottom');
    return { ...item, labelDirection, labelOffset: { right: [10, 0], left: [-10, 0], top: [0, -10], bottom: [0, 10] }[labelDirection] };
  });
}

export function evidenceCollection(home, locations) {
  if (!located(home)) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: locations.flatMap(item => {
    const properties = { ...item, evidenceId: item.id, distanceLabel: Number.isFinite(item.distanceM) ? `${Math.round(item.distanceM).toLocaleString()} m straight-line` : 'Distance unavailable' };
    return [
      { type: 'Feature', id: `${item.id}:point`, geometry: { type: 'Point', coordinates: [Number(item.lng), Number(item.lat)] }, properties },
      ...(item.route?.coordinates?.length >= 2 ? [{ type: 'Feature', id: `${item.id}:line`, geometry: { type: 'LineString', coordinates: item.route.coordinates }, properties }] : []),
    ];
  }) };
}
