'use client';

import { useEffect, useState } from 'react';
import { dengueSeverityColors, resourceColors } from '@/lib/map-layers';
import { evaluateHomeDengueStatus, evaluateDengueSnapshot, formatDengueTime, NEA_DENGUE_URL } from '@/lib/dengue-status';

const dengueClockSubscribers = new Map();
let dengueClockInterval = null;
let dengueExpiryTimer = null;

function notifyDengueClock() {
  for (const subscriber of dengueClockSubscribers.keys()) subscriber();
}

function scheduleDengueExpiry() {
  window.clearTimeout(dengueExpiryTimer);
  dengueExpiryTimer = null;
  const now = Date.now();
  const expiries = [...dengueClockSubscribers.values()]
    .map(value => value ? new Date(value).getTime() : NaN)
    .filter(value => Number.isFinite(value) && value >= now);
  if (!expiries.length) return;
  const nextExpiry = Math.min(...expiries);
  dengueExpiryTimer = window.setTimeout(() => {
    notifyDengueClock();
    scheduleDengueExpiry();
  }, Math.min(2147483647, Math.max(0, nextExpiry - now + 1)));
}

function subscribeDengueClock(subscriber, validUntil) {
  dengueClockSubscribers.set(subscriber, validUntil);
  if (dengueClockSubscribers.size === 1) {
    dengueClockInterval = window.setInterval(notifyDengueClock, 60_000);
    document.addEventListener('visibilitychange', notifyDengueClock);
    window.addEventListener('focus', notifyDengueClock);
    window.addEventListener('pageshow', notifyDengueClock);
  }
  scheduleDengueExpiry();
  return () => {
    dengueClockSubscribers.delete(subscriber);
    if (dengueClockSubscribers.size) {
      scheduleDengueExpiry();
      return;
    }
    window.clearInterval(dengueClockInterval);
    window.clearTimeout(dengueExpiryTimer);
    dengueClockInterval = null;
    dengueExpiryTimer = null;
    document.removeEventListener('visibilitychange', notifyDengueClock);
    window.removeEventListener('focus', notifyDengueClock);
    window.removeEventListener('pageshow', notifyDengueClock);
  };
}

export function useDengueNow(validUntil) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    return subscribeDengueClock(refresh, validUntil);
  }, [validUntil]);
  return now;
}

function stateTone(status) {
  if (status.severity === 'red') return 'text-destructive';
  if (status.severity === 'yellow') return 'text-amber-700 dark:text-amber-400';
  if (['stale', 'future_date', 'unknown_date', 'source_unavailable', 'partial_coverage'].includes(status.state)) return 'text-muted-foreground';
  return 'text-foreground';
}

export function DengueStatus({ home, compact = false, className = '' }) {
  const rawStatus = home?.dengue;
  const now = useDengueNow(rawStatus?.validUntil);
  const status = evaluateHomeDengueStatus(rawStatus, now);
  const sourceTime = formatDengueTime(status.sourceUpdatedAt);
  const checkedTime = formatDengueTime(status.checkedAt);
  const recordTime = formatDengueTime(status.featureUpdatedAt);
  const color = status.severity ? dengueSeverityColors[status.severity] : resourceColors.dengue_cluster;

  return <section className={`dengue-status min-w-0 ${compact ? 'text-[11px]' : 'text-xs'} ${className}`} data-state={status.state} aria-label="Dengue cluster status">
    <p className={`flex items-start gap-1.5 font-medium ${stateTone(status)}`}>
      <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span>{status.label}</span>
      {status.state === 'active_cluster' && status.caseCount != null && <span className="shrink-0 font-semibold">· {status.caseCount} cases</span>}
    </p>
    {!compact && status.locality && <p className="mt-1 pl-3.5 text-muted-foreground">{status.locality}</p>}
    {!compact && status.state === 'active_cluster' && status.coverage === 'partial' && <p className="mt-1 pl-3.5 text-muted-foreground">A matching polygon was found, but other cluster records may be missing.</p>}
    {status.state === 'no_active_cluster' && <p className="mt-1 pl-3.5 text-muted-foreground">This does not mean there is no dengue risk.</p>}
    {!compact && recordTime && <p className="mt-1 pl-3.5 text-muted-foreground">Feature record updated {recordTime}; this is not a case report date.</p>}
    {!compact && status.reason && !['active_cluster', 'no_active_cluster'].includes(status.state) && <p className="mt-1 pl-3.5 text-muted-foreground">{status.reason}</p>}
    {(sourceTime || checkedTime) && <p className="mt-1 pl-3.5 text-muted-foreground">
      {sourceTime && <>NEA snapshot as of {sourceTime} SGT</>}
      {sourceTime && checkedTime && ' · '}
      {checkedTime && <>checked {checkedTime} SGT</>}
    </p>}
    <p className="mt-1 pl-3.5"><a className="font-medium text-primary underline underline-offset-2" href={status.sourceUrl || NEA_DENGUE_URL} target="_blank" rel="noreferrer">Official NEA cluster map</a></p>
  </section>;
}

