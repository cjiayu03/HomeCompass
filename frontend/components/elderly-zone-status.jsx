'use client';

import { useDengueNow } from '@/components/dengue-status';

const sources = {
  silverZone: 'd_dc343c021aa470fc71da90d31e552a9a',
  dementiaGtp: 'd_e2d10e591bc8560b8946a0da24790fa5',
};

function currentStatus(raw, now) {
  if (!raw) return { state: 'unavailable', label: 'Status unavailable' };
  if (!['inside', 'outside', 'nearby', 'not_nearby'].includes(raw.state)) return raw;
  const updated = Date.parse(raw.sourceUpdatedAt);
  const expires = Date.parse(raw.validUntil);
  if (!Number.isFinite(updated) || !Number.isFinite(expires) || updated > now || expires < updated) {
    return { ...raw, state: 'unknown_date', label: 'Source update date unverified', distanceM: null };
  }
  if (now > expires) return { ...raw, state: 'stale', label: 'Source data is stale', distanceM: null };
  return raw;
}

export function elderlyZoneComparisonValue(home, kind) {
  const status = home?.elderlyZones?.[kind];
  if (!status) return null;
  // Ignore request timestamps so "Show differences only" compares evidence.
  return JSON.stringify([status.state, status.flag, status.distanceM, status.thresholdM,
    status.sourceUpdatedAt, status.snapshotId, status.rule]);
}

export function ElderlyZoneStatus({ home, kind }) {
  const raw = home?.elderlyZones?.[kind];
  // Share the existing evidence clock so cached flags expire while a panel is open.
  const now = useDengueNow(raw?.validUntil);
  const status = currentStatus(raw, now);
  const updated = status.sourceUpdatedAt ? new Date(status.sourceUpdatedAt) : null;
  const date = updated && Number.isFinite(updated.getTime())
    ? new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }).format(updated)
    : null;
  const hasDistance = Number.isFinite(status.distanceM) && status.distanceM >= 0
    && ['nearby', 'not_nearby'].includes(status.state);

  return <div className="min-w-0 space-y-1 text-xs leading-5" data-state={status.state}>
    <p className="font-medium text-foreground">{status.label}</p>
    {hasDistance && <p className="text-muted-foreground">Nearest point: ≈ {Math.ceil(status.distanceM).toLocaleString('en-SG')} m straight-line</p>}
    <p className="text-muted-foreground">{date ? <>Updated <time dateTime={status.sourceUpdatedAt}>{date}</time></> : 'Source update date unavailable'}</p>
    <details className="text-muted-foreground">
      <summary className="min-h-11 w-fit cursor-pointer content-center rounded-sm underline decoration-border underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Source and rule</summary>
      <div className="space-y-1 pb-1 pt-2">
        <p>{status.rule || (kind === 'silverZone' ? 'Polygon containment, including the boundary; no proximity buffer.' : 'Straight-line proximity to a published Go-To-Point. Status requires a current, complete source.')}</p>
        <a className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" href={`https://data.gov.sg/datasets/${sources[kind]}/view`} target="_blank" rel="noreferrer">View published dataset</a>
      </div>
    </details>
  </div>;
}
