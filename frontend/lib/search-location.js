import { briefValidationError } from './planning';

// Only public structured criteria belong in a shareable search URL.
// Free text, personal-place IDs, addresses, coordinates and notes stay out.
const numericFields = {
  budget: 'budget', school: 'schoolDistance', childcare: 'childcareDistance', care: 'careDistance',
  min_area: 'minFloorArea', max_area: 'maxFloorArea', min_storey: 'minStorey', max_storey: 'maxStorey',
  lease: 'minLease', price_sqm: 'maxPricePerSqm',
};
const safePreferences = new Set(['budget', 'towns', 'flatType', 'schoolDistance', 'childcareDistance', 'careDistance', ...Object.values(numericFields), 'observedAfter']);

export function readSearchLocation(search, fallback) {
  const params = new URLSearchParams(search);
  const neutral = { ...fallback, ...Object.fromEntries(Object.values(numericFields).map(field => [field, null])), observedAfter: null, preferredTowns: [], preferredFlatType: null, placeConstraints: [], pinLabel: '', pinLocation: '', requirements: {}, priorityWeights: { ...fallback.priorityWeights } };
  const brief = structuredClone(neutral);
  let hasFilters = params.get('search') === '1';
  for (const [param, field] of Object.entries(numericFields)) {
    if (!params.has(param)) continue;
    const value = Number(params.get(param));
    if (params.get(param) !== '' && Number.isFinite(value) && value >= 0 && value <= 10000000) { brief[field] = value; hasFilters = true; }
  }
  brief.preferredTowns = [...new Set(params.getAll('town').map(town => town.trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
  if (brief.preferredTowns.length) hasFilters = true;
  if (params.get('type')) { brief.preferredFlatType = params.get('type').slice(0, 40); hasFilters = true; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('from') || '')) { brief.observedAfter = params.get('from'); hasFilters = true; }
  for (const key of params.getAll('prefer')) if (safePreferences.has(key)) brief.requirements[key] = false;
  for (const key of ['school', 'childcare', 'care', 'affordability']) {
    if (!params.has(`weight_${key}`)) continue;
    const weight = Number(params.get(`weight_${key}`));
    if (Number.isInteger(weight) && weight >= 0 && weight <= 3) brief.priorityWeights[key] = weight;
  }
  const area = (params.get('area') || '').split(',').map(Number);
  const bounds = area.length === 4 && area.every(Number.isFinite) && area[0] >= 103.5 && area[2] <= 104.2 && area[1] >= 1.1 && area[3] <= 1.6 && area[0] < area[2] && area[1] < area[3] ? { west: area[0], south: area[1], east: area[2], north: area[3] } : null;
  if (bounds) hasFilters = true;
  const error = briefValidationError(brief);
  return { brief: error ? neutral : brief, error, bounds, hasFilters, saved: params.get('saved') === '1', view: params.get('view') === 'map' ? 'map' : 'homes', layout: params.get('layout') === 'map' ? 'map' : 'split', detailId: (params.get('detail') || '').slice(0, 100) };
}

export function searchLocation(brief, { saved = false, view = 'homes', detailId = '', layout = 'split', bounds = null } = {}) {
  const params = new URLSearchParams({ search: '1' });
  for (const [param, field] of Object.entries(numericFields)) if (brief[field] != null && brief[field] !== '') params.set(param, String(brief[field]));
  for (const town of brief.preferredTowns || []) params.append('town', town);
  if (brief.preferredFlatType) params.set('type', brief.preferredFlatType);
  if (brief.observedAfter) params.set('from', brief.observedAfter);
  for (const [key, value] of Object.entries(brief.requirements || {})) if (value === false && safePreferences.has(key)) params.append('prefer', key);
  for (const [key, value] of Object.entries(brief.priorityWeights || {})) if (['school', 'childcare', 'care', 'affordability'].includes(key)) params.set(`weight_${key}`, String(value));
  if (bounds) params.set('area', [bounds.west, bounds.south, bounds.east, bounds.north].join(','));
  if (saved) params.set('saved', '1');
  if (view === 'map') params.set('view', 'map');
  if (layout === 'map') params.set('layout', 'map');
  if (detailId) params.set('detail', detailId);
  return `/explore?${params.toString()}`;
}
