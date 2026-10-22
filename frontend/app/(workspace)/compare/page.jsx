'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, GitCompareArrows, Info, Minus, Plus, ShieldCheck } from 'lucide-react';
import { LoadingScene } from '@/components/loading-scene';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePlanning } from '@/components/planning-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { EvidenceContext } from '@/components/evidence-context';
import { PlaceDistanceList } from '@/components/place-picker';
import { money } from '@/lib/utils';

const DecisionSummary = dynamic(() => import('@/components/decision-summary').then(module => module.DecisionSummary), {
  loading: () => <LoadingScene label="Opening your comparison summary…" />,
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(home, keys) {
  for (const key of keys) {
    const value = finiteNumber(home?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstValue(home, keys) {
  for (const key of keys) {
    const value = home?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return null;
}

function leaseYears(home) {
  const value = firstValue(home, ['remainingLeaseYears', 'remaining_lease_years', 'remainingLease', 'remaining_lease']);
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const years = value.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i);
  const months = value.match(/(\d+)\s*months?/i);
  if (years) return Number(years[1]) + (months ? Number(months[1]) / 12 : 0);
  return finiteNumber(value);
}

function DifferenceValue({ home, homes, row }) {
  const value = row.value(home);
  const others = homes.map((item) => row.value(item)).filter((number) => number !== null);
  if (value === null) return <span className="text-muted-foreground">Unavailable</span>;

  const minimum = Math.min(...others);
  const maximum = Math.max(...others);
  const range = maximum - minimum;
  const best = row.prefer === 'lower' ? minimum : maximum;
  const isBest = value === best;
  const difference = row.prefer === 'lower' ? value - minimum : maximum - value;

  return <div className="space-y-1">
    <span className={`inline-flex rounded-md px-2 py-1 font-medium ${isBest ? 'bg-primary/10 text-primary' : 'bg-muted/60 text-foreground'}`}>{row.renderValue(value)}</span>
    {range > 0 && <p className={`text-[11px] leading-4 ${isBest ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
      {isBest ? row.bestLabel : row.differenceLabel(difference)}
    </p>}
  </div>;
}

function numberText(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function ComparePage() {
  const { selectedHomes, compareIds, shortlistHomes, toggleCompare, brief } = useWorkspace();
  const { decisions } = usePlanning();
  const [showSummary, setShowSummary] = useState(false);
  const available = shortlistHomes.filter((home) => !compareIds.includes(home.id));

  const rows = [
    { label: 'Evidence context', render: (home) => <EvidenceContext home={home} /> },
    {
      label: 'Price observation',
      value: (home) => finiteNumber(home.price),
      prefer: 'lower',
      renderValue: (value) => money(value),
      bestLabel: 'Lowest recorded price',
      differenceLabel: (difference) => `${money(difference)} above the lowest`,
    },
    {
      label: 'Fit score',
      value: (home) => finiteNumber(home.score),
      prefer: 'higher',
      renderValue: (value) => `${numberText(value)} / 100`,
      bestLabel: 'Highest score',
      differenceLabel: (difference) => `${numberText(difference)} points below the highest`,
    },
    ...(selectedHomes.some((home) => firstNumber(home, ['floorAreaSqm', 'floor_area_sqm', 'floorArea', 'areaSqm']) !== null) ? [{
      label: 'Floor area',
      value: (home) => firstNumber(home, ['floorAreaSqm', 'floor_area_sqm', 'floorArea', 'areaSqm']),
      prefer: 'higher',
      renderValue: (value) => `${numberText(value)} m²`,
      bestLabel: 'Most floor area',
      differenceLabel: (difference) => `${numberText(difference)} m² less than the largest`,
    }] : []),
    ...(selectedHomes.some((home) => leaseYears(home) !== null) ? [{
      label: 'Remaining lease',
      value: leaseYears,
      prefer: 'higher',
      renderValue: (value) => `${numberText(value)} years`,
      bestLabel: 'Longest remaining lease',
      differenceLabel: (difference) => `${numberText(difference)} years less than the longest`,
    }] : []),
    ...(selectedHomes.some((home) => firstValue(home, ['leaseCommenceYear', 'lease_commence_year', 'leaseCommenceDate', 'lease_commence_date']) !== null) ? [{
      label: 'Lease commenced',
      render: (home) => firstValue(home, ['leaseCommenceYear', 'lease_commence_year', 'leaseCommenceDate', 'lease_commence_date']) || 'Unavailable',
    }] : []),
    { label: 'School access', render: (home) => home.school || 'Unavailable in this record' },
    { label: 'Childcare access', render: (home) => home.childcare || 'Unavailable in this record' },
    { label: 'Care access', render: (home) => home.care || 'Unavailable in this record' },
    { label: 'Saved place distances', render: (home) => <PlaceDistanceList distances={home.placeDistances} /> },
    { label: 'Dengue context', render: (home) => home.risk || 'Unavailable in this record' },
    { label: 'Trade-off to discuss', render: (home) => home.risks?.[0] || 'No trade-off recorded' },
  ];

  return <div className="container flex max-w-[1400px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><GitCompareArrows className="size-3.5 text-primary" />Compare places</div>
        <h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Put the same evidence side by side.</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">Keep price, access and source dates visible while you talk through the trade-offs.</p>
      </div>
      <Button asChild variant="outline"><Link href="/explore"><ArrowLeft className="size-4" />Back to explore</Link></Button>
    </div>

    {selectedHomes.length < 2 ? <Card className="grid min-h-96 place-items-center border-dashed"><CardContent className="max-w-md text-center">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-xl bg-primary/10 text-primary"><GitCompareArrows className="size-6" /></span>
      <h2 className="font-display text-2xl font-semibold">Choose two or three places</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Select places from Explore or your shortlist. Comparison stays limited to three so the evidence remains readable.</p>
      <Button asChild className="mt-6"><Link href="/explore">Choose places <ArrowRight className="size-4" /></Link></Button>
    </CardContent></Card> : <>
      <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/[0.05] px-4 py-3">
        <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Check className="size-4" /></span><p className="text-sm font-semibold">{selectedHomes.length} of 2–3 places selected</p></div>
        <span className="hidden text-xs text-muted-foreground sm:block">Source dates stay visible</span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="min-w-[760px] w-full border-collapse text-left">
          <caption className="sr-only">Place comparison table</caption>
          <thead><tr className="border-b bg-muted/35">
            <th scope="col" className="sticky left-0 z-10 min-w-44 bg-muted/95 p-4 text-xs font-bold uppercase tracking-wide text-muted-foreground backdrop-blur">Measure</th>
            {selectedHomes.map((home) => <th scope="col" key={home.id} className="min-w-56 p-4 align-top">
              <div className="flex items-start justify-between gap-3">
                <div><Badge variant="secondary">{home.town}</Badge><p className="mt-2 font-display text-base font-semibold">{home.address}</p><p className="mt-1 text-xs font-normal text-muted-foreground">{home.type} · {money(home.price)}</p></div>
                <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Remove ${home.address} from comparison`} onClick={() => toggleCompare(home)}><Minus className="size-4" /></Button>
              </div>
            </th>)}
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label} className="border-b last:border-0">
            <th scope="row" className="sticky left-0 z-10 bg-card p-4 text-sm font-semibold text-foreground">{row.label}</th>
            {selectedHomes.map((home) => <td key={home.id} className="p-4 text-sm text-muted-foreground"><div className="max-w-64 leading-5">
              {row.value ? <DifferenceValue home={home} homes={selectedHomes} row={row} /> : row.render(home)}
            </div></td>)}
          </tr>)}</tbody>
        </table>
      </div>

      <section aria-labelledby="decision-summary-toggle" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] p-4 sm:flex-row sm:items-center">
          <div><h2 id="decision-summary-toggle" className="font-semibold">Take the discussion with you</h2><p className="mt-1 text-xs text-muted-foreground">Prepare a print-ready summary of these homes, household preferences and decision notes.</p></div>
          <Button type="button" variant={showSummary ? 'soft' : 'outline'} aria-expanded={showSummary} aria-controls="compare-decision-summary" onClick={() => setShowSummary((current) => !current)}>
            {showSummary ? 'Hide decision summary' : 'Prepare decision summary'} <ArrowRight className="size-4" />
          </Button>
        </div>
        {showSummary && <div id="compare-decision-summary"><DecisionSummary homes={selectedHomes} brief={brief} decisions={decisions} /></div>}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-4"><ShieldCheck className="mb-3 size-5 text-primary" /><p className="text-sm font-semibold">Evidence first</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Dates and source labels stay beside each observation.</p></CardContent></Card>
        <Card><CardContent className="p-4"><Info className="mb-3 size-5 text-primary" /><p className="text-sm font-semibold">Missing stays missing</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Unavailable records are not quietly treated as zero.</p></CardContent></Card>
        <Card><CardContent className="p-4"><GitCompareArrows className="mb-3 size-5 text-primary" /><p className="text-sm font-semibold">Talk through the trade-off</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A score starts a conversation; it does not replace one.</p></CardContent></Card>
      </div>
    </>}

    {available.length > 0 && selectedHomes.length > 0 && <div className="rounded-xl border border-dashed p-4">
      <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-semibold">Add another saved place</p><p className="text-xs text-muted-foreground">Choose one more from your shortlist.</p></div><Plus className="size-4 text-primary" /></div>
      <div className="flex flex-wrap gap-2">{available.map((home) => <Button key={home.id} size="sm" variant="outline" onClick={() => toggleCompare(home)}>{home.address} <Plus className="size-3.5" /></Button>)}</div>
    </div>}
  </div>;
}
