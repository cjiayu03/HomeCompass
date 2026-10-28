'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Baby, Check, Compass, Minus, PersonStanding, Plus, RotateCw, Search, UsersRound, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace-provider';
import { money } from '@/lib/utils';
import { summarizeHouseholdAges } from '@/lib/household';
import { requestJson } from '@/lib/api-client';

const steps = [
  { title: 'Household', heading: 'Who will live here?', description: 'Tell us who may live in the home.' },
  { title: 'Budget', heading: 'What price should we stay under?', description: 'Set the maximum recorded price to compare.' },
  { title: 'Areas', heading: 'Which areas should we start with?', description: 'Choose up to three towns, then select a flat type if you have one in mind.' },
  { title: 'Priorities', heading: 'What should rank higher?', description: 'Set what matters in the ranking, then add any distance limits.' },
];

const distanceChoices = [500, 1000, 1500, 2000, 3000];

// Line tags use the colours and code-first style from the LTA rail legend.
const MRT_LINE_INFO = {
  NSL: { name: 'North-South Line', color: '#e3262e' },
  EWL: { name: 'East-West Line', color: '#009b52' },
  NEL: { name: 'North East Line', color: '#9900aa' },
  CCL: { name: 'Circle Line', color: '#f99d1c' },
  DTL: { name: 'Downtown Line', color: '#005eb8' },
  TEL: { name: 'Thomson-East Coast Line', color: '#9b5b1f' },
  JRL: { name: 'Jurong Region Line', color: '#292522', planned: true },
};

// Town-level guide only: exact station access varies by estate and block.
const TOWN_MRT_LINES = {
  'ANG MO KIO': ['NSL'],
  BEDOK: ['EWL', 'DTL', 'TEL'],
  BISHAN: ['NSL', 'CCL'],
  'BUKIT BATOK': ['NSL'],
  'BUKIT MERAH': ['EWL', 'CCL'],
  'BUKIT PANJANG': ['DTL'],
  'CHOA CHU KANG': ['NSL', 'JRL'],
  CLEMENTI: ['EWL'],
  GEYLANG: ['EWL', 'CCL', 'DTL'],
  HOUGANG: ['NEL'],
  'JURONG EAST': ['NSL', 'EWL', 'JRL'],
  'JURONG WEST': ['EWL', 'JRL'],
  'KALLANG/WHAMPOA': ['EWL', 'NEL', 'DTL'],
  'MARINE PARADE': ['TEL'],
  'PASIR RIS': ['EWL'],
  PUNGGOL: ['NEL'],
  QUEENSTOWN: ['EWL'],
  SEMBAWANG: ['NSL'],
  SENGKANG: ['NEL'],
  SERANGOON: ['NEL', 'CCL'],
  TAMPINES: ['EWL', 'DTL'],
  TENGAH: ['JRL'],
  'TOA PAYOH': ['NSL'],
  WOODLANDS: ['NSL', 'TEL'],
  YISHUN: ['NSL'],
};

