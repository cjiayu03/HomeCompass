import { dengueSeverityColors } from '@/lib/map-layers';

export const DENGUE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const NEA_DENGUE_URL = 'https://www.nea.gov.sg/dengue-zika/dengue/dengue-clusters';

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function hasValidSnapshotWindow(policy, now) {
  const sourceAt = timestamp(policy?.sourceUpdatedAt);
  const validUntil = timestamp(policy?.validUntil);
  return sourceAt !== null
    && validUntil !== null
    && sourceAt <= now
    && validUntil >= now
    && Math.abs(validUntil - sourceAt - DENGUE_MAX_AGE_MS) <= 1000;
}

export function evaluateDengueSnapshot(policy, now = Date.now()) {
  const checkedAt = Number.isFinite(now) ? now : Date.now();
  if (!policy || typeof policy !== 'object') {
    return { state: 'source_unavailable', label: 'Dengue status unavailable', usable: false };
  }
  const expiresAt = timestamp(policy.validUntil);
  if (expiresAt !== null && expiresAt < checkedAt) {
    return { ...policy, state: 'stale', label: 'NEA cluster snapshot is stale; polygons hidden', usable: false };
  }
  if (['stale', 'future_date', 'unknown_date', 'source_unavailable'].includes(policy.state)) {
    const labels = {
      stale: 'NEA cluster snapshot is stale; polygons hidden',
      future_date: 'NEA update date is invalid; polygons hidden',
      unknown_date: 'NEA update date unknown; polygons hidden',
      source_unavailable: 'NEA cluster data unavailable',
    };
    return { ...policy, label: labels[policy.state], usable: false };
  }
  if (!hasValidSnapshotWindow(policy, checkedAt)) {
    return { ...policy, state: 'unknown_date', label: 'NEA update date unknown; polygons hidden', usable: false };
  }
  if (policy.usable !== true || !['fresh', 'partial_coverage'].includes(policy.state)) {
    return { ...policy, state: 'partial_coverage', label: 'NEA cluster coverage is incomplete', usable: false };
  }
  return { ...policy, usable: true };
}

export function evaluateHomeDengueStatus(status, now = Date.now()) {
  if (!status || typeof status !== 'object' || typeof status.state !== 'string') {
    return { state: 'source_unavailable', label: 'Dengue status unavailable', severity: null };
  }
  const checkedAt = Number.isFinite(now) ? now : Date.now();
  const expiresAt = timestamp(status.validUntil);
  const sourceAt = timestamp(status.sourceUpdatedAt);
  if (expiresAt !== null && expiresAt < checkedAt) {
    return { ...status, state: 'stale', label: 'NEA cluster snapshot is stale; status hidden', severity: null };
  }
  if (['source_unavailable', 'unknown_date', 'stale', 'future_date', 'location_unavailable', 'partial_coverage'].includes(status.state)) {
    const labels = {
      source_unavailable: 'NEA dengue cluster data unavailable',
      unknown_date: 'NEA dengue update date unknown',
      stale: 'NEA dengue cluster snapshot is stale',
      future_date: 'NEA dengue update date is invalid',
      location_unavailable: 'Home location unavailable for cluster check',
      partial_coverage: 'NEA cluster data is incomplete; overlap is unknown',
    };
    return { ...status, label: labels[status.state], severity: null };
  }
  if (!sourceAt || !expiresAt || sourceAt > checkedAt || Math.abs(expiresAt - sourceAt - DENGUE_MAX_AGE_MS) > 1000) {
    return { ...status, state: 'unknown_date', label: 'NEA dengue update date unknown', severity: null };
  }
  if (status.state === 'active_cluster') {
    const count = status.caseCount;
    if (!Number.isSafeInteger(count) || count < 2) {
      return { ...status, state: 'partial_coverage', label: 'NEA cluster overlap found; case count unavailable', severity: null };
    }
    const severity = count >= 10 ? 'red' : 'yellow';
    return {
      ...status,
      severity,
      label: severity === 'red'
        ? 'Red: NEA high-risk cluster (10 or more cases)'
        : 'Yellow: NEA high-risk cluster (fewer than 10 cases)',
    };
  }
  if (status.state === 'no_active_cluster') {
    if (status.coverage !== 'complete') {
      return { ...status, state: 'partial_coverage', label: 'NEA cluster data is incomplete; overlap is unknown', severity: null };
    }
    return { ...status, severity: null, label: 'No active NEA cluster polygon overlap' };
  }
  return { ...status, state: 'source_unavailable', label: 'Dengue status unavailable', severity: null };
}

export function dengueFeatureColor(feature) {
  const count = feature?.properties?.caseCount;
  if (!Number.isSafeInteger(count) || count < 2) return null;
  return count >= 10 ? dengueSeverityColors.red : dengueSeverityColors.yellow;
}

export function filterCurrentDengueFeatures(features, policy, now = Date.now()) {
  const snapshot = evaluateDengueSnapshot(policy, now);
  if (!snapshot.usable) return (Array.isArray(features) ? features : []).filter(feature => feature?.properties?.resourceType !== 'dengue_cluster');
  const sourceAt = timestamp(snapshot.sourceUpdatedAt);
  return (Array.isArray(features) ? features : []).filter((feature) => {
    if (feature?.properties?.resourceType !== 'dengue_cluster') return true;
    const featureAt = timestamp(feature.properties.sourceUpdatedAt);
    const geometryType = feature?.geometry?.type;
    return featureAt === sourceAt
      && ['Polygon', 'MultiPolygon'].includes(geometryType)
      && dengueFeatureColor(feature) !== null;
  });
}

export function formatDengueTime(value, timeZone = 'Asia/Singapore') {
  const time = timestamp(value);
  if (time === null) return null;
  return new Intl.DateTimeFormat('en-SG', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(time);
}
