export const SINGAPORE_MAP_BOUNDS = Object.freeze({
  latitude: Object.freeze({ min: 1.13, max: 1.47 }),
  longitude: Object.freeze({ min: 103.59, max: 104.07 }),
});

export function isMapAddressCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  if (typeof candidate.address !== 'string' || !candidate.address.trim()) return false;
  if (typeof candidate.latitude !== 'number' || !Number.isFinite(candidate.latitude)) return false;
  if (typeof candidate.longitude !== 'number' || !Number.isFinite(candidate.longitude)) return false;
  return candidate.latitude >= SINGAPORE_MAP_BOUNDS.latitude.min
    && candidate.latitude <= SINGAPORE_MAP_BOUNDS.latitude.max
    && candidate.longitude >= SINGAPORE_MAP_BOUNDS.longitude.min
    && candidate.longitude <= SINGAPORE_MAP_BOUNDS.longitude.max;
}

export function normalizeMapAddressCandidates(items) {
  if (!Array.isArray(items) || items.some(item => !isMapAddressCandidate(item))) {
    throw new TypeError('Address search returned invalid results.');
  }

  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const address = item.address.trim().replace(/\s+/gu, ' ');
    const key = `${address.toLowerCase()}|${item.latitude.toFixed(6)}|${item.longitude.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      address,
      latitude: item.latitude,
      longitude: item.longitude,
      provider: 'OneMap',
    });
    if (normalized.length === 10) break;
  }
  return normalized;
}

const ROAD_WORDS = Object.freeze({
  AVE: 'AVENUE', RD: 'ROAD', ST: 'STREET', DR: 'DRIVE', CRES: 'CRESCENT',
  CL: 'CLOSE', PL: 'PLACE', TER: 'TERRACE', HTS: 'HEIGHTS', CTRL: 'CENTRAL',
  NTH: 'NORTH', STH: 'SOUTH', UPP: 'UPPER', LOR: 'LORONG', JLN: 'JALAN',
  BT: 'BUKIT', TG: 'TANJONG', KG: 'KAMPONG', MKT: 'MARKET',
});

function addressTokens(value) {
  const tokens = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/\b(?:BLOCK|BLK)\b/gu, ' ')
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .map((token) => ROAD_WORDS[token] || token);
  const singapore = tokens.indexOf('SINGAPORE');
  return singapore >= 0 ? tokens.slice(0, singapore) : tokens;
}

/** Match only an unambiguous OneMap result for this exact block and street. */
export function matchHomeMapCandidate(home, candidates) {
  const expected = addressTokens(home?.address);
  if (expected.length < 3 || !/^\d+[A-Z]?$/u.test(expected[0]) || !Array.isArray(candidates)) return null;

  const matches = candidates.filter((candidate) => {
    if (!isMapAddressCandidate(candidate)) return false;
    const actual = addressTokens(candidate.address);
    return actual.length >= expected.length
      && expected.every((token, index) => token === actual[index]);
  });
  const unique = new Map(matches.map((candidate) => (
    [`${candidate.latitude.toFixed(6)},${candidate.longitude.toFixed(6)}`, candidate]
  )));
  return unique.size === 1 ? unique.values().next().value : null;
}
