'use client';

import { useState } from 'react';
import { MapPin, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScene } from '@/components/loading-scene';

const placeKinds = [
  ['workplace', 'Workplace'],
  ['school', 'School'],
  ['childcare', 'Childcare'],
  ['elder-care', 'Elder care'],
  ['other', 'Other'],
];

function formatDistance(distance) {
  if (distance == null || distance === '' || !Number.isFinite(Number(distance))) return 'Not set';
  const metres = Number(distance);
  return metres >= 1000 ? `${Number((metres / 1000).toFixed(1))} km` : `${metres} m`;
}

function formatTimestamp(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleString('en-SG', {timeZone:'Asia/Singapore'})} SGT`;
}

export function PlaceManager() {
  const { places, placeState, suggestPlaces, createPlace, createLocalPlace, deletePlace } = useWorkspace();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('workplace');
  const [maximumDistanceM, setMaximumDistanceM] = useState('2500');
  const [query, setQuery] = useState('');
  const [manualLatitude, setManualLatitude] = useState('');
  const [manualLongitude, setManualLongitude] = useState('');
  const local = placeState.status === 'local';
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [suggestionState, setSuggestionState] = useState('idle');
  const [suggestionError, setSuggestionError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const signedOut = placeState.status === 'signed_out';

  async function findCandidates(event) {
    event.preventDefault();
    setCandidates([]);
    setSelectedCandidate(null);
    setSuggestionError('');
    setSaveError('');
    if (!query.trim()) return;
    setSuggestionState('loading');
    try {
      const results = await suggestPlaces(query);
      setCandidates(results);
      setSuggestionState(results.length ? 'success' : 'empty');
    } catch (error) {
      setSuggestionState('error');
      setSuggestionError(error?.message || 'Address suggestions are unavailable. Please try again.');
    }
  }

  async function savePlace() {
    if (!selectedCandidate || !label.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const save = selectedCandidate.provider === 'user-entered' ? createLocalPlace : createPlace;
      await save({
        ...selectedCandidate,
        label: label.trim(),
        kind,
        maximumDistanceM: maximumDistanceM === '' ? null : Number(maximumDistanceM),
      });
      setLabel('');
      setQuery('');
      setCandidates([]);
      setSelectedCandidate(null);
      setSuggestionState('idle');
    } catch (error) {
      setSaveError(error?.message || 'This place could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function removePlace(place) {
    if(!window.confirm(`Remove ${place.label}? Any saved search using it will need its place constraint repaired.`))return;
    setDeletingId(place.id);
    setDeleteError('');
    try {
      await deletePlace(place.id);
    } catch (error) {
      setDeleteError(error?.message || 'This place could not be removed. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return <Card aria-label="Account places">
    <CardHeader>
      <CardTitle>Places for your household</CardTitle>
      <p className="text-sm text-muted-foreground">Save a work, school, childcare or care address for straight-line distance checks. Manual pins stay in this browser until you choose to upload them.</p>
    </CardHeader>
    <CardContent className="space-y-6">
      {signedOut && <Alert tone="info">Sign in to manage account places.</Alert>}
      {placeState.status === 'loading' && <LoadingScene compact label="Loading account places…" />}
      {placeState.status === 'error' && <Alert tone="warning">{placeState.error?.message || 'Saved places could not be loaded.'}</Alert>}
      {suggestionError && <Alert tone="warning">{suggestionError}</Alert>}
      {saveError && <Alert tone="warning">{saveError}</Alert>}
      {deleteError && <Alert tone="warning">{deleteError}</Alert>}

      <div className="space-y-4 rounded-xl border border-border/70 bg-background/35 p-4">
        <h4 className="text-sm font-semibold">{local ? 'Add a browser place' : 'Add an account place'}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-xs font-semibold">Place label
            <input aria-label="Place label" autoComplete="off" maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal" placeholder="Office or child's school" />
          </label>
          <label className="flex flex-col gap-2 text-xs font-semibold">Place type
            <select aria-label="Place type" value={kind} onChange={(event) => setKind(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal">
              {placeKinds.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-2 text-xs font-semibold">Maximum straight-line distance (estimated), metres
          <input aria-label="Maximum straight-line distance (estimated), metres" type="number" min="1" max="100000" step="1" value={maximumDistanceM} onChange={(event) => setMaximumDistanceM(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm font-normal" />
        </label>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={findCandidates}>
          <label className="sr-only" htmlFor="place-address-query">Search an address</label>
          <input id="place-address-query" aria-label="Search an address" autoComplete="off" maxLength={160} value={query} onChange={(event) => {
            setQuery(event.target.value);
            setCandidates([]);
            setSelectedCandidate(null);
            setSuggestionState('idle');
            setSuggestionError('');
          }} className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" placeholder="Search a Singapore address" />
          <Button type="submit" variant="outline" disabled={signedOut || suggestionState === 'loading' || !query.trim()}>
            {suggestionState === 'loading' ? 'Searching…' : 'Find address candidates'}
          </Button>
        </form>
        <p className="text-[11px] leading-4 text-muted-foreground">OneMap candidates use the coordinates you select. Manual pins are labelled user-entered and must be checked independently.</p>

        {!signedOut && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">Enter known coordinates instead</summary><p className="mt-2 text-xs text-muted-foreground">Use coordinates you have checked on a map. These browser-only pins are not verified addresses or travel times. Singapore coordinates only.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs">Latitude<input type="number" min="1.13" max="1.47" step="any" value={manualLatitude} onChange={e=>setManualLatitude(e.target.value)} className="h-10 rounded-lg border bg-background px-3"/></label><label className="grid gap-1 text-xs">Longitude<input type="number" min="103.59" max="104.07" step="any" value={manualLongitude} onChange={e=>setManualLongitude(e.target.value)} className="h-10 rounded-lg border bg-background px-3"/></label></div><Button type="button" variant="outline" size="sm" className="mt-3" disabled={!manualLatitude||!manualLongitude} onClick={()=>{const latitude=Number(manualLatitude),longitude=Number(manualLongitude);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<1.13||latitude>1.47||longitude<103.59||longitude>104.07){setSaveError('Enter coordinates within Singapore.');return;}setSelectedCandidate({latitude,longitude,provider:'user-entered',address:query.trim()||'User-entered map pin'});setSaveError('');}}>Use these coordinates</Button></details>}
        {selectedCandidate?.provider === 'user-entered' && <p role="status" className="text-xs">User-entered pin selected: {selectedCandidate.latitude}, {selectedCandidate.longitude}</p>}
        {suggestionState === 'empty' && <p className="text-sm text-muted-foreground">No address candidates found. Try a more specific address.</p>}
        {candidates.length > 0 && <fieldset className="space-y-2" aria-label="OneMap address candidates">
          <legend className="mb-2 text-xs font-semibold">Choose one address candidate</legend>
          {candidates.map((candidate) => <label key={candidate.selection_token} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04]">
            <input type="radio" name="place-candidate" aria-label={`Select ${candidate.address}`} checked={selectedCandidate?.selection_token === candidate.selection_token} onChange={() => { setSelectedCandidate(candidate); setSaveError(''); }} className="mt-1 accent-[hsl(var(--primary))]" />
            <span className="min-w-0"><span className="block font-medium">{candidate.address}</span><span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="size-3" />OneMap address candidate</span></span>
          </label>)}
        </fieldset>}
        <Button type="button" onClick={savePlace} disabled={signedOut || saving || !label.trim() || !selectedCandidate}>
          {saving ? 'Saving place…' : 'Save selected place'}
        </Button>
      </div>

      <section aria-label="Saved account places" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3"><h4 className="text-sm font-semibold">Saved account places</h4><span className="text-xs text-muted-foreground">{places.length}</span></div>
        {placeState.status === 'empty' && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No account places saved yet.</p>}
        {places.map((place) => <article key={place.id} className="rounded-xl border border-border/70 bg-background/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h5 className="font-semibold">{place.label}</h5>
              <p className="mt-1 text-sm text-muted-foreground">{place.address || 'Address unavailable'}</p>
              <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div><dt className="inline font-semibold text-foreground">Type: </dt><dd className="inline">{placeKinds.find(([value]) => value === place.kind)?.[1] || 'Other'}</dd></div>
                <div><dt className="inline font-semibold text-foreground">Provider: </dt><dd className="inline">{place.geocodeSource || 'Unknown'}</dd></div>
                <div><dt className="inline font-semibold text-foreground">Geocoded: </dt><dd className="inline"><time dateTime={place.geocodedAt || undefined}>{formatTimestamp(place.geocodedAt)}</time></dd></div>
                <div><dt className="inline font-semibold text-foreground">Maximum distance: </dt><dd className="inline">{formatDistance(place.maximumDistanceM)} · straight-line estimate</dd></div>
              </dl>
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${place.label}`} disabled={deletingId === place.id} onClick={() => removePlace(place)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </article>)}
      </section>
    </CardContent>
  </Card>;
}

export default PlaceManager;
