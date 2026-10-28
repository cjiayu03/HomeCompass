'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { briefFromCriteria } from '@/lib/planning';
import { Bookmark, Clock3, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingScene } from '@/components/loading-scene';

function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : `${date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT`;
}

function savedPolicyVersion(search) {
  return search.lastResultMeta?.scorePolicyVersion
    || search.scorePolicy?.scoringVersion
    || 'Not available';
}

function sourceDescription(search) {
  const sources = Array.isArray(search.lastResultMeta?.sourceSummary) ? search.lastResultMeta.sourceSummary : [];
  if (sources.length) {
    return sources.map((source) => [source.sourceId, source.sourceVersion].filter(Boolean).join(' · ')).join(', ');
  }
  const snapshotCount = Array.isArray(search.lastSourceSnapshotIds) ? search.lastSourceSnapshotIds.length : 0;
  return snapshotCount ? `${snapshotCount} source ${snapshotCount === 1 ? 'snapshot' : 'snapshots'} attached` : 'No source snapshot yet';
}

function resultCountText(meta) {
  if (!meta) return 'Not run yet';
  const count = Number.isInteger(meta.total) ? meta.total : meta.count;
  return Number.isInteger(count) ? String(count) : 'Not available';
}

function differenceText(difference) {
  const change = difference?.total || difference?.count;
  if (!change || !Number.isInteger(change.current)) return null;
  const previous = Number.isInteger(change.previous) ? change.previous : 'unknown';
  const delta = Number.isInteger(change.delta) ? `${change.delta > 0 ? '+' : ''}${change.delta}` : null;
  return `Latest rerun: ${previous} to ${change.current} results${delta ? ` (${delta})` : ''}.`;
}

function SavedSearchRow({ search, state, renameSavedSearch, deleteSavedSearch, rerunSavedSearch, editSearch, onApplied }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(search.name);
  const busy = state.action && state.activeId === search.id;
  const rerun = state.reruns?.[search.id];
  const sources = Array.isArray(search.lastResultMeta?.sourceSummary) ? search.lastResultMeta.sourceSummary : [];

  async function saveName(event) {
    event.preventDefault();
    const result = await renameSavedSearch(search.id, nameDraft);
    if (result) setEditing(false);
  }

  const policyVersion = savedPolicyVersion(search);
  const difference = differenceText(rerun?.difference);
  const policyChange = rerun?.difference?.scorePolicyVersion?.changed
    ? `Score policy changed from ${rerun.difference.scorePolicyVersion.previous || 'unknown'} to ${rerun.difference.scorePolicyVersion.current || 'unknown'}.`
    : null;

  return <article className="rounded-xl border border-border/70 bg-background/55 p-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        {editing
          ? <form className="flex max-w-xl gap-2" onSubmit={saveName}>
            <label className="sr-only" htmlFor={`saved-search-name-${search.id}`}>Name this saved search</label>
            <Input id={`saved-search-name-${search.id}`} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={80} />
            <Button type="submit" size="sm" disabled={Boolean(busy) || !nameDraft.trim()}>{busy ? 'Saving…' : 'Save name'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setNameDraft(search.name); setEditing(false); }}>Cancel</Button>
          </form>
          : <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-lg font-semibold">{search.name}</h3>
            <Badge variant="secondary">{search.mode === 'natural_language' ? 'Phrase search' : 'Structured search'}</Badge>
          </div>}
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
          <div><dt className="font-semibold text-foreground">Created</dt><dd className="mt-0.5 text-muted-foreground">{formatDate(search.createdAt)}</dd></div>
          <div><dt className="font-semibold text-foreground">Last run</dt><dd className="mt-0.5 text-muted-foreground">{formatDate(search.lastRunAt)}</dd></div>
          <div><dt className="font-semibold text-foreground">Source freshness</dt><dd className="mt-0.5 text-muted-foreground">
            {sources.length
              ? <ul>{sources.map((source) => <li key={source.sourceId}>{source.sourceId || 'Source'} · {formatDate(source.retrievedAt)}</li>)}</ul>
              : 'Not available'}
          </dd></div>
          <div><dt className="font-semibold text-foreground">Sources</dt><dd className="mt-0.5 text-muted-foreground">{sourceDescription(search)}</dd></div>
          <div><dt className="font-semibold text-foreground">Score policy</dt><dd className="mt-0.5 text-muted-foreground">{policyVersion}</dd></div>
          <div><dt className="font-semibold text-foreground">Result count</dt><dd className="mt-0.5 text-muted-foreground">{resultCountText(search.lastResultMeta)}</dd></div>
        </dl>
        {difference && <p className="mt-3 text-xs font-medium text-foreground">{difference}</p>}
        {policyChange && <p className="mt-1 text-xs text-muted-foreground">{policyChange}</p>}
        {rerun?.metadata?.warnings?.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{rerun.metadata.warnings.join(' ')}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-label={`Rerun ${search.name}`} disabled={Boolean(busy)} onClick={async () => { const result = await rerunSavedSearch(search.id); if(result != null) { onApplied?.(); router.replace('/explore'); } }}>
          <RefreshCw className="size-3.5" />{busy && state.action === 'rerunning' ? 'Running…' : 'Rerun & view results'}
        </Button>
        <Button size="sm" variant="outline" aria-label={`Edit criteria for ${search.name}`} onClick={()=>editSearch(search)}>Edit criteria / repair places</Button>
        {!editing && <Button size="sm" variant="ghost" aria-label={`Rename ${search.name}`} disabled={Boolean(busy)} onClick={() => { setNameDraft(search.name); setEditing(true); }}>
          <Pencil className="size-3.5" />Rename
        </Button>}
        <Button size="sm" variant="ghost" aria-label={`Delete ${search.name}`} disabled={Boolean(busy)} onClick={() => { if(window.confirm(`Delete saved search “${search.name}”? This cannot be undone.`)) deleteSavedSearch(search.id); }}>
          <Trash2 className="size-3.5" />Delete
        </Button>
      </div>
    </div>
  </article>;
}