function normalizeTownName(town) {
  return String(town ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').toUpperCase();
}

function TransitBadges({ town }) {
  const lines = TOWN_MRT_LINES[normalizeTownName(town)] || [];
  const accessibleName = lines.length
    ? `MRT lines: ${lines.map((code) => `${MRT_LINE_INFO[code].name}${MRT_LINE_INFO[code].planned ? ', under construction' : ''}`).join(', ')}`
    : `MRT lines vary by area in ${town}`;

  return <span role="img" aria-label={accessibleName} className="inline-flex shrink-0 flex-wrap items-center justify-start gap-1">
    {lines.length ? lines.map((code) => {
      const line = MRT_LINE_INFO[code];
      return <span key={code} aria-hidden="true" className="inline-flex h-[18px] min-w-7 items-center justify-center rounded-md px-1.5 text-[9px] font-bold tracking-wide text-white" style={{ backgroundColor: line.color }}>{line.planned ? 'U/C' : code}</span>;
    }) : <span className="text-[10px] text-muted-foreground">MRT varies by area</span>}
  </span>;
}
const priorityNames = [
  ['school', 'Schools'],
  ['childcare', 'Childcare'],
  ['care', 'Elder-care access'],
  ['affordability', 'Affordability'],
];

const priorityPresets = [
  { name: 'Balanced', weights: { school: 2, childcare: 2, care: 2, affordability: 2 } },
  { name: 'Schools and childcare', weights: { school: 3, childcare: 3, care: 1, affordability: 1 } },
  { name: 'Care access', weights: { school: 1, childcare: 1, care: 3, affordability: 2 } },
  { name: 'Affordability', weights: { school: 1, childcare: 1, care: 1, affordability: 3 } },
];

function CountControl({ label, Icon, value, min, max = 10, onChange }) {
  const inputId = `household-${label.toLowerCase().replaceAll(' ', '-')}`;
  return <div className="rounded-2xl border bg-background/70 p-4 transition-colors hover:border-primary/30">
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden="true" className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p id={inputId} className="text-sm font-semibold text-foreground">{label}</p>
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">People</span>
      <div role="group" aria-labelledby={inputId} className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="size-9 rounded-full" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-4" /></Button>
        <output aria-label={`${label} count`} className="min-w-6 text-center text-lg font-semibold tabular-nums">{value}</output>
        <Button type="button" variant="outline" size="icon" className="size-9 rounded-full" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus className="size-4" /></Button>
      </div>
    </div>
  </div>;
}

function AreaChoices({ brief, setBrief, towns, flatTypes, optionsState, retryOptions }) {
  const reduceMotion = useReducedMotion();
  const [townQuery, setTownQuery] = useState('');
  const selectedTowns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  const townChoices = [...new Set([...towns, ...selectedTowns])];
  const matchingTowns = townChoices.filter((town) => town.toLowerCase().includes(townQuery.trim().toLowerCase()));
  const typeChoices = [...new Set([...flatTypes, ...(brief.preferredFlatType ? [brief.preferredFlatType] : [])])];
  const toggleTown = (town) => setBrief({
    ...brief,
    preferredTowns: selectedTowns.includes(town)
      ? selectedTowns.filter((selected) => selected !== town)
      : [...selectedTowns, town],
  });
  const removeTown = (town) => setBrief({
    ...brief,
    preferredTowns: selectedTowns.filter((selected) => selected !== town),
  });

  return <div className="space-y-6">
    <fieldset>
      <legend className="text-sm font-semibold">Towns</legend>
      <div className="mb-3 mt-1 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Choose up to three. Homes can match any town you select.</p>
          <p className="text-[11px] leading-4 text-muted-foreground">MRT tags are a town-level guide; exact access varies by estate and block. U/C marks the Jurong Region Line under construction.</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-primary">{selectedTowns.length}/3</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={selectedTowns.length === 0}
          onClick={() => setBrief({ ...brief, preferredTowns: [] })}
          className={selectedTowns.length === 0 ? 'min-h-9 rounded-lg border border-primary/45 bg-primary/10 px-3 text-xs font-medium text-foreground' : 'min-h-9 rounded-lg border bg-background/70 px-3 text-xs font-medium text-muted-foreground hover:text-foreground'}
        >Any town</button>
      </div>

      {selectedTowns.length > 0 && <div role="group" aria-label="Selected towns" className="mt-3 flex flex-wrap gap-2">
        {selectedTowns.map((town) => <span key={town} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 pl-3 pr-1.5 text-xs font-medium text-foreground">
          <span>{town}</span>
          <button type="button" aria-label={`Remove ${town}`} onClick={() => removeTown(town)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>)}
      </div>}

      <div className="relative mt-3">
        <label htmlFor="onboarding-town-search" className="sr-only">Search towns</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="onboarding-town-search"
          type="search"
          value={townQuery}
          onChange={(event) => setTownQuery(event.target.value)}
          placeholder="Find a town"
          className="pl-9"
        />
      </div>

      {optionsState === 'loading' && townChoices.length === 0
        ? <p className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">Loading towns from the latest resale data…</p>
        : townChoices.length ? matchingTowns.length ? <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto rounded-xl border bg-muted/20 p-2 sm:grid-cols-2">
          {matchingTowns.map((town) => {
            const selected = selectedTowns.includes(town);
            const atLimit = !selected && selectedTowns.length >= 3;
            return <motion.button key={town} type="button" whileTap={reduceMotion ? undefined : { scale: 0.98 }} aria-pressed={selected} disabled={atLimit} onClick={() => toggleTown(town)} className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${selected ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm' : 'border-border/70 bg-background/75 text-muted-foreground hover:border-primary/35 hover:text-foreground'} ${atLimit ? 'cursor-not-allowed opacity-45' : ''}`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>{selected && <Check aria-hidden="true" className="size-2.5" />}</span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{town}</span>
                <TransitBadges town={town} />
              </span>
            </motion.button>;
          })}
        </div> : <p className="mt-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">No towns match “{townQuery}”. Try another name.</p> : <div className="mt-3 rounded-xl border border-dashed px-4 py-4">
          <p className="text-sm text-muted-foreground">Town choices could not be loaded. You can finish setup without an area filter.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retryOptions}><RotateCw className="size-3.5" />Retry town list</Button>
        </div>}
      {optionsState === 'error' && townChoices.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Some choices may be out of date. Towns already selected remain visible.</p>}
    </fieldset>

    <fieldset>
      <legend className="text-sm font-semibold">Flat type <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">No preference keeps the search broad.</p>
      {optionsState !== 'ready' && typeChoices.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-3"><p className="text-xs text-muted-foreground">{optionsState === 'loading' ? 'Loading flat types…' : 'Flat types are unavailable right now; you can set this in Explore.'}</p>{optionsState === 'error' && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retryOptions}><RotateCw className="size-3.5" />Retry flat types</Button>}</div>
        : <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!brief.preferredFlatType} onClick={() => setBrief({ ...brief, preferredFlatType: null })} className={!brief.preferredFlatType ? 'min-h-10 rounded-lg border border-primary/45 bg-primary/10 px-3 text-xs font-medium text-foreground' : 'min-h-10 rounded-lg border bg-background/70 px-3 text-xs font-medium text-muted-foreground hover:text-foreground'}>No preference</button>
          {typeChoices.map((flatType) => <button key={flatType} type="button" aria-pressed={brief.preferredFlatType === flatType} onClick={() => setBrief({ ...brief, preferredFlatType: flatType })} className={brief.preferredFlatType === flatType ? 'min-h-10 rounded-lg border border-primary/45 bg-primary/10 px-3 text-xs font-medium text-foreground' : 'min-h-10 rounded-lg border bg-background/70 px-3 text-xs font-medium text-muted-foreground hover:text-foreground'}>{flatType}</button>)}
        </div>}
    </fieldset>
  </div>;
}

function HouseholdStep({ brief, setBrief }) {
  return <div>
    <p className="mb-4 text-xs leading-5 text-muted-foreground">Count residents by age range. We save this as household context; it does not filter or rank homes.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <CountControl label="Adults (18–59)" Icon={UsersRound} value={brief.adults} min={1} onChange={(value) => setBrief({ ...brief, adults: value })} />
      <CountControl label="Children (0–17)" Icon={Baby} value={brief.children} min={0} onChange={(value) => setBrief({ ...brief, children: value })} />
      <CountControl label="Older adults (60+)" Icon={PersonStanding} value={brief.olderAdults} min={0} onChange={(value) => setBrief({ ...brief, olderAdults: value })} />
    </div>
  </div>;
}

function BudgetStep({ brief, setBrief }) {
  const min = 0;
  const max = 10_000_000;
  const budget = Number(brief.budget);
  const sliderValue = Math.max(min, Math.min(max, Number.isFinite(budget) ? budget : min));
  const updateBudget = (value) => setBrief({
    ...brief,
    budget: Math.max(min, Math.min(max, Math.round(Number(value) || 0))),
  });
  return <div className="space-y-6">
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3"><label htmlFor="onboarding-budget" className="text-sm font-semibold">Maximum budget</label><output htmlFor="onboarding-budget" className="font-display text-lg font-semibold tabular-nums">{money(brief.budget)}</output></div>
      <input id="onboarding-budget-range" aria-label="Maximum budget slider" aria-describedby="budget-help" type="range" min={min} max={max} step="10000" value={sliderValue} onChange={(event) => updateBudget(event.target.value)} className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]" />
      <div aria-hidden="true" className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>S$0</span><span>S$10 million</span></div>
      <p id="budget-help" className="mt-2 text-xs leading-5 text-muted-foreground">Use the slider for a broad estimate or enter an exact amount. This is a price ceiling, not a loan or affordability calculation.</p>
    </div>
    <div className="max-w-xs">
      <label htmlFor="onboarding-budget" className="mb-2 block text-xs font-semibold">Enter an exact amount</label>
      <div className="relative"><span className="pointer-events-none absolute left-3.5 top-3 text-sm text-muted-foreground">S$</span><Input id="onboarding-budget" name="budget" type="number" min={min} max={max} step="10000" value={brief.budget} aria-describedby="budget-help" onChange={(event) => updateBudget(event.target.value)} className="pl-12" /></div>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Budget quick picks">
      {[450000, 600000, 800000, 1000000].map((amount) => <button key={amount} type="button" aria-pressed={brief.budget === amount} onClick={() => updateBudget(amount)} className={brief.budget === amount ? 'min-h-9 rounded-lg border border-primary/45 bg-primary/10 px-3 text-xs text-foreground' : 'min-h-9 rounded-lg border bg-background/70 px-3 text-xs text-muted-foreground hover:text-foreground'}>{money(amount)}</button>)}
    </div>
  </div>;
}

