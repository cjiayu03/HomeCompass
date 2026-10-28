// Decision previews use evidence returned by the API; no model calls or inferred amenities.
export const advancedFields = {
  minFloorArea: ['min_floor_area_sqm', 'Minimum area', 'm²'],
  maxFloorArea: ['max_floor_area_sqm', 'Maximum area', 'm²'],
  minStorey: ['min_storey', 'Minimum storey', ''],
  maxStorey: ['max_storey', 'Maximum storey', ''],
  minLease: ['min_remaining_lease_years', 'Minimum estimated lease', 'years'],
  maxPricePerSqm: ['max_price_per_sqm', 'Maximum price / m²', 'SGD'],
  observedAfter: ['observed_after', 'Transactions from', ''],
};

// Source bands are historical evidence and do not establish an exact floor.
export function parseStoreyRange(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/^ +| +$/g, '');
  const match = /^([0-9]{1,3}) +TO +([0-9]{1,3})$/.exec(text);
  if (!match || match[0].length !== text.length) return null;
  const lower = Number(match[1]), upper = Number(match[2]);
  return lower >= 1 && lower <= upper && upper <= 999 ? { lower, upper } : null;
}

export function storeyOverlap(value, min, max) {
  const band = parseStoreyRange(value);
  if (!band) return null;
  return (min == null || band.upper >= Number(min)) && (max == null || band.lower <= Number(max));
}

export function storeyRangeValidationError(brief) {
  const values = [brief.minStorey, brief.maxStorey].map(value => value === '' || value == null ? null : !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim()) ? NaN : Number(value));
  if (values.some(value => value != null && (!Number.isInteger(value) || value < 1 || value > 100))) return 'Enter whole storeys from 1 to 100.';
  if (values[0] != null && values[1] != null && values[0] > values[1]) return 'Minimum storey cannot exceed maximum storey.';
  return null;
}

// Validate every entered value before any request or local filtering.
export function briefValidationError(brief) {
  const present = value => value !== '' && value != null;
  for (const [key, label, min, max, integer] of [
    ['budget', 'Budget', 0, 10_000_000, true],
    ['adults', 'Adults', 1, 30, true], ['children', 'Children', 0, 30, true], ['olderAdults', 'Older adults', 0, 30, true],
    ['schoolDistance', 'School distance', 0, 100_000, true], ['childcareDistance', 'Childcare distance', 0, 100_000, true], ['careDistance', 'Care distance', 0, 100_000, true],
    ['minFloorArea', 'Minimum floor area', 0, 1000, false], ['maxFloorArea', 'Maximum floor area', 0, 1000, false],
    ['minLease', 'Minimum lease', 0, 99, true], ['maxPricePerSqm', 'Maximum price per square metre', 0, 1_000_000, false],
  ]) {
    if (!present(brief[key])) continue;
    const value = Number(brief[key]);
    if (!['number', 'string'].includes(typeof brief[key]) || (typeof brief[key] === 'string' && !brief[key].trim()) || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      return `${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max.toLocaleString()}.`;
    }
  }
  const storeyError = storeyRangeValidationError(brief);
  if (storeyError) return storeyError;
  if (present(brief.minFloorArea) && present(brief.maxFloorArea) && Number(brief.minFloorArea) > Number(brief.maxFloorArea)) return 'Minimum floor area cannot exceed maximum floor area.';
  if (present(brief.observedAfter)) {
    const value = String(brief.observedAfter);
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'Enter a valid transaction date.';
  }
  if (brief.preferredTowns && (!Array.isArray(brief.preferredTowns) || brief.preferredTowns.length > 30 || brief.preferredTowns.some(town => typeof town !== 'string' || !town.trim() || town.length > 80))) return 'Choose up to 30 valid towns.';
  if (brief.preferredFlatType != null && (typeof brief.preferredFlatType !== 'string' || brief.preferredFlatType.length > 40)) return 'Choose a valid flat type.';
  if (brief.priorityWeights != null && (Object.keys(brief.priorityWeights).length !== 4 || ['school', 'childcare', 'care', 'affordability'].some(key => typeof brief.priorityWeights[key] !== 'number' || !Number.isFinite(brief.priorityWeights[key]) || brief.priorityWeights[key] < 0 || brief.priorityWeights[key] > 3))) return 'Priority weights must be numbers from 0 to 3.';
  const constraints = brief.placeConstraints || [];
  if (!Array.isArray(constraints) || constraints.length > 10 || constraints.some(c => typeof c?.placeId !== 'string' || !c.placeId || c.maxDistanceM == null || c.maxDistanceM === '' || !['number', 'string'].includes(typeof c.maxDistanceM) || !Number.isInteger(Number(c.maxDistanceM)) || Number(c.maxDistanceM) < 0 || Number(c.maxDistanceM) > 100_000) || new Set(constraints.map(c => c.placeId)).size !== constraints.length) return 'Choose unique places and whole maximum distances from 0 to 100,000 metres.';
  return null;
}

