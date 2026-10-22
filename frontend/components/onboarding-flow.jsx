'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Compass, Minus, Plus, RotateCw, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace-provider';
import { money } from '@/lib/utils';
import { requestJson } from '@/lib/api-client';

const steps = [
  { title: 'Household', heading: 'Who will live here?', description: 'This helps set a sensible starting point for your search.' },
  { title: 'Budget', heading: 'What price feels workable?', description: 'Set a ceiling for the homes you want to compare.' },
  { title: 'Areas', heading: 'Which areas should we start with?', description: 'Pick up to three towns and, if you like, a flat type.' },
  { title: 'Priorities', heading: 'What matters day to day?', description: 'Set the services and trade-offs you want search to consider.' },
];

const distanceChoices = [500, 1000, 1500, 2000, 3000];
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

function CountControl({ label, value, min, max = 10, onChange }) {
  const reduceMotion = useReducedMotion();
  const inputId = `household-${label.toLowerCase().replaceAll(' ', '-')}`;
  return <div className="rounded-xl border bg-background/70 px-3 py-3 sm:px-4">
    <div className="mb-2 flex items-center justify-between gap-3">
      <span id={inputId} className="text-sm font-medium text-foreground">{label}</span>
      <output aria-label={`${label} count`} className="min-w-8 text-right text-sm font-semibold tabular-nums">{value}</output>
    </div>
    <div role="group" aria-labelledby={inputId} className="flex items-center gap-2">
      <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus className="size-4" /></Button>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><motion.div className="h-full w-full origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: Math.max(0.08, value / max) }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 28 }} /></div>
      <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus className="size-4" /></Button>
    </div>
  </div>;
}

function RouteSketch({ step, towns }) {
  const reduceMotion = useReducedMotion();
  const routeLength = (step + 1) / steps.length;
  const route = 'M 28 176 C 72 177 79 130 118 132 S 162 169 200 137 S 249 91 281 108 S 327 122 365 63';
  const pins = [
    { x: 118, y: 132 },
    { x: 200, y: 137 },
    { x: 281, y: 108 },
  ];

  return <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.035] p-3">
    <svg viewBox="0 0 400 220" role="img" aria-label={`Illustrative route diagram, not a geographic map${towns.length ? `, with ${towns.join(', ')} selected` : ''}`} className="h-auto w-full">
      <g fill="none" stroke="hsl(var(--primary))" strokeWidth="1" opacity="0.11" aria-hidden="true">
        <path d="M-20 45C32 5 88 8 117 41s82 38 120 4 88-43 153-9" />
        <path d="M-21 56C37 16 85 22 112 51s82 43 129 9 90-43 147-14" />
        <path d="M-20 71C28 37 82 35 106 64s76 48 131 20 94-39 157-15" />
        <path d="M-11 194C31 156 63 157 91 183s81 31 118 6 69-50 108-30 56 35 98 4" />
        <path d="M-16 207C30 174 63 173 87 195s82 34 127 11 72-46 107-27 52 34 95 8" />
      </g>
      <path d="M17 28 90 96 62 143 117 205M154 11 133 80 181 107 152 202M260 20 237 76 279 105 250 205M380 17 327 77 361 125 319 208" fill="none" stroke="hsl(var(--border))" strokeWidth="1.5" strokeDasharray="3 7" opacity="0.78" aria-hidden="true" />
      <path d={route} fill="none" stroke="hsl(var(--primary) / 0.18)" strokeWidth="4" strokeLinecap="round" aria-hidden="true" />
      <motion.path
        d={route}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="0.02 0.015"
        initial={false}
        animate={{ pathLength: routeLength, strokeDashoffset: reduceMotion ? 0 : -0.18 }}
        transition={{
          pathLength: { duration: reduceMotion ? 0 : 0.7, ease: 'easeInOut' },
          strokeDashoffset: reduceMotion ? { duration: 0 } : { duration: 4.5, repeat: Infinity, ease: 'linear' },
        }}
        aria-hidden="true"
      />
      <circle cx="28" cy="176" r="5" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" aria-hidden="true" />
      {pins.map((pin, index) => <motion.g key={index} initial={false} animate={{ scale: towns[index] ? 1 : 0.78, opacity: towns[index] ? 1 : 0.38 }} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 22 }} style={{ transformOrigin: `${pin.x}px ${pin.y}px` }} aria-hidden="true">
        <circle cx={pin.x} cy={pin.y} r="9" fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="1.5" />
        <circle cx={pin.x} cy={pin.y} r="3.5" fill="hsl(var(--primary))" />
      </motion.g>)}
      <path d="M365 54v18m-9-9h18" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" aria-hidden="true" />
    </svg>
    <p className="px-1 pb-1 text-[11px] leading-4 text-muted-foreground">Illustrative route only — not a street or travel-time map.</p>
  </div>;
}

