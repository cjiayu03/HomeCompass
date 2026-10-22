'use client';

import { ScoreBreakdown } from '@/components/score-breakdown';

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFixture(home) {
  const semantics = home?.sourceSemantics?.toLowerCase();
  return semantics === 'fixture'
    || semantics === 'illustrative_fixture'
    || (typeof home?.source === 'string' && /\bfixture\b/i.test(home.source));
}

function semanticsLabel(home) {
  if (home?.sourceSemantics === 'historical_transaction') {
    return 'Historical transaction · not a current listing';
  }
  if (isFixture(home)) return 'Illustrative sample · not verified source data';
  return 'Source semantics unavailable';
}

function geocodeLabel(status) {
  if (typeof status !== 'string' || !status.trim()) return 'Geocode status unavailable';
  if (status === 'pending') return 'Geocoding pending';
  if (status === 'resolved') return 'Geocoding resolved';
  if (status === 'failed') return 'Geocoding failed';
  return `Geocode status: ${status}`;
}

export function EvidenceContext({ home, className = '' }) {
  const sourceDate = hasValue(home?.sourceUpdated) && home.sourceUpdated.toLowerCase() !== 'illustrative only'
    ? home.sourceUpdated
    : null;
  const transactionDate = hasValue(home?.observedOn)
    ? home.observedOn
    : hasValue(home?.transactionDate) ? home.transactionDate : null;

  return <section aria-label={`Evidence context for ${home?.address || 'this home'}`} className={`rounded-xl border border-border/70 bg-background/35 p-3 ${className}`}>
    <div className="space-y-2 text-xs leading-5">
      <p className="font-semibold text-foreground">{semanticsLabel(home)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
        <dt>Source</dt><dd className="min-w-0 break-words">{hasValue(home?.source) ? home.source : 'Unavailable'}</dd>
        {transactionDate
          ? <><dt>Transaction date</dt><dd><time dateTime={transactionDate}>{transactionDate}</time></dd></>
          : null}
        <dt>Source date</dt><dd>{sourceDate ? <time dateTime={sourceDate}>{sourceDate}</time> : 'unavailable'}</dd>
        <dt>Geocoding</dt><dd>{geocodeLabel(home?.geocodeStatus)}</dd>
        {hasValue(home?.geocodeSource)
          ? <><dt>Geocode source</dt><dd>{home.geocodeSource}</dd></>
          : null}
        {hasValue(home?.geocodedAt)
          ? <><dt>Geocoded at</dt><dd><time dateTime={home.geocodedAt}>{home.geocodedAt}</time></dd></>
          : null}
      </dl>
    </div>
    <ScoreBreakdown score={home?.score} scoreDetails={home?.scoreDetails} className="mt-3" />
  </section>;
}