function PriorityStep({ brief, setBrief }) {
  const reduceMotion = useReducedMotion();
  const weights = brief.priorityWeights || { school: 2, childcare: 2, care: 2, affordability: 2 };
  const updateWeight = (key, value) => setBrief({ ...brief, priorityWeights: { ...weights, [key]: value } });
  const activePreset = priorityPresets.find((preset) => priorityNames.every(([key]) => preset.weights[key] === weights[key]))?.name;

  return <div className="space-y-5">
    <fieldset>
      <legend className="text-sm font-semibold">Start from a preset <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {priorityPresets.map((preset) => <motion.button key={preset.name} type="button" whileTap={reduceMotion ? undefined : { scale: 0.97 }} aria-pressed={activePreset === preset.name} onClick={() => setBrief({ ...brief, priorityWeights: preset.weights })} className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-medium ${activePreset === preset.name ? 'border-primary/45 bg-primary/10 text-foreground' : 'bg-background/70 text-muted-foreground hover:text-foreground'}`}>{preset.name}</motion.button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend className="text-sm font-semibold">Ranking preferences</legend>
      <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">These weights change the order of homes; on their own, they do not remove homes from results.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {priorityNames.map(([key, label]) => <fieldset key={key} className="rounded-xl border bg-background/65 p-3">
          <legend className="px-1 text-xs font-semibold">{label}</legend>
          <div role="group" aria-label={`${label} ranking weight`} className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
            {[[0, 'Not ranked'], [1, 'Standard'], [2, 'Important'], [3, 'Top priority']].map(([value, title]) => <button key={value} type="button" aria-pressed={weights[key] === value} onClick={() => updateWeight(key, value)} className={`min-h-9 rounded-md px-1 text-[11px] ${weights[key] === value ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{title}</button>)}
          </div>
        </fieldset>)}
      </div>
    </fieldset>
    <fieldset>
      <legend className="text-sm font-semibold">Optional distance filters</legend>
      <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">A distance limit can remove homes from results. Homes without loaded distance data may also be excluded.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['schoolDistance', 'Schools'],
          ['childcareDistance', 'Childcare'],
          ['careDistance', 'Care services'],
        ].map(([key, label]) => <label key={key} className="flex flex-col gap-2"><span className="text-xs font-medium">{label}</span><select name={key} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief[key] ?? ''} onChange={(event) => setBrief({ ...brief, [key]: event.target.value === '' ? null : Number(event.target.value) })}><option value="">No limit</option>{distanceChoices.map((distance) => <option key={distance} value={distance}>Within {distance >= 1000 ? distance / 1000 + ' km' : distance + ' m'}</option>)}</select></label>)}
      </div>
    </fieldset>
  </div>;
}

