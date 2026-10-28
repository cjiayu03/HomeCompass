export const APP_NAME = 'HomeCompass';

export const homes = [
  { id: 'blk-118', address: '118 Jalan Bukit Merah', town: 'Bukit Merah', price: 488000, type: '4-room', score: null, lat: 1.283, lng: 103.817, sourceUpdated: 'Illustrative only', source: 'Illustrative fixture · not official data', distance: null, school: null, childcare: null, care: null, risk: 'Not assessed', highlights: [], risks: ['Illustrative address, price and map point; not a real source record'] },
  { id: 'blk-254', address: '254 Serangoon Avenue 2', town: 'Serangoon', price: 535000, type: '5-room', score: null, lat: 1.355, lng: 103.871, sourceUpdated: 'Illustrative only', source: 'Illustrative fixture · not official data', distance: null, school: null, childcare: null, care: null, risk: 'Not assessed', highlights: [], risks: ['Illustrative address, price and map point; not a real source record'] },
  { id: 'blk-611', address: '611 Bedok Reservoir Road', town: 'Bedok', price: 442000, type: '4-room', score: null, lat: 1.337, lng: 103.93, sourceUpdated: 'Illustrative only', source: 'Illustrative fixture · not official data', distance: null, school: null, childcare: null, care: null, risk: 'Not assessed', highlights: [], risks: ['Illustrative address, price and map point; not a real source record'] },
  { id: 'blk-49', address: '49 Toa Payoh East', town: 'Toa Payoh', price: 476000, type: '4-room', score: null, lat: 1.333, lng: 103.849, sourceUpdated: 'Illustrative only', source: 'Illustrative fixture · not official data', distance: null, school: null, childcare: null, care: null, risk: 'Not assessed', highlights: [], risks: ['Illustrative address, price and map point; not a real source record'] },
  { id: 'blk-802', address: '802 Tampines Street 81', town: 'Tampines', price: 421000, type: '4-room', score: null, lat: 1.348, lng: 103.936, sourceUpdated: 'Illustrative only', source: 'Illustrative fixture · not official data', distance: null, school: null, childcare: null, care: null, risk: 'Not assessed', highlights: [], risks: ['Illustrative address, price and map point; not a real source record'] },
];

export const defaultBrief = {
  adults: 2,
  children: 0,
  olderAdults: 0,
  budget: null,
  preferredTowns: [],
  preferredFlatType: null,
  schoolDistance: null,
  childcareDistance: null,
  careDistance: null,
  pinLabel: '',
  pinLocation: '',
  requirements: { budget: false },
  priorityWeights: { school: 1, childcare: 1, care: 1, affordability: 1 },
};

export const navigation = [
  { href: '/explore', label: 'Explore', short: 'Map' },
  { href: '/shortlist', label: 'Shortlist', short: 'Saved' },
  { href: '/compare', label: 'Compare', short: 'Table' },
  { href: '/sources', label: 'Sources', short: 'Data' },
  { href: '/account', label: 'Account', short: 'You' },
];

export function filterHomes(source, query, brief) {
  const q = query.trim().toLowerCase();
  const preferredTowns = Array.isArray(brief.preferredTowns)
    ? brief.preferredTowns.map((town) => town.toLocaleLowerCase())
    : [];
  const preferredFlatType = typeof brief.preferredFlatType === 'string'
    ? brief.preferredFlatType.toLocaleUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  return source.filter((home) => {
    const matchesQuery = !q || `${home.address} ${home.town} ${home.school} ${home.childcare} ${home.care} ${(home.highlights || []).join(' ')}`.toLowerCase().includes(q) || /school|child|care|clinic|quiet|elder/.test(q);
    const matchesTown = brief.requirements?.towns===false || !preferredTowns.length || preferredTowns.includes(String(home.town || '').toLocaleLowerCase());
    const homeFlatType = String(home.type || '').toLocaleUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const matchesFlatType = brief.requirements?.flatType===false || !preferredFlatType || homeFlatType === preferredFlatType;
    return matchesQuery && matchesTown && matchesFlatType && (brief.requirements?.budget===false || (brief.budget == null || brief.budget === '' || (home.price != null && home.price <= Number(brief.budget))));
  });
}
