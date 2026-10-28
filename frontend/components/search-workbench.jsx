'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlanning } from '@/components/planning-provider';
import { advancedFields, buildCriteria, evaluateHome, storeyRangeValidationError } from '@/lib/planning';
import { requestJson } from '@/lib/api-client';
import { money } from '@/lib/utils';

export function AdvancedRequirements({ brief, setBrief }) {
  const error = storeyRangeValidationError(brief);
  function update(key, value) { setBrief(current => ({ ...current, [key]: value })); }
  function requirement(key, value) { setBrief(current => ({ ...current, requirements: { ...current.requirements, [key]: value === 'required' } })); }
  return <section className="space-y-4 border-t pt-5" aria-label="Property requirements">
    <div><h3 className="font-semibold">Property requirements</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Must-haves exclude records without matching evidence. Preferences keep alternatives available.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{Object.entries(advancedFields).map(([key, [, label, unit]]) => <div key={key} className="space-y-2"><label className="grid gap-2 text-sm">{label}{unit ? ` (${unit})` : ''}<Input aria-describedby={key === 'minStorey' || key === 'maxStorey' ? `storey-filter-help${error ? ' storey-filter-error' : ''}` : undefined} aria-invalid={(key === 'minStorey' || key === 'maxStorey') && Boolean(error) || undefined} type={key === 'observedAfter' ? 'date' : 'number'} min={key === 'minStorey' || key === 'maxStorey' ? 1 : 0} max={key === 'minStorey' || key === 'maxStorey' ? 100 : key === 'minLease' ? 99 : undefined} step={key === 'observedAfter' ? undefined : '1'} value={brief[key] ?? ''} onChange={event => update(key, event.target.value === '' ? null : key === 'observedAfter' ? event.target.value : Number(event.target.value))} /></label><select aria-label={`${label} requirement`} className="h-11 w-full rounded-lg border bg-background px-3 text-xs" value={brief.requirements?.[key] === false ? 'preferred' : 'required'} onChange={event => requirement(key, event.target.value)}><option value="required">Must-have</option><option value="preferred">Preference</option></select></div>)}</div>
    <p id="storey-filter-help" className="text-xs leading-5 text-muted-foreground">Storey filters match reported bands that overlap your chosen range. The exact floor is unavailable.</p>{error && <p id="storey-filter-error" role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs leading-5 text-muted-foreground">Lease estimates use a 99-year term and commencement year; exact lease dates may differ.</p>
    <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Must-haves or preferences</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">{[['budget', 'Price ceiling'], ['towns', 'Selected towns'], ['flatType', 'Flat type'], ['schoolDistance', 'Schools'], ['childcareDistance', 'Childcare'], ['careDistance', 'Care services']].map(([key, label]) => <label key={key} className="grid gap-2 text-sm">{label}<select className="h-11 rounded-lg border bg-background px-3 text-sm" value={brief.requirements?.[key] === false ? 'preferred' : 'required'} onChange={event => requirement(key, event.target.value)}><option value="required">Must-have</option><option value="preferred">Preference</option></select></label>)}</div></details>
  </section>;
}

export function MatchReasons({ home, brief }) {
  const { matches, compromises, missing } = evaluateHome(home, brief);
  return <details className="rounded-xl border bg-background/40 px-3 py-2 text-xs"><summary className="min-h-11 cursor-pointer content-center font-semibold">Why this place?</summary><div className="mt-2 space-y-2 leading-5">{matches.map(text => <p key={text} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />{text}</p>)}{compromises.map(text => <p key={text}>Trade-off: {text}</p>)}{missing.length > 0 && <p className="border-t pt-2 text-muted-foreground">Missing evidence: {missing.join(', ')}.</p>}</div></details>;
}

export function SearchWorkbench({ brief, applySearch }) {
  const { scenarios, saveScenario, deleteScenario, status, error, ready } = usePlanning();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  function save(event) {
    event.preventDefault();
    try { saveScenario(name, brief, brief.priorityWeights); setName(''); setMessage('Search preset saved.'); } catch (failure) { setMessage(failure.message); }
  }
  return <section className="space-y-3" aria-label="Search presets"><div><h3 className="text-sm font-semibold">Search presets</h3><p className="mt-1 text-xs text-muted-foreground">Keep your criteria together. {status === 'saved' ? 'Synced to your account.' : status === 'local' ? 'Saved in this browser.' : 'Save status: ' + status}</p></div><form className="flex gap-2" onSubmit={save}><Input aria-label="Preset name" placeholder="Near parents, more space…" maxLength={80} value={name} onChange={event => setName(event.target.value)} /><Button type="submit" disabled={!ready || !name.trim()}>Save preset</Button></form><div className="space-y-2">{scenarios.map(scenario => <div key={scenario.id} className="flex items-center gap-2 rounded-lg border p-2"><Button variant="ghost" className="min-w-0 flex-1 justify-start overflow-hidden text-ellipsis" onClick={() => { applySearch('', scenario.brief); setMessage(`${scenario.name} applied.`); }}>{scenario.name}</Button><Button variant="ghost" size="icon" aria-label={`Delete preset ${scenario.name}`} onClick={() => { if (window.confirm(`Delete preset “${scenario.name}”?`)) deleteScenario(scenario.id); }}><X className="size-4" /></Button></div>)}</div>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}{error && <p role="alert" className="text-sm text-destructive">{typeof error === 'string' ? error : error.message}</p>}</section>;
}