export function DengueLayerSummary({ policy, now = Date.now() }) {
  const status = evaluateDengueSnapshot(policy, now);
  const sourceTime = formatDengueTime(status.sourceUpdatedAt);
  const label = status.usable
    ? `${status.state === 'partial_coverage' ? 'Partial data · ' : ''}${sourceTime ? `Updated ${sourceTime} SGT` : 'Update date unavailable'}`
    : ({ stale: 'Expired data · hidden', unknown_date: 'Update date unverified', future_date: 'Invalid update date', source_unavailable: 'Data unavailable' }[status.state] || 'Data unavailable');
  return <span className="mt-1 block text-xs text-muted-foreground">{label}</span>;
}

export function DengueMapLegend({ policy, sourceLoading = false, sourceError = false, visibleFeatureCount = 0, nationalRowCount = null, now = Date.now(), className = '' }) {
  const status = evaluateDengueSnapshot(policy, now);
  const sourceTime = formatDengueTime(status.sourceUpdatedAt);
  const checkedTime = formatDengueTime(status.checkedAt);
  let message = '';
  if (!status.usable) message = {
    stale: 'Data expired. Overlay hidden.',
    unknown_date: 'Update date unverified. Overlay hidden.',
    future_date: 'Invalid update date. Overlay hidden.',
    source_unavailable: sourceLoading ? 'Loading dengue data…' : 'Dengue data unavailable.',
  }[status.state] || 'Dengue data unavailable.';
  else if (status.state === 'partial_coverage') message = 'Some cluster data is missing.';
  else if (nationalRowCount === 0) message = 'No active clusters reported.';
  else if (visibleFeatureCount === 0) message = 'No clusters loaded here.';

  return <section className={`dengue-map-legend pointer-events-auto rounded-lg border bg-background/95 p-3 text-xs shadow-soft backdrop-blur ${className}`} aria-label="NEA dengue map legend" data-state={status.state}>
    <h3 className="font-semibold">Dengue clusters</h3>
    {status.usable && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Cluster case bands">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: dengueSeverityColors.red }} /><span>Red · 10+ cases</span></span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: dengueSeverityColors.yellow }} /><span>Yellow · 2–9 cases</span></span>
    </div>}
    {message && <p className="mt-2 leading-4 text-muted-foreground" role="status">{message}</p>}
    {sourceTime && <p className="mt-2 leading-4 text-muted-foreground">Updated {sourceTime} SGT</p>}
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t pt-2">
      <details className="min-w-0 flex-1 text-muted-foreground">
        <summary className="cursor-pointer">About this layer</summary>
        <div className="mt-2 max-h-36 space-y-2 overflow-y-auto leading-5">
          <p>Shaded areas are NEA control boundaries, not an estimate of individual infection risk.</p>
          {nationalRowCount === 0 && status.usable && <p>No active clusters does not mean there is no dengue risk.</p>}
          {status.state === 'partial_coverage' && <p>Missing records mean no-overlap cannot be confirmed.</p>}
          <p>Data older than 48 hours, or without a verified update date, is hidden.</p>
          {checkedTime && <p>Checked {checkedTime} SGT.</p>}
          {status.reason && <p>{status.reason}</p>}
          {!status.usable && sourceError && <p>The last response cannot confirm the current data.</p>}
        </div>
      </details>
      <a className="font-medium text-primary underline underline-offset-2" aria-label="NEA source and cluster notes" href={status.sourceUrl || NEA_DENGUE_URL} target="_blank" rel="noreferrer">NEA ↗</a>
    </div>
  </section>;
}
