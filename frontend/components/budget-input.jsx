'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { money } from '@/lib/utils';

export function BudgetInput({ value, onChange, compact = false }) {
  const id = useId();
  const amount = value == null || value === '' ? '' : Number(value);
  return <div className={compact ? 'space-y-2' : 'space-y-3'}>
    <label htmlFor={id} className="block text-sm font-semibold">Maximum recorded price</label>
    <div className="relative"><span className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">S$</span><Input id={id} name="budget" type="number" inputMode="numeric" min="0" max="10000000" step="1000" value={amount} placeholder="No price limit" aria-describedby={`${id}-help`} className="min-h-11 pl-10" onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))} /></div>
    {!compact && <input aria-label="Maximum recorded price slider" type="range" min="0" max="2500000" step="10000" value={Math.max(0, Math.min(2500000, Number(amount) || 0))} onChange={event => onChange(Number(event.target.value))} className="min-h-11 w-full accent-primary" />}
    <p id={`${id}-help`} className="text-xs leading-5 text-muted-foreground">{amount === '' ? 'No price ceiling.' : `${money(amount)} ceiling.`} Historical prices; this does not determine loan eligibility.</p>
  </div>;
}
