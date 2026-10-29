import { evaluateHome } from '@/lib/planning';

export function candidateReasons(home, brief = {}) {
  const result = evaluateHome(home, brief);
  const matches = [...result.matches];
  if (Number.isFinite(home.floorAreaSqm) && !matches.some(reason => /floor area/i.test(reason))) matches.push(`${home.floorAreaSqm} m² recorded floor area`);
  if (Number.isFinite(home.remainingLeaseYears) && !matches.some(reason => /lease/i.test(reason))) matches.push(`Approximately ${home.remainingLeaseYears} years remaining lease`);
  if (home.observedOn) matches.push(`Dated transaction: ${home.observedOn}`);
  const unique = [...new Set(matches)].slice(0, 2);
  return {
    matches: unique,
    tradeoff: result.compromises[0] || (result.missing.length ? `Evidence to check: ${result.missing.join(', ')}` : home.risks?.find(text => !/not a current listing/i.test(text))) || 'Current availability, condition and asking price are unavailable.',
  };
}

// Review intervals are product prompts, not guarantees of a source's update schedule.
export const sourceReviewDays = {
  dengue_cluster: 2,
  hdb_resale: 45,
  childcare_fees: 90, childcare_charges: 90,
  chas_clinic: 90, childcare: 90, childcare_registry: 90,
  student_care: 90, kindergarten: 90,
  community_club: 180, eldercare: 90, park_facility: 180,
  moe_school: 180, school_zone: 180, silver_zone: 180, dementia_gtp: 180,
  hdb_building: 365, hdb_property: 365,
};

export function sourceFreshness(source, now = new Date()) {
  const thresholdDays = sourceReviewDays[source?.resourceType];
  if (!['valid', 'degraded'].includes(source?.state)) return { state: 'unavailable', label: 'No imported evidence', thresholdDays };
  const value = source.sourceUpdatedAt || source.version;
  const updated = typeof value === 'string' && /^\d{4}-\d{2}(?:-\d{2})?(?:T.*)?$/.test(value) ? new Date(value) : null;
  if (!updated || !Number.isFinite(updated.getTime()) || updated > now || thresholdDays == null) return { state: 'unknown', label: 'Freshness unknown', thresholdDays };
  const ageDays = Math.floor((now - updated) / 86400000);
  return { state: ageDays > thresholdDays ? 'review' : 'within', label: ageDays > thresholdDays ? 'Source date needs review' : 'Within review interval', ageDays, thresholdDays };
}

export function monthlyChart(points = []) {
  const dated = points.filter(p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) && Number.isFinite(Number(p.median)) && p.median != null).map(p => ({ ...p, monthIndex: Number(p.month.slice(0, 4)) * 12 + Number(p.month.slice(5, 7)) - 1 })).sort((a, b) => a.monthIndex - b.monthIndex);
  if (!dated.length) return { points: [], segments: [], ticks: [] };
  const minimum = Math.min(...dated.map(p => Number(p.p25 ?? p.median))) * 0.95;
  const maximum = Math.max(...dated.map(p => Number(p.p75 ?? p.median))) * 1.05;
  const y = value => 200 - 160 * (Number(value) - minimum) / (maximum - minimum || 1);
  const first = dated[0].monthIndex, span = dated.at(-1).monthIndex - first;
  const coords = dated.map(p => ({ ...p, x: span ? 90 + (p.monthIndex - first) * 490 / span : 335, y: y(p.median), low: y(p.p25 ?? p.median), high: y(p.p75 ?? p.median) }));
  const segments = [];
  for (const point of coords) {
    const last = segments.at(-1);
    if (!last || point.monthIndex !== last.at(-1).monthIndex + 1) segments.push([point]);
    else last.push(point);
  }
  return { points: coords, segments, ticks: [minimum, (minimum + maximum) / 2, maximum].map(value => ({ value, y: y(value) })) };
}

export function cohortProfile(homes, { home, town } = {}) {
  const targetTown = town || home?.town;
  const records = homes.filter(item => item.sourceSemantics === 'historical_transaction' && (!targetTown || item.town === targetTown));
  const prices = records.map(item => item.price).filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const dates = records.map(item => item.observedOn || item.transactionDate).filter(Boolean).sort();
  const blocks = new Map();
  for (const item of records) {
    const key = item.address || 'Address unavailable';
    blocks.set(key, (blocks.get(key) || 0) + 1);
  }
  return { town: targetTown, count: records.length, pricedCount: prices.length, median: prices.length ? (prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2) : null, start: dates[0], end: dates.at(-1), blocks: [...blocks].sort((a, b) => b[1] - a[1]) };
}
