'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvidenceContext } from '@/components/evidence-context';
import { candidateReasons } from '@/components/evidence-helpers';
import { PlaceDistanceList } from '@/components/place-picker';
import { DecisionSummary } from '@/components/decision-summary';
import { money } from '@/lib/utils';

const text = value => value == null || value === '' ? 'Unavailable in this record' : String(value);

export function ComparisonView({ homes = [], onRemove, availableHomes = [], onAdd, brief = {}, decisions = {}, photos = {} }) {
  const [firstId, setFirstId] = useState('');
  const [secondId, setSecondId] = useState('');
  const [differences, setDifferences] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const first = homes.find(home => String(home.id) === firstId) || homes[0];
  const second = homes.find(home => String(home.id) === secondId && home.id !== first?.id) || homes.find(home => home.id !== first?.id);
  const orderedHomes = first && second ? [first, second, ...homes.filter(home => home.id !== first.id && home.id !== second.id)] : homes;
  const rows = [
    { label: 'Recorded price', value: home => Number.isFinite(home.price) ? money(home.price) : 'Unavailable' },
    { label: 'Transaction date', value: home => text(home.observedOn || home.transactionDate) },
    { label: 'Town and flat type', value: home => `${text(home.town)} · ${text(home.type)}` },
    { label: 'Source score', value: home => Number.isFinite(home.score) ? `${home.score} / 100` : 'Insufficient evidence' },
    { label: 'Floor area', value: home => home.floorAreaSqm != null ? `${home.floorAreaSqm} m²` : 'Unavailable' },
    { label: 'Storeys', value: home => text(home.storeyRange) },
    { label: 'Remaining lease', value: home => home.remainingLeaseYears != null ? `≈ ${home.remainingLeaseYears} years` : 'Unavailable' },
    { label: 'School access', value: home => text(home.school) },
    { label: 'Childcare access', value: home => text(home.childcare) },
    { label: 'Care access', value: home => text(home.care) },
    { label: 'Saved place distances', value: home => JSON.stringify(home.placeDistances || []), render: home => home.placeDistances?.length ? <PlaceDistanceList distances={home.placeDistances} /> : 'No saved place distance evidence' },
    { label: 'Dengue context', value: home => text(home.risk) },
    { label: 'Trade-off or missing evidence', value: home => candidateReasons(home, brief).tradeoff },
    { label: 'Current availability', value: () => 'Unavailable; these are research records, not live listings' },
    { label: 'Evidence context', value: home => JSON.stringify([home.sourceSemantics, home.source, home.sourceUpdated, home.geocodeStatus, home.scoreDetails]), render: home => <EvidenceContext home={home} /> },
  ];
  // Keep provenance visible even when two records happen to share a source snapshot.
  const visibleRows = rows.filter(row => !differences || row.label === 'Evidence context' || new Set(homes.map(row.value)).size > 1);
  const mobileSame = row => first && second && row.label !== 'Evidence context' && row.value(first) === row.value(second);
  if (homes.length < 2) return <section className="rounded-xl border border-dashed p-6 text-center"><h2 className="font-display text-xl font-semibold">Choose two or three candidates</h2><p className="mt-2 text-sm text-muted-foreground">Use Compare on the research cards to put their evidence side by side.</p>{homes.length > 0 && onRemove && <ul className="mt-4 space-y-2 text-left" aria-label="Remaining homes in comparison">{homes.map(home => <li key={home.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span className="min-w-0 break-words text-sm font-semibold">{home.address}</span><Button variant="outline" onClick={() => onRemove(home)} aria-label={`Remove ${home.address} from comparison`}><X aria-hidden="true" className="size-4" />Remove</Button></li>)}</ul>}{availableHomes.length > 0 && onAdd && <div className="mt-4 flex flex-wrap justify-center gap-2">{availableHomes.map(home => <Button key={home.id} variant="outline" onClick={() => onAdd(home)}>Compare {home.address}</Button>)}</div>}</section>;
  const mobileColumn = home => home.id === first.id || home.id === second.id ? 'table-cell' : 'hidden md:table-cell';
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">{homes.length} candidates · dated evidence side by side</p><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={differences} onChange={event => setDifferences(event.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />Show differences only</label></div>
    <div className="grid grid-cols-2 gap-3 md:hidden">{[['First candidate', first, setFirstId], ['Second candidate', second, setSecondId]].map(([label, current, set]) => <label key={label} className="min-w-0 text-xs font-semibold">{label}<select className="mt-1 min-h-11 w-full rounded-lg border bg-background p-2 text-sm" value={String(current.id)} onChange={event => { if (label === 'First candidate' && event.target.value === String(second.id)) setSecondId(String(first.id)); if (label === 'Second candidate' && event.target.value === String(first.id)) setFirstId(String(second.id)); set(event.target.value); }}>{homes.map(home => <option key={home.id} value={String(home.id)}>{home.address} · {home.type}</option>)}</select></label>)}</div>
    <div className="rounded-xl border bg-card">
      <table aria-label="Candidate evidence comparison" className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">Place comparison table. On a small screen, use the selectors to compare a pair.</caption>
        <thead><tr className="bg-muted/35"><th scope="col" className="hidden w-40 p-4 text-xs md:table-cell">Measure</th>{orderedHomes.map(home => <th key={home.id} scope="col" className={`min-w-0 break-words p-3 align-top md:p-4 ${mobileColumn(home)}`}><p className="font-semibold">{home.address}</p><p className="mt-1 text-xs font-normal text-muted-foreground">{home.town} · {home.type}</p>{onRemove && <Button variant="outline" className="mt-3 min-h-11 whitespace-normal text-xs" onClick={() => onRemove(home)} aria-label={`Remove ${home.address} from comparison`}><X aria-hidden="true" className="size-4 shrink-0" />Remove</Button>}</th>)}</tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.label} className={`border-t ${differences && mobileSame(row) ? 'hidden md:table-row' : ''}`}><th scope="row" className="hidden p-4 font-semibold md:table-cell">{row.label}</th>{orderedHomes.map(home => <td key={home.id} className={`min-w-0 break-words p-3 align-top text-muted-foreground md:p-4 ${mobileColumn(home)}`}><span className="mb-2 block text-xs font-semibold text-foreground md:hidden">{row.label}</span>{row.render ? row.render(home) : row.value(home)}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {availableHomes.length > 0 && onAdd && homes.length < 3 && <div><p className="mb-2 text-sm font-medium">Add a saved candidate</p><div className="flex flex-wrap gap-2">{availableHomes.map(home => <Button key={home.id} variant="outline" onClick={() => onAdd(home)}>{home.address}</Button>)}</div></div>}
    <Button variant="outline" aria-expanded={showSummary} onClick={() => setShowSummary(value => !value)}>{showSummary ? 'Hide decision summary' : 'Prepare decision summary'}</Button>
    {showSummary && <DecisionSummary homes={homes} brief={brief} decisions={decisions} photos={photos} />}
  </div>;
}