export function ActiveRequirements({ brief, setBrief, onApply, places = [], disabled = false }) {
  const chips = [];
  if (brief.budget != null) chips.push(['budget', `Up to ${money(brief.budget)}${brief.requirements?.budget === false ? ' preferred' : ''}`, { budget: null }]);
  for (const town of brief.preferredTowns || []) chips.push([`town-${town}`, `${town}${brief.requirements?.towns === false ? ' preferred' : ''}`, { preferredTowns: brief.preferredTowns.filter(item => item !== town) }]);
  if (brief.preferredFlatType) chips.push(['preferredFlatType', `${brief.preferredFlatType}${brief.requirements?.flatType === false ? ' preferred' : ''}`, { preferredFlatType: null }]);
  for (const [key, label] of [['schoolDistance', 'School'], ['childcareDistance', 'Childcare'], ['careDistance', 'Care']]) if (brief[key] != null) chips.push([key, `${label} ≤ ${brief[key]} m${brief.requirements?.[key] === false ? ' preferred' : ''}`, { [key]: null }]);
  for (const [key, [, label, unit]] of Object.entries(advancedFields)) if (brief[key] !== '' && brief[key] != null) chips.push([key, `${label}: ${brief[key]} ${unit}${brief.requirements?.[key] === false ? ' preferred' : ''}`, { [key]: null }]);
  for (const constraint of brief.placeConstraints || []) chips.push([constraint.placeId, `${places.find(place => place.id === constraint.placeId)?.label || 'Personal place'} ≤ ${constraint.maxDistanceM} m`, { placeConstraints: brief.placeConstraints.filter(item => item.placeId !== constraint.placeId) }]);
  return <div className="flex flex-wrap items-center gap-2" aria-label="Applied filters">{chips.length ? chips.map(([key, label, patch]) => <button key={key} disabled={disabled} className="flex min-h-11 items-center gap-2 rounded-full border bg-background px-3 text-xs hover:bg-secondary disabled:opacity-50" onClick={() => { const next = { ...brief, ...patch }; if (onApply) onApply(next); else setBrief?.(next); }} aria-label={`Remove ${label}`}>{label}<X aria-hidden="true" className="size-3.5" /></button>) : <span className="py-2 text-xs text-muted-foreground">All towns · any flat type · no required limits</span>}</div>;
}

export function EmptyRecovery({ brief, setBrief, lastSearchSnapshot, applySearch, fixtureMode }) {
  const [checks, setChecks] = useState({});
  const suggestions = [
    { id: 'towns', label: 'Search all towns', clear: { preferredTowns: [] }, omit: ['town', 'towns'], when: brief.preferredTowns?.length },
    { id: 'budget', label: `Raise the price ceiling to ${money(Math.ceil((brief.budget || 0) * 1.2 / 10000) * 10000)}`, clear: { budget: Math.ceil((brief.budget || 0) * 1.2 / 10000) * 10000 }, replace: 'budget', when: brief.budget && brief.requirements?.budget !== false },
    { id: 'area', label: 'Remove the minimum floor area', clear: { minFloorArea: null }, omit: ['min_floor_area_sqm'], when: brief.minFloorArea },
    { id: 'lease', label: 'Remove the minimum lease', clear: { minLease: null }, omit: ['min_remaining_lease_years'], when: brief.minLease },
    { id: 'storey', label: 'Search every storey band', clear: { minStorey: null, maxStorey: null }, omit: ['min_storey', 'max_storey'], when: brief.minStorey || brief.maxStorey },
    { id: 'date', label: 'Include earlier transactions', clear: { observedAfter: null }, omit: ['observed_after'], when: brief.observedAfter },
    { id: 'distance', label: 'Remove amenity distance limits', clear: { schoolDistance: null, childcareDistance: null, careDistance: null }, omit: ['max_school_distance_m', 'max_childcare_distance_m', 'max_care_distance_m'], when: brief.schoolDistance != null || brief.childcareDistance != null || brief.careDistance != null },
  ].filter(suggestion => suggestion.when);
  async function check(suggestion) {
    setChecks(current => ({ ...current, [suggestion.id]: { loading: true } }));
    try {
      const criteria = { ...(lastSearchSnapshot?.criteria || buildCriteria(brief)), limit: 1 };
      delete criteria.cursor;
      for (const key of suggestion.omit || []) delete criteria[key];
      if (suggestion.replace) criteria[suggestion.replace] = suggestion.clear.budget;
      const result = await requestJson('/api/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(criteria) });
      setChecks(current => ({ ...current, [suggestion.id]: { count: result.total } }));
    } catch (failure) { setChecks(current => ({ ...current, [suggestion.id]: { error: failure.message } })); }
  }
  return suggestions.length > 0 && <section className="space-y-3 rounded-xl border p-4" aria-label="Search alternatives"><h3 className="font-semibold">Try one change</h3><p className="text-xs text-muted-foreground">Your requirements stay in place until you choose a change.</p>{suggestions.map(suggestion => <div key={suggestion.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"><div><p>{suggestion.label}</p>{checks[suggestion.id]?.count != null && <p className="mt-1 text-xs text-muted-foreground">{checks[suggestion.id].count.toLocaleString()} matching historical records</p>}{checks[suggestion.id]?.error && <p role="status" className="text-xs text-destructive">{checks[suggestion.id].error}</p>}</div><div className="flex gap-2">{!fixtureMode && <Button variant="ghost" disabled={checks[suggestion.id]?.loading} onClick={() => check(suggestion)}>{checks[suggestion.id]?.loading ? 'Checking…' : 'Check count'}</Button>}<Button variant="outline" onClick={() => { const next = { ...brief, ...suggestion.clear }; setBrief?.(next); applySearch('', next); }}>Apply and search</Button></div></div>)}</section>;
}
