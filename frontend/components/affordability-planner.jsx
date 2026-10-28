'use client';

import { useState } from 'react';
import { money } from '@/lib/utils';

export function calculateAffordability(values) {
  const entries = Object.entries(values);
  if (entries.some(([, value]) => value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0)) return { error: 'Enter a non-negative number in every field.' };
  const { price, loan, cpf, cash, costs, renovation, rate, years, recurring, monthlyCpf } = Object.fromEntries(entries.map(([key, value]) => [key, Number(value)]));
  if (!(price > 0) || !(years > 0) || years > 50) return { error: 'Enter a purchase price above zero and a term above zero, up to 50 years.' };
  if (loan > price) return { error: 'The loan cannot exceed the purchase price in this planner.' };
  const months = Math.round(years * 12), monthlyRate = rate / 1200;
  const payment = monthlyRate ? loan * monthlyRate / (1 - (1 + monthlyRate) ** -months) : loan / months;
  if (!Number.isFinite(payment)) return { error: 'These loan inputs are outside the supported range.' };
  const upfront = price - loan + costs + renovation;
  return { upfront, gap: Math.max(0, upfront - cpf - cash), surplus: Math.max(0, cpf + cash - upfront), payment, monthlyCash: Math.max(0, payment - monthlyCpf) + recurring, interest: payment * months - loan };
}

const fields = [
  ['price', 'Planned purchase price (SGD)'], ['loan', 'Planned loan principal (SGD)'],
  ['cpf', 'CPF planned upfront (SGD)'], ['cash', 'Cash available upfront (SGD)'],
  ['costs', 'Stamp duty, legal and other upfront costs (SGD)'], ['renovation', 'Renovation and moving budget (SGD)'],
  ['rate', 'Annual loan interest (%)'], ['years', 'Loan term (years)'],
  ['monthlyCpf', 'CPF planned per month (SGD)'], ['recurring', 'Monthly recurring cash costs (SGD)'],
];

export function AffordabilityPlanner({ initialPrice = 0 }) {
  const [values, setValues] = useState({ price: initialPrice || '', loan: 0, cpf: 0, cash: 0, costs: 0, renovation: 0, rate: 0, years: 25, recurring: 0, monthlyCpf: 0 });
  const result = calculateAffordability(values);
  return <section aria-label="Affordability planner" className="space-y-4 rounded-xl border p-4">
    <div><h3 className="font-display text-lg font-semibold">Plan the cash and CPF commitment</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Enter a possible purchase price and your own financing assumptions. The recorded transaction price is a starting point for research. It is not an asking price or valuation.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label]) => <label key={key} className="space-y-1 text-xs font-medium">{label}<input className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" type="number" inputMode="decimal" min="0" step={key === 'rate' ? '0.1' : '1'} max={key === 'years' ? '50' : undefined} value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
    {result.error ? <p role="alert" className="text-sm">{result.error}</p> : <dl aria-live="polite" className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">{[
      ['Upfront required', money(result.upfront)], ['Unfunded upfront amount', money(result.gap)],
      ['Monthly loan instalment', money(result.payment)], ['Monthly cash incl. recurring', money(result.monthlyCash)],
      ['Total loan interest', money(result.interest)], ['Unallocated upfront funds', money(result.surplus)],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>}
    <details className="text-xs leading-6 text-muted-foreground"><summary className="min-h-11 cursor-pointer font-medium text-foreground">Calculation and limits</summary><p>Upfront = purchase price − loan + upfront costs + renovation. Funding gap = max(0, upfront − planned CPF − cash). Monthly instalment = loan × r ÷ (1 − (1 + r)⁻ⁿ), where r = annual interest ÷ 1,200 and n = term × 12 rounded to whole months. At 0% interest, instalment = loan ÷ n. Monthly cash = max(0, instalment − planned monthly CPF) + recurring costs.</p><p className="mt-2">CPF inputs are your proposed allocation, not an approved CPF withdrawal. Cash-only requirements, valuation limits, accrued CPF interest, grants, loan approval, eligibility and taxes are not determined here. Enter verified duties and fees yourself. No grant or regulatory loan limit is assumed. Rates stay constant in this estimate.</p></details>
    <p className="text-xs leading-6 text-muted-foreground"><a href="https://www.hdb.gov.sg/buying-a-flat/flat-grant-and-loan-eligibility/application-for-an-hdb-flat-eligibility-hfe-letter" target="_blank" rel="noreferrer" className="text-primary underline">HDB Flat Eligibility guidance</a> explains the official eligibility assessment. Check permitted CPF usage with <a href="https://www.cpf.gov.sg/member/home-ownership/using-your-cpf-to-buy-a-home" target="_blank" rel="noreferrer" className="text-primary underline">CPF Board home financing guidance</a>.</p>
  </section>;
}