export function buildCriteria(brief) {
  const hard = key => brief.requirements?.[key] !== false;
  const criteria = {};
  if (hard('budget') && brief.budget !== '' && brief.budget != null) criteria.budget = Number(brief.budget);
  if (hard('towns') && brief.preferredTowns?.length) criteria.towns = brief.preferredTowns;
  if (hard('flatType') && brief.preferredFlatType) criteria.flat_type = brief.preferredFlatType;
  for(const [key,api] of [['schoolDistance','max_school_distance_m'],['childcareDistance','max_childcare_distance_m'],['careDistance','max_care_distance_m']]) if(hard(key)&&brief[key]!==''&&brief[key]!=null&&Number.isInteger(Number(brief[key]))) criteria[api]=Number(brief[key]);
  for(const [key,[api]] of Object.entries(advancedFields)) if(hard(key) && brief[key]!=='' && brief[key]!=null) criteria[api]=key==='observedAfter' ? brief[key] : Number(brief[key]);
  return criteria;
}

export function briefFromCriteria(current, criteria) {
  const requirements={...current.requirements,budget:criteria.budget!=null,towns:Boolean(criteria.towns?.length||criteria.town),flatType:Boolean(criteria.flat_type)};
  const next={...current,budget:criteria.budget??current.budget,preferredTowns:criteria.towns||(criteria.town?[criteria.town]:[]),preferredFlatType:criteria.flat_type||null};
  for(const [key,api] of [['schoolDistance','max_school_distance_m'],['childcareDistance','max_childcare_distance_m'],['careDistance','max_care_distance_m']]){next[key]=criteria[api]??null;requirements[key]=criteria[api]!=null;}
  for(const [key,[api]] of Object.entries(advancedFields)){next[key]=criteria[api]??null;requirements[key]=true;}
  return {...next,requirements,priorityWeights:criteria.priority_weights||current.priorityWeights,placeConstraints:(criteria.place_constraints||[]).map(c=>({placeId:c.place_id,maxDistanceM:c.max_distance_m}))};
}