function SearchSummary({ brief }) {
  const towns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  const priorities = brief.priorityWeights || {};
  const distanceLabel = (distance) => distance == null ? 'No limit' : `Within ${distance >= 1000 ? `${distance / 1000} km` : `${distance} m`}`;
  const weightLabel = (weight) => weight <= 0 ? 'Not ranked' : weight >= 3 ? 'Top priority' : weight >= 2 ? 'Important' : 'Standard';
  return <Card className="overflow-hidden rounded-2xl">
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div><p className="text-sm font-semibold">Your search so far</p><p className="mt-1 text-xs text-muted-foreground">Your choices, at a glance</p></div>
      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Compass className="size-4" /></span>
    </div>
    <CardContent className="space-y-4 p-5 pt-4">
      <dl className="divide-y divide-border/70 rounded-xl border bg-background/55 px-3">
        <div className="flex items-start justify-between gap-3 py-2.5"><dt className="pt-0.5 text-xs text-muted-foreground">Household</dt><dd className="max-w-[72%] text-right text-xs font-medium">{summarizeHouseholdAges(brief)}</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-xs text-muted-foreground">Budget</dt><dd className="text-right text-xs font-semibold">Up to {money(brief.budget)}</dd></div>
        <div className="flex items-start justify-between gap-3 py-2.5"><dt className="pt-0.5 text-xs text-muted-foreground">Areas</dt><dd className="flex max-w-[72%] flex-col items-end gap-1.5 text-right text-xs font-medium">{towns.length ? towns.map((town) => <span key={town} className="inline-flex max-w-full items-center justify-end gap-1.5"><span className="max-w-40 truncate">{town}</span><TransitBadges town={town} /></span>) : 'Any town'}</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-xs text-muted-foreground">Flat type</dt><dd className="text-right text-xs font-medium">{brief.preferredFlatType || 'No preference'}</dd></div>
        <div className="flex items-start justify-between gap-3 py-2.5"><dt className="pt-0.5 text-xs text-muted-foreground">Distance filters</dt><dd className="max-w-[68%] text-right text-xs font-medium">Schools {distanceLabel(brief.schoolDistance)}<br />Childcare {distanceLabel(brief.childcareDistance)}<br />Care {distanceLabel(brief.careDistance)}</dd></div>
      </dl>
      <div>
        <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Ranking preferences</p>
        <div className="flex flex-wrap gap-1.5">{priorityNames.map(([key, label]) => <span key={key} className="rounded-full border bg-background/65 px-2.5 py-1 text-[10px] text-muted-foreground">{label} {weightLabel(priorities[key] ?? 1)}</span>)}</div>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">You can change any of these in Explore. Town line tags are a guide; the nearest station depends on the block.</p>
    </CardContent>
  </Card>;
}

