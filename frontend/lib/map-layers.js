// One layer registry keeps requests, controls and both map renderers consistent.
export const mapLayers = [
  ['silver_zone', 'Silver Zones', '#68886c'], ['dementia_gtp', 'Dementia-friendly points', '#697d91'],
  ['chas_clinic', 'CHAS clinics', '#7887a2'], ['eldercare', 'MOH eldercare services', '#426b80'],
  ['community_club', 'PA community clubs', '#865d40'], ['park_facility', 'NParks park facilities', '#3f7451'],
  ['childcare', 'Child care', '#8a7898'], ['student_care', 'Student care', '#6e8b7c'],
  ['kindergarten', 'Kindergartens', '#627f90'], ['school_zone', 'School zones', '#8291a6'],
  ['dengue_cluster', 'Dengue source snapshot', '#b65360'],
];
export const nearbyFacilityTypes = [
  'chas_clinic', 'eldercare', 'community_club', 'park_facility',
  'childcare', 'student_care', 'kindergarten', 'dementia_gtp',
];
export const resourceTypes = mapLayers.map(([type]) => type);
export const resourceColors = { ...Object.fromEntries(mapLayers.map(([type, , color]) => [type, color])), moe_school: '#596f88' };
export function resourceLabel(type) {
  return mapLayers.find(([key]) => key === type)?.[1] || (type === 'moe_school' ? 'MOE school' : type);
}
