'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LoadingScene } from '@/components/loading-scene';

function sourceLabel(source) {
  if (!source) return null;
  if (typeof source === 'string') return source;
  const name = source.sourceId || source.sourceName || source.name;
  const version = source.sourceVersion || source.version;
  if (!name) return null;
  return version ? `${name} · ${version}` : name;
}

export function DataStatus({
  state,
  hasData = false,
  onRetry,
  retryLabel = 'Retry data',
  emptyMessage = 'The source returned no records.',
  liveDescription = 'Historical transaction records are not current listings. Use source dates and warnings below as context.',
  metadata,
  className,
  compact = false,
  showMetadata = true,
  liveTitle = 'Live source response received',
}) {
  if (!state) return null;

  const details = metadata === undefined ? state : metadata;
  const status = state.status || 'idle';
  const dataMode = details?.dataMode ?? state.dataMode;
  const error = state.error?.message;
  const stale = status === 'error' && hasData;
  const fixture = dataMode === 'fixture';
  const isError = status === 'error';

  let title;
  let description;
  let tone = 'info';

  if (status === 'loading' || status === 'idle') {
    title = hasData ? 'Updating data' : status === 'idle' ? 'Waiting to load data' : 'Loading data';
    description = hasData ? 'Previously loaded results remain visible while this request runs.' : 'Results will appear when the source request completes.';
  } else if (isError) {
    tone = 'error';
    title = stale ? 'Update failed; showing previous results' : 'Data could not be loaded';
    description = stale
      ? `${error || 'The latest source request failed.'} Previously loaded results remain available.`
      : error || 'The latest source request failed.';
  } else if (fixture) {
    tone = 'warning';
    title = 'Illustrative preview data';
    description = status === 'empty'
      ? 'No sample records are available in this preview.'
      : 'Addresses, prices and map points are illustrative only, not verified records or current listings.';
  } else if (status === 'empty') {
    title = emptyMessage;
  } else if (dataMode === 'live') {
    title = liveTitle;
    description = liveDescription;
  } else if (dataMode === 'mixed') {
    title = 'Mixed source data received';
    description = 'This result combines data from more than one source mode.';
  } else {
    title = 'Data loaded';
  }

  const summary = Array.isArray(details?.sourceSummary) ? details.sourceSummary.map(sourceLabel).filter(Boolean) : [];
  const warnings = Array.isArray(details?.warnings) ? details.warnings.filter(Boolean) : [];
  const retrievedAt = details?.retrievedAt;

  return (
    <Alert
      tone={tone}
      className={cn(
        'items-start justify-between gap-3',
        compact ? 'px-2.5 py-2 text-[10px]' : 'px-3 py-2.5 text-xs',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {status === 'loading' || status === 'idle' ? <LoadingScene compact label={title} /> : <p className="font-semibold">{title}</p>}
        {description && <p className="mt-0.5 leading-5 text-muted-foreground">{description}</p>}
        {showMetadata && retrievedAt && <p className="mt-1 text-muted-foreground">Retrieved at <time dateTime={retrievedAt}>{retrievedAt}</time></p>}
        {showMetadata && summary.length > 0 && <p className="mt-1 text-muted-foreground">Sources: {summary.join(', ')}</p>}
        {warnings.length > 0 && <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
      </div>
      {isError && onRetry && <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>{retryLabel}</Button>}
    </Alert>
  );
}