function AreaChoices({ brief, setBrief, towns, flatTypes, optionsState, retryOptions }) {
  const reduceMotion = useReducedMotion();
  const selectedTowns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  const townChoices = [...new Set([...towns, ...selectedTowns])];
  const typeChoices = [...new Set([...flatTypes, ...(brief.preferredFlatType ? [brief.preferredFlatType] : [])])];
  const toggleTown = (town) => setBrief({
    ...brief,
    preferredTowns: selectedTowns.includes(town)
      ? selectedTowns.filter((selected) => selected !== town)
      : [...selectedTowns, town],
  });

  return <div className="space-y-6">
    <fieldset>
      <legend className="text-sm font-semibold">Towns</legend>
      <div className="mb-3 mt-1 flex items-end justify-between gap-3">
        <p className="text-xs text-muted-foreground">Choose up to three. Clear them to keep every town in play.</p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{selectedTowns.length} of 3</span>
      </div>
      {optionsState === 'loading' && townChoices.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">Loading towns from the latest resale data…</p>
        : townChoices.length ? <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded-xl border bg-muted/20 p-2 sm:grid-cols-3">
          {townChoices.map((town) => {
            const selected = selectedTowns.includes(town);
            const atLimit = !selected && selectedTowns.length >= 3;
            return <motion.button key={town} type="button" whileTap={reduceMotion ? undefined : { scale: 0.97 }} aria-pressed={selected} disabled={atLimit} onClick={() => toggleTown(town)} className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${selected ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-transparent bg-background/75 text-muted-foreground hover:border-border hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-45`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>{selected && <Check className="size-2.5" />}</span>
              <span className="truncate">{town}</span>
            </motion.button>;
          })}
        </div> : <div className="rounded-xl border border-dashed px-4 py-4">
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
          <button type="button" aria-pressed={!brief.preferredFlatType} onClick={() => setBrief({ ...brief, preferredFlatType: null })} className={`min-h-10 rounded-lg border px-3 text-xs font-medium transition-colors ${!brief.preferredFlatType ? 'border-primary/45 bg-primary/10 text-foreground' : 'bg-background/70 text-muted-foreground hover:text-foreground'}`}>No preference</button>
          {typeChoices.map((flatType) => <button key={flatType} type="button" aria-pressed={brief.preferredFlatType === flatType} onClick={() => setBrief({ ...brief, preferredFlatType: flatType })} className={`min-h-10 rounded-lg border px-3 text-xs font-medium transition-colors ${brief.preferredFlatType === flatType ? 'border-primary/45 bg-primary/10 text-foreground' : 'bg-background/70 text-muted-foreground hover:text-foreground'}`}>{flatType}</button>)}
        </div>}
    </fieldset>
  </div>;
}

function HouseholdStep({ brief, setBrief }) {
  return <div className="space-y-3">
    <CountControl label="Adults" value={brief.adults} min={1} onChange={(value) => setBrief({ ...brief, adults: value })} />
    <CountControl label="Children" value={brief.children} min={0} onChange={(value) => setBrief({ ...brief, children: value })} />
    <CountControl label="Older adults" value={brief.olderAdults} min={0} onChange={(value) => setBrief({ ...brief, olderAdults: value })} />
  </div>;
}

function BudgetStep({ brief, setBrief }) {
  const min = 200000;
  const max = 2500000;
  const sliderValue = Math.max(min, Math.min(max, Number(brief.budget) || min));
  const updateBudget = (value) => setBrief({ ...brief, budget: Math.max(0, Math.round(Number(value) || 0)) });
  return <div className="space-y-6">
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3"><label htmlFor="onboarding-budget" className="text-sm font-semibold">Maximum budget</label><output htmlFor="onboarding-budget" className="font-display text-lg font-semibold tabular-nums">{money(brief.budget)}</output></div>
      <input id="onboarding-budget-range" aria-label="Maximum budget slider" type="range" min={min} max={max} step="10000" value={sliderValue} onChange={(event) => updateBudget(event.target.value)} className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))]" />
      <p id="budget-help" className="mt-2 text-xs leading-5 text-muted-foreground">A price ceiling, not a loan or affordability calculation.</p>
    </div>
    <div className="max-w-xs">
      <label htmlFor="onboarding-budget" className="mb-2 block text-xs font-semibold">Or enter an exact amount</label>
      <div className="relative"><span className="pointer-events-none absolute left-3.5 top-3 text-sm text-muted-foreground">S$</span><Input id="onboarding-budget" name="budget" type="number" min="0" max="10000000" step="10000" value={brief.budget} aria-describedby="budget-help" onChange={(event) => updateBudget(event.target.value)} className="pl-12" /></div>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="Suggested budget amounts">
      {[450000, 600000, 800000, 1000000].map((amount) => <button key={amount} type="button" aria-pressed={brief.budget === amount} onClick={() => updateBudget(amount)} className={`min-h-9 rounded-lg border px-3 text-xs transition-colors ${brief.budget === amount ? 'border-primary/45 bg-primary/10 text-foreground' : 'bg-background/70 text-muted-foreground hover:text-foreground'}`}>{money(amount)}</button>)}
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
      <legend className="text-sm font-semibold">Start with a preset</legend>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {priorityPresets.map((preset) => <motion.button key={preset.name} type="button" whileTap={reduceMotion ? undefined : { scale: 0.97 }} aria-pressed={activePreset === preset.name} onClick={() => setBrief({ ...brief, priorityWeights: preset.weights })} className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${activePreset === preset.name ? 'border-primary/45 bg-primary/10 text-foreground' : 'bg-background/70 text-muted-foreground hover:text-foreground'}`}>{preset.name}</motion.button>)}
      </div>
    </fieldset>
    <div className="grid gap-2 sm:grid-cols-2">
      {priorityNames.map(([key, label]) => <fieldset key={key} className="rounded-xl border bg-background/65 p-3">
        <legend className="px-1 text-xs font-semibold">{label}</legend>
        <div role="group" aria-label={`${label} priority`} className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
          {[[1, 'Normal'], [2, 'Important'], [3, 'Essential']].map(([value, title]) => <button key={value} type="button" aria-pressed={weights[key] === value} onClick={() => updateWeight(key, value)} className={`min-h-9 rounded-md px-1 text-[11px] transition-colors ${weights[key] === value ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{title}</button>)}
        </div>
      </fieldset>)}
    </div>
    <fieldset>
      <legend className="text-sm font-semibold">Optional distance limits</legend>
      <p className="mb-3 mt-1 text-xs text-muted-foreground">Homes without distance data may not match a limit.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['schoolDistance', 'Schools'],
          ['childcareDistance', 'Childcare'],
          ['careDistance', 'Care services'],
        ].map(([key, label]) => <label key={key} className="flex flex-col gap-2"><span className="text-xs font-medium">{label}</span><select name={key} className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={brief[key] ?? ''} onChange={(event) => setBrief({ ...brief, [key]: event.target.value === '' ? null : Number(event.target.value) })}><option value="">No limit</option>{distanceChoices.map((distance) => <option key={distance} value={distance}>Within {distance >= 1000 ? `${distance / 1000} km` : `${distance} m`}</option>)}</select></label>)}
      </div>
    </fieldset>
  </div>;
}

function SearchSummary({ brief, step }) {
  const towns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  const priorities = brief.priorityWeights || {};
  const distanceLabel = (distance) => distance == null ? 'No limit' : `Within ${distance >= 1000 ? `${distance / 1000} km` : `${distance} m`}`;
  return <Card className="overflow-hidden rounded-2xl">
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <div><p className="text-sm font-semibold">Your search so far</p><p className="mt-1 text-xs text-muted-foreground">Changes as you go</p></div>
      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Compass className="size-4" /></span>
    </div>
    <CardContent className="space-y-4 p-5 pt-4">
      <RouteSketch step={step} towns={towns} />
      <dl className="divide-y divide-border/70 rounded-xl border bg-background/55 px-3">
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-xs text-muted-foreground">Household</dt><dd className="text-right text-xs font-medium">{brief.adults} adults · {brief.children} children · {brief.olderAdults} older adults</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-xs text-muted-foreground">Budget</dt><dd className="text-right text-xs font-semibold">Up to {money(brief.budget)}</dd></div>
        <div className="flex items-start justify-between gap-3 py-2.5"><dt className="pt-0.5 text-xs text-muted-foreground">Towns</dt><dd className="max-w-[65%] text-right text-xs font-medium">{towns.length ? towns.join(', ') : 'No preference'}</dd></div>
        <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-xs text-muted-foreground">Flat type</dt><dd className="text-right text-xs font-medium">{brief.preferredFlatType || 'No preference'}</dd></div>
        <div className="flex items-start justify-between gap-3 py-2.5"><dt className="pt-0.5 text-xs text-muted-foreground">Nearby</dt><dd className="max-w-[68%] text-right text-xs font-medium">Schools {distanceLabel(brief.schoolDistance)}<br />Childcare {distanceLabel(brief.childcareDistance)}<br />Care {distanceLabel(brief.careDistance)}</dd></div>
      </dl>
      <div>
        <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Priority weights</p>
        <div className="flex flex-wrap gap-1.5">{priorityNames.map(([key, label]) => <span key={key} className="rounded-full border bg-background/65 px-2.5 py-1 text-[10px] text-muted-foreground">{label} {priorities[key] || 1}/3</span>)}</div>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">You can change any of these in Explore. The line above is decorative and does not show travel routes.</p>
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
        <SearchSummary brief={brief} step={activeStep} />
        <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground">Your household and preferences stay in your HomeCompass account. Search results depend on available source data.</p>
      </div>
    </div>
  </div>;
}