export function OnboardingFlow() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { brief, setBrief, saveProfile } = useWorkspace();
  const [activeStep, setActiveStep] = useState(0);
  const [towns, setTowns] = useState([]);
  const [flatTypes, setFlatTypes] = useState([]);
  const [optionsState, setOptionsState] = useState('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const loadOptions = useCallback(async () => {
    setOptionsState('loading');
    try {
      const payload = await requestJson('/api/v1/search/options', { cache: 'no-store' });
      setTowns(Array.isArray(payload.towns) ? payload.towns : []);
      setFlatTypes(Array.isArray(payload.flatTypes) ? payload.flatTypes : []);
      setOptionsState('ready');
    } catch {
      setTowns([]);
      setFlatTypes([]);
      setOptionsState('error');
    }
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const step = steps[activeStep];
  const stepContent = useMemo(() => {
    if (activeStep === 0) return <HouseholdStep brief={brief} setBrief={setBrief} />;
    if (activeStep === 1) return <BudgetStep brief={brief} setBrief={setBrief} />;
    if (activeStep === 2) return <AreaChoices brief={brief} setBrief={setBrief} towns={towns} flatTypes={flatTypes} optionsState={optionsState} retryOptions={loadOptions} />;
    return <PriorityStep brief={brief} setBrief={setBrief} />;
  }, [activeStep, brief, flatTypes, loadOptions, optionsState, setBrief, towns]);

  async function finishOnboarding() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveProfile({ profile: brief, onboardingCompleted: true });
      router.replace('/explore');
    } catch (error) {
      if (error?.name !== 'AbortError') setSaveError(error.message || 'Your preferences could not be saved. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  function continueWithoutSaving() {
    router.replace('/explore');
  }

  return <div className="space-y-6 sm:space-y-7">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold text-primary">Set up your search</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">What should a home work around?</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A few preferences help shape your first search. You can skip this and change everything later.</p>
      </div>
      <Button type="button" variant="ghost" className="self-start sm:self-auto" disabled={saving} onClick={finishOnboarding}>Skip for now</Button>
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.82fr)] lg:gap-5">
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-border/70 bg-background/35 px-5 py-5 sm:px-7">
          <div className="mb-4 flex items-center justify-between gap-4">
            <nav aria-label="Setup progress" className="flex items-center gap-1.5">
              {steps.map((item, index) => <button key={item.title} type="button" disabled={index > activeStep || saving} onClick={() => setActiveStep(index)} aria-label={`Step ${index + 1}: ${item.title}`} aria-current={index === activeStep ? 'step' : undefined} className={`group flex items-center gap-1.5 rounded-md p-1 text-xs focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${index <= activeStep ? 'text-foreground' : 'text-muted-foreground/55'}`}>
                <span className={`grid size-6 place-items-center rounded-full border text-[10px] font-semibold ${index < activeStep ? 'border-primary bg-primary text-primary-foreground' : index === activeStep ? 'border-primary text-primary' : 'border-border'}`}>{index < activeStep ? <Check className="size-3" /> : index + 1}</span>
                <span className="hidden sm:inline">{item.title}</span>
              </button>)}
            </nav>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{activeStep + 1} / {steps.length}</span>
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={activeStep + 1} className="h-1 overflow-hidden rounded-full bg-secondary">
            <motion.div className="h-full w-full origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: (activeStep + 1) / steps.length }} transition={{ duration: reduceMotion ? 0 : 0.35, ease: 'easeOut' }} />
          </div>
          <div aria-live="polite" className="sr-only">Step {activeStep + 1} of {steps.length}: {step.title}</div>
          <CardTitle id="onboarding-step-heading" className="mt-5 text-2xl sm:text-[1.65rem]">{step.heading}</CardTitle>
          <CardDescription className="mt-1 max-w-xl leading-6">{step.description}</CardDescription>
        </CardHeader>

        <CardContent className="px-5 py-5 sm:px-7 sm:py-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeStep} initial={reduceMotion ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduceMotion ? 0 : -14 }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }} aria-labelledby="onboarding-step-heading">
              {stepContent}
            </motion.div>
          </AnimatePresence>
          {optionsState === 'error' && activeStep === 2 && <p role="status" className="sr-only">Area options are unavailable. You can continue without selecting a town or flat type.</p>}
          {saveError && <Alert tone="error" className="mt-5 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{saveError}</span><div className="flex shrink-0 flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={saving} onClick={finishOnboarding}>Retry save</Button><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={continueWithoutSaving}>Explore without saving</Button><button type="button" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:text-foreground" aria-label="Dismiss save message" onClick={() => setSaveError('')}><X className="size-4" /></button></div></Alert>}
        </CardContent>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-background/35 px-5 py-4 sm:px-7">
          <Button type="button" variant="outline" disabled={activeStep === 0 || saving} onClick={() => setActiveStep((current) => Math.max(0, current - 1))}><ArrowLeft className="size-4" />Back</Button>
          {activeStep < steps.length - 1
            ? <Button type="button" disabled={saving} onClick={() => setActiveStep((current) => Math.min(steps.length - 1, current + 1))}>Continue <ArrowRight className="size-4" /></Button>
            : <Button type="button" disabled={saving} onClick={finishOnboarding}>{saving ? 'Saving…' : 'Save and explore'} <ArrowRight className="size-4" /></Button>}
        </div>
      </Card>

      <div className="lg:sticky lg:top-8">
        <SearchSummary brief={brief} />
        <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground">Your household and preferences stay in your HomeCompass account. Search results depend on available source data.</p>
      </div>
    </div>
  </div>;
}