function HistoryRow({ entry, resumeSearch }) {
  const criteria = entry.criteria && typeof entry.criteria === 'object' ? entry.criteria : {};
  const query = typeof criteria.query === 'string' && criteria.query.trim() ? criteria.query.trim() : 'Search without a text query';
  const snapshots = Array.isArray(entry.sourceSnapshotIds) ? entry.sourceSnapshotIds : [];
  return <article className="flex flex-col gap-2 border-b border-border/60 py-4 last:border-0 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h3 className="truncate text-sm font-semibold">{query}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{entry.mode === 'natural_language' ? 'Phrase search' : 'Structured search'} · Budget {Number.isFinite(criteria.budget) ? new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(criteria.budget) : 'not set'}</p>
      <p className="mt-1 text-xs text-muted-foreground">{snapshots.length} source {snapshots.length === 1 ? 'snapshot' : 'snapshots'} · Policy version {entry.scoringVersion || 'not available'}</p>
    </div>
    <div className="flex shrink-0 flex-col gap-2"><time className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</time><Button variant="outline" size="sm" onClick={()=>resumeSearch(entry)}>Resume search</Button></div>
  </article>;
}

export function SavedDecisionSections({ onEdit, onApplied } = {}) {
  const { history, historyState, savedSearches, savedSearchState, refreshSavedDecisions, renameSavedSearch, deleteSavedSearch, rerunSavedSearch, brief, places, placeState, setBrief, setQuery, applySearch, flash } = useWorkspace();
  const router = useRouter();
  const [resumeBusy,setResumeBusy]=useState(false);
  function editableCriteria(criteria) {
    const availableIds = new Set((places || []).map(place=>String(place.id)));
    return {...criteria, place_constraints:(criteria?.place_constraints || []).filter(item=>availableIds.has(String(item.place_id)))};
  }
  function editSearch(search) {
    if((search.criteria?.place_constraints?.length||0)>0 && !['success','empty','local'].includes(placeState?.status)) { flash?.('Load your personal places before repairing this search. Retry loading places in Account settings.','info'); return; }
    const criteria=editableCriteria(search.criteria || {});
    const editedBrief = briefFromCriteria(brief,criteria);
    setBrief(editedBrief);
    onEdit?.(editedBrief);
    setQuery(criteria.query || '');
    flash?.('Search criteria loaded for editing. Unavailable personal places were removed. Review filters and apply; save a new search to keep the repaired criteria.','info');
    router.replace('/explore');
  }
  async function resumeSearch(entry) {
    if(resumeBusy)return;
    const criteria=entry.criteria || {};
    const repaired=editableCriteria(criteria);
    if((repaired.place_constraints?.length||0)!==(criteria.place_constraints?.length||0)){editSearch(entry);return;}
    setResumeBusy(true);
    try{const result=await applySearch(criteria.query||'',briefFromCriteria(brief,criteria), { interpret: false });if(result!=null){onApplied?.();router.replace('/explore');}}finally{setResumeBusy(false);}
  }
  const loading = savedSearchState.status === 'idle' || savedSearchState.status === 'loading';
  const signedOut = savedSearchState.status === 'signed_out';
  const historyLoading = historyState.status === 'idle' || historyState.status === 'loading';
  const historySignedOut = historyState.status === 'signed_out';
  const error = savedSearchState.error;
  const missingPlace = savedSearchState.status === 'missing_place';

  return <div className="grid gap-5 lg:grid-cols-2">
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Clock3 className="size-4 text-primary" /><CardTitle>Search history</CardTitle></div><p className="text-sm text-muted-foreground">A record of searches and the source snapshots available at the time.</p></CardHeader>
      <CardContent>
        {historySignedOut
          ? <p className="text-sm text-muted-foreground">Sign in to view account search history.</p>
          : historyLoading
            ? <LoadingScene compact label="Loading search history…" />
            : <>
              {historyState.status === 'error' && <Alert tone="warning" className="mb-3 flex-col gap-2">
                <p>Search history is unavailable until the request succeeds.</p>
                {historyState.error?.message && <p className="text-xs">{historyState.error.message}</p>}
                <Button size="sm" variant="outline" onClick={refreshSavedDecisions}>Retry loading search history</Button>
              </Alert>}
              {history.length
                ? <div className="divide-y divide-border/60">{history.map((entry) => <HistoryRow key={entry.id} entry={entry} resumeSearch={resumeSearch} />)}</div>
                : historyState.status === 'error'
                  ? null
                  : <p className="text-sm text-muted-foreground">No search history yet.</p>}
            </>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex items-center gap-2"><Bookmark className="size-4 text-primary" /><CardTitle>Saved searches</CardTitle></div><p className="text-sm text-muted-foreground">Keep search criteria and evidence together, then rerun against current sources.</p></CardHeader>
      <CardContent className="space-y-4">
        {signedOut && <Alert tone="info">Sign in to view, save, and rerun account searches.</Alert>}
        {loading && <LoadingScene compact label="Loading saved searches…" />}
        {error && <Alert tone="warning" className="flex-col gap-2">
          {missingPlace
            ? <p>No search was run. Use “Edit criteria / repair places” on the saved search below to remove unavailable places, review its filters and apply it again.</p>
            : <p>{error.message}</p>}
          {missingPlace && <p className="text-xs">{error.message}</p>}
          {!signedOut && <Button size="sm" variant="outline" onClick={refreshSavedDecisions}>Retry loading saved decisions</Button>}
        </Alert>}
        {!signedOut && !loading && savedSearches.length === 0 && savedSearchState.status !== 'error' && savedSearchState.status !== 'missing_place'
          && <p className="text-sm text-muted-foreground">No saved searches yet.</p>}
        {savedSearches.map((search) => <SavedSearchRow key={search.id} search={search} state={savedSearchState} renameSavedSearch={renameSavedSearch} deleteSavedSearch={deleteSavedSearch} rerunSavedSearch={rerunSavedSearch} editSearch={editSearch} onApplied={onApplied} />)}
      </CardContent>
    </Card>
  </div>;
}

export default SavedDecisionSections;
