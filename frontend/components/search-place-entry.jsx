'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

const PlaceEntryMap = dynamic(() => import('@/components/place-entry-map'), { ssr: false, loading: () => <div className="h-56 rounded-xl border p-4 text-sm">Loading place picker…</div> });

export function SearchPlaceEntry({ onAdded, onCancel }) {
  const { suggestPlaces, createPlace, createLocalPlace } = useWorkspace();
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [point, setPoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function find(event) {
    event.preventDefault(); setBusy(true); setError(''); setSelected(null);
    try { setCandidates(await suggestPlaces(address)); } catch { setError('Address lookup is unavailable. You can choose a temporary location on the map or enter its coordinates below.'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      if (!label.trim()) throw new Error('Give this place a label.');
      let place;
      if (selected) place = await createPlace({ ...selected, label: label.trim(), kind: 'other', maximumDistanceM: 5000 });
      else {
        if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < 1.15 || point.latitude > 1.5 || point.longitude < 103.55 || point.longitude > 104.15) throw new Error('Choose a point within Singapore, or enter valid Singapore coordinates.');
        place = await createLocalPlace({ provider: 'user-entered', label: label.trim(), address: address.trim() || 'User-selected map point', ...point, kind: 'other', maximumDistanceM: 5000 });
      }
      if (place) onAdded(place);
    } catch (failure) { setError(failure.message || 'This place could not be added.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><label className="grid gap-2 text-sm font-semibold">Place label<Input autoComplete="off" maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="Workplace, parents, school…" /></label><form onSubmit={find} className="space-y-2"><label className="grid gap-2 text-sm">Singapore address<Input autoComplete="off" value={address} onChange={event => { setAddress(event.target.value); setCandidates([]); setSelected(null); }} placeholder="Enter a street or postal code" /></label><Button type="submit" variant="outline" disabled={busy || !address.trim()}>Find address</Button></form>{candidates.length > 0 && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Select a verified address</legend>{candidates.map(candidate => <label key={candidate.selection_token} className="flex min-h-11 gap-3 rounded-lg border p-3 text-sm"><input type="radio" name="search-place" checked={selected?.selection_token === candidate.selection_token} onChange={() => { setSelected(candidate); setPoint(null); }} className="mt-1 size-4" />{candidate.address}</label>)}</fieldset>}{!selected && <><p className="text-sm font-semibold">Or choose a temporary map point</p><p className="text-xs leading-5 text-muted-foreground">Tap the map. Keyboard users can enter latitude and longitude. This point stays in this browser and is user-selected, not a verified address.</p><PlaceEntryMap value={point} onChange={setPoint} /><div className="grid grid-cols-2 gap-3">{[['latitude', 'Latitude', 1.15, 1.5], ['longitude', 'Longitude', 103.55, 104.15]].map(([key, text, min, max]) => <label key={key} className="grid gap-2 text-sm">{text}<Input type="number" step="0.000001" min={min} max={max} value={Number.isFinite(point?.[key]) ? point[key] : ''} onChange={event => setPoint(current => ({ ...current, [key]: event.target.value === '' ? NaN : Number(event.target.value) }))} /></label>)}</div></>}{error && <Alert role="alert" tone="warning">{error}</Alert>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={busy || !label.trim() || (!selected && !point)} onClick={save}>{busy ? 'Adding…' : selected ? 'Add verified place' : 'Add temporary place'}</Button></div></div>;
}