export function distanceM(a, b) {
  const latA = Number(a?.lat ?? a?.latitude), lngA = Number(a?.lng ?? a?.longitude);
  const latB = Number(b?.lat ?? b?.latitude), lngB = Number(b?.lng ?? b?.longitude);
  if ([a?.lat ?? a?.latitude, a?.lng ?? a?.longitude, b?.lat ?? b?.latitude, b?.lng ?? b?.longitude].some(v => v == null) || ![latA,lngA,latB,lngB].every(Number.isFinite)) return null;
  const radians = Math.PI / 180;
  const q = Math.sin((latB-latA)*radians/2)**2 + Math.cos(latA*radians)*Math.cos(latB*radians)*Math.sin((lngB-lngA)*radians/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}

export function evaluateHome(home, brief) {
  const matches = [], compromises = [], missing = [];
  const budget = Number(brief.budget);
  if (Number.isFinite(home.price) && budget > 0) {
    (home.price <= budget ? matches : compromises).push(home.price <= budget ? `Within budget by $${Math.round(budget-home.price).toLocaleString()}` : `$${Math.round(home.price-budget).toLocaleString()} above budget`);
  } else missing.push('Price');
  const components = home.scoreDetails?.components || [];
  for (const c of components) {
    if (c.name === 'affordability') continue;
    const label = ({school:'School access',childcare:'Childcare access',care:'Care access'})[c.name] || c.name;
    const target=Number(brief[`${c.name}Distance`]);
    const meters=home.amenityDistancesM?.[c.name];
    if(meters!=null&&target>0)(meters<=target?matches:compromises).push(`${label}: ${Math.round(meters)} m straight-line (${target} m target)`);
    else if (!Number.isFinite(c.normalizedValue) || c.evidenceStatus === 'missing') missing.push(label);
    else (c.normalizedValue >= 60 ? matches : compromises).push(`${label}: ${Math.round(c.normalizedValue)}/100`);
  }
  if (!components.length) missing.push('Verified amenity distances');
  if (Number(brief.minFloorArea) > 0) {
    if (home.floorAreaSqm == null) missing.push('Floor area');
    else (home.floorAreaSqm >= Number(brief.minFloorArea) ? matches : compromises).push(`${home.floorAreaSqm} m² floor area`);
  }
  if (Number(brief.minLease) > 0) {
    if (home.remainingLeaseYears == null) missing.push('Estimated remaining lease');
    else (home.remainingLeaseYears >= Number(brief.minLease) ? matches : compromises).push(`About ${home.remainingLeaseYears} years of lease`);
  }
  if(brief.preferredTowns?.length)(brief.preferredTowns.some(t=>t.toLowerCase()===String(home.town).toLowerCase())?matches:compromises).push(`${home.town}: ${brief.preferredTowns.some(t=>t.toLowerCase()===String(home.town).toLowerCase())?'preferred town':'outside preferred towns'}`);
  const normalize=v=>String(v||'').replace(/[-_]/g,' ').toUpperCase();
  if(brief.preferredFlatType)(normalize(home.type)===normalize(brief.preferredFlatType)?matches:compromises).push(`${home.type}: ${normalize(home.type)===normalize(brief.preferredFlatType)?'preferred flat type':'alternative flat type'}`);
  for (const hard of [true, false]) {
    const min = brief.minStorey !== '' && brief.minStorey != null && (brief.requirements?.minStorey !== false) === hard ? Number(brief.minStorey) : null;
    const max = brief.maxStorey !== '' && brief.maxStorey != null && (brief.requirements?.maxStorey !== false) === hard ? Number(brief.maxStorey) : null;
    if (min == null && max == null) continue;
    const target = min != null && max != null ? `${min}–${max}` : min != null ? `${min} or higher` : `${max} or lower`;
    const label = `${hard ? 'Must-have' : 'Preference'} storeys ${target}`;
    const overlap = storeyOverlap(home.storeyRange, min, max);
    if (overlap == null) missing.push(`${label}: reported storey range unavailable`);
    else (overlap ? matches : compromises).push(`${label}: reported ${home.storeyRange} ${overlap ? 'has a possible overlap' : 'does not overlap'} (exact floor unavailable)`);
  }
  for(const [key,label,value,comparison] of [
    ['maxFloorArea','Maximum floor area',home.floorAreaSqm,(v,t)=>v<=t],
    ['maxPricePerSqm','Price per m²',home.pricePerSqm,(v,t)=>v<=t],
    ['observedAfter','Transaction date',home.observedOn,(v,t)=>v>=t],
  ]) {
    if(brief[key]!=null&&brief[key]!=='') {
      if(value==null)missing.push(label);
      else (comparison(value,brief[key])?matches:compromises).push(`${label}: ${value} (${comparison(value,brief[key])?'meets target':'outside target'})`);
    }
  }
  return {matches, compromises, missing:[...new Set(missing)]};
}

export function previewRank(home, brief, weights, areaRange) {
  const details = home.scoreDetails?.components || [];
  let total = 0, covered = 0, possible = 0;
  const clamp=n=>Math.max(0,Math.min(100,n));
  const budget=[Number.isFinite(home.price)&&Number(brief.budget)>0 ? clamp((1-home.price/(Number(brief.budget)*1.5))*100) : null];
  if(Number(brief.maxPricePerSqm)>0)budget.push(Number.isFinite(home.pricePerSqm)?clamp(Number(brief.maxPricePerSqm)/home.pricePerSqm*100):null);
  if(brief.observedAfter)budget.push(home.observedOn ? home.observedOn>=brief.observedAfter?100:0 : null);
  const space=[Number.isFinite(home.floorAreaSqm) ? (Number(brief.minFloorArea)>0?clamp(home.floorAreaSqm/Number(brief.minFloorArea)*100):areaRange[1]===areaRange[0]?50:100*(home.floorAreaSqm-areaRange[0])/(areaRange[1]-areaRange[0])) : null];
  if(Number(brief.maxFloorArea)>0)space.push(home.floorAreaSqm!=null?clamp(Number(brief.maxFloorArea)/home.floorAreaSqm*100):null);
  if(Number(brief.minLease)>0)space.push(home.remainingLeaseYears!=null?clamp(home.remainingLeaseYears/Number(brief.minLease)*100):null);
  const normalize=v=>String(v||'').replace(/[-_]/g,' ').toUpperCase();
  if(brief.preferredFlatType)space.push(normalize(home.type)===normalize(brief.preferredFlatType)?100:0);
  const minStorey = Number(brief.minStorey) > 0 ? Number(brief.minStorey) : null;
  const maxStorey = Number(brief.maxStorey) > 0 ? Number(brief.maxStorey) : null;
  if (minStorey != null || maxStorey != null) {
    const overlap = storeyOverlap(home.storeyRange, minStorey, maxStorey);
    space.push(overlap == null ? null : overlap ? 100 : 0);
  }
  const location=['school','childcare','care'].map(name=>{
    const target=Number(brief[`${name}Distance`]),distance=home.amenityDistancesM?.[name];
    if(target>0&&distance!=null)return clamp(100*(1-distance/(target*2)));
    const c=details.find(c=>c.name===name);
    return Number.isFinite(c?.normalizedValue)?c.normalizedValue:null;
  });
  if(brief.preferredTowns?.length)location.push(brief.preferredTowns.some(t=>t.toLowerCase()===String(home.town).toLowerCase())?100:0);
  const terms=[[weights.budget,budget],[weights.space,space],[weights.location,location]].flatMap(([weight,values])=>values.map(value=>[weight/values.length,value]));
  for (const [weight, value] of terms) { possible+=weight; if (value != null) {total+=weight*value; covered+=weight;} }
  return {score:covered ? Math.round(total/covered) : null,coverage:possible ? covered/possible : 0};
}

export function applyLocalRequirements(homes, brief) {
  return homes.filter(home => {
    const active = key => brief.requirements?.[key] !== false && brief[key] !== '' && brief[key] != null;
    const n = key => active(key) ? Number(brief[key]) : null;
    if (active('minFloorArea') && !(home.floorAreaSqm != null && home.floorAreaSqm >= n('minFloorArea'))) return false;
    if (active('maxFloorArea') && !(home.floorAreaSqm != null && home.floorAreaSqm <= n('maxFloorArea'))) return false;
    if (active('minLease') && !(home.remainingLeaseYears != null && home.remainingLeaseYears >= n('minLease'))) return false;
    if (active('maxPricePerSqm') && !(home.pricePerSqm != null && home.pricePerSqm <= n('maxPricePerSqm'))) return false;
    const minStorey = n('minStorey') || null, maxStorey = n('maxStorey') || null;
    if ((minStorey != null || maxStorey != null) && storeyOverlap(home.storeyRange, minStorey, maxStorey) !== true) return false;
    if(brief.requirements?.observedAfter!==false && brief.observedAfter && !(home.observedOn && home.observedOn>=brief.observedAfter)) return false;
    return true;
  });
}
