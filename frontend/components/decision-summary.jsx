'use client';

import { Download, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EvidenceContext } from '@/components/evidence-context';
import { money } from '@/lib/utils';
import { summarizeHouseholdAges } from '@/lib/household';

const STATUS_LABELS = {
  research: 'Researching',
  visit: 'Plan a visit',
  considering: 'Considering',
  'ruled-out': 'Ruled out',
};

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function titleCase(value) {
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function checklistLabel(key) {
  return titleCase(key.replace(/^custom[-_:]?/i, ''));
}

function dateLabel(value) {
  if (!hasValue(value)) return 'Not scheduled';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function preferenceEntries(brief = {}) {
  const entries = [];
  const household = summarizeHouseholdAges(brief);
  if (household) entries.push(['Household', household]);
  if (hasValue(brief.budget)) entries.push(['Budget', money(Number(brief.budget))]);
  if (Array.isArray(brief.preferredTowns) && brief.preferredTowns.length) entries.push(['Preferred towns', brief.preferredTowns.join(', ')]);
  if (hasValue(brief.preferredFlatType)) entries.push(['Preferred home type', brief.preferredFlatType]);
  for(const [key,label,unit] of [['minFloorArea','Minimum area','m²'],['maxFloorArea','Maximum area','m²'],['minStorey','Minimum storey',''],['maxStorey','Maximum storey',''],['minLease','Minimum estimated lease','years'],['maxPricePerSqm','Maximum price per m²','SGD'],['observedAfter','Transactions from','']]) {
    if(hasValue(brief[key]))entries.push([label,`${brief[key]} ${unit}${brief.requirements?.[key]===false?' (preference)':' (must-have)'}`]);
  }
  if (hasValue(brief.pinLocation)) entries.push([brief.pinLabel || 'Reference location', brief.pinLocation]);

  const accessTargets = [
    ['School', brief.schoolDistance],
    ['Childcare', brief.childcareDistance],
    ['Care', brief.careDistance],
  ].filter(([, distance]) => hasValue(distance));
  if (accessTargets.length) entries.push(['Access targets', accessTargets.map(([name, distance]) => `${name}: ${Number(distance).toLocaleString()} m`).join(' · ')]);

  const priorities = brief.priorityWeights && typeof brief.priorityWeights === 'object'
    ? Object.entries(brief.priorityWeights).filter(([, value]) => hasValue(value))
    : [];
  if (priorities.length) entries.push(['Access priorities', priorities.map(([name, value]) => `${titleCase(name)} ${value}/3`).join(' · ')]);
  return entries;
}

function decisionFor(decisions, homeId) {
  return decisions?.[homeId] || decisions?.[String(homeId)] || {};
}

function semanticsLabel(home) {
  if (home?.sourceSemantics === 'historical_transaction') return 'Historical transaction · not a current listing';
  if (['fixture', 'illustrative_fixture'].includes(home?.sourceSemantics) || /\bfixture\b/i.test(home?.source || '')) {
    return 'Illustrative sample · not verified source data';
  }
  return 'Source semantics unavailable';
}

function sourceDate(home) {
  return hasValue(home?.sourceUpdated) && String(home.sourceUpdated).toLocaleLowerCase() !== 'illustrative only'
    ? home.sourceUpdated
    : 'Unavailable';
}

function firstHomeValue(home, keys) {
  for (const key of keys) {
    if (hasValue(home?.[key])) return home[key];
  }
  return null;
}

function floorAreaLabel(home) {
  const value = firstHomeValue(home, ['floorAreaSqm', 'floor_area_sqm', 'floorArea', 'areaSqm']);
  if (!hasValue(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString()} m²` : `${value} m²`;
}

function remainingLeaseLabel(home) {
  const value = firstHomeValue(home, ['remainingLeaseYears', 'remaining_lease_years', 'remainingLease', 'remaining_lease']);
  if (!hasValue(value)) return null;
  const text = String(value);
  return typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(text.trim()) ? `${text} years` : text;
}

function leaseCommencementLabel(home) {
  return firstHomeValue(home, ['leaseCommenceYear', 'lease_commence_year', 'leaseCommenceDate', 'lease_commence_date']);
}

function evidenceEntries(home) {
  return [
    ['Record meaning', semanticsLabel(home)],
    ['Source', hasValue(home?.source) ? home.source : 'Unavailable'],
    ['Source date', sourceDate(home)],
    ['Transaction date', home?.observedOn || home?.transactionDate || 'Unavailable'],
    ['Geocoding', hasValue(home?.geocodeStatus) ? home.geocodeStatus : 'Unavailable'],
  ];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function htmlDefinitionList(entries) {
  return entries.map(([label, value]) => `<div class="pair"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
}

function htmlTextSection(title, value) {
  if (!hasValue(value)) return '';
  return `<section><h4>${escapeHtml(title)}</h4><p class="preserve-lines">${escapeHtml(value)}</p></section>`;
}

function standaloneHtml(homes, brief, decisions) {
  const preferences = preferenceEntries(brief);
  const homeSections = homes.map((home) => {
    const decision = decisionFor(decisions, home.id);
    const ratings = Array.isArray(decision.ratings) ? decision.ratings : [];
    const checklist = decision.checklist && typeof decision.checklist === 'object' ? decision.checklist : {};
    const checked = Object.entries(checklist).filter(([, value]) => value === true).map(([key]) => checklistLabel(key));
    const scoreValue = hasValue(home.score) ? Number(home.score) : NaN;
    const score = Number.isFinite(scoreValue) ? `${scoreValue.toFixed(1)} / 100` : 'Unavailable';
    const floorArea = floorAreaLabel(home);
    const remainingLease = remainingLeaseLabel(home);
    const leaseCommencement = leaseCommencementLabel(home);
    const summaryDetails = [
      ['Decision', STATUS_LABELS[decision.status] || STATUS_LABELS.research],
      ['Visit', dateLabel(decision.visitDate)],
      ['Price observation', hasValue(home.price) ? money(Number(home.price)) : 'Unavailable'],
      ...(floorArea ? [['Floor area', floorArea]] : []),
      ...(remainingLease ? [['Remaining lease', remainingLease]] : []),
      ...(leaseCommencement ? [['Lease commenced', leaseCommencement]] : []),
      ['Fit score', score],
      ['Viewing checks complete', `${checked.length} of ${Object.keys(checklist).length}`],
      ...ratings.map((rating, index) => [hasValue(rating.name) ? `${rating.name} rating` : `Household rating ${index + 1}`, `${rating.score || 3} / 5`]),
    ];
    const evidence = htmlDefinitionList(evidenceEntries(home));
    return `<article class="home"><header><p class="eyebrow">${escapeHtml(home.town || 'Saved home')} · ${escapeHtml(home.type || 'Home type unavailable')}</p><h3>${escapeHtml(home.address || 'Saved home')}</h3></header><dl>${htmlDefinitionList(summaryDetails)}</dl><section><h4>Evidence and source dates</h4><dl>${evidence}</dl></section>${htmlTextSection('Pros', decision.pros)}${htmlTextSection('Trade-offs', decision.cons)}${htmlTextSection('Household notes', decision.notes)}${checked.length ? `<section><h4>Completed viewing checks</h4><p>${escapeHtml(checked.join(' · '))}</p></section>` : ''}</article>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HomeCompass decision summary</title><style>
    :root{font-family:Arial,Helvetica,sans-serif;color:#1d2922;background:#fff}*{box-sizing:border-box}body{margin:0;padding:32px;max-width:1100px;margin-inline:auto}h1,h2,h3,h4,p,dl{margin:0}h1{font-size:30px;letter-spacing:-.03em}h2{margin:28px 0 12px;font-size:18px}.lede{margin-top:8px;color:#526057;font-size:13px}.home{break-inside:avoid-page;border:1px solid #d9e1da;border-radius:12px;padding:18px;margin-top:14px}.home header{border-bottom:1px solid #e2e8e3;padding-bottom:12px;margin-bottom:12px}.home h3{margin-top:5px;font-size:19px}.eyebrow{font-size:11px;color:#46654f;font-weight:700;letter-spacing:.04em}.home dl{display:grid;grid-template-columns:minmax(135px,190px) 1fr;gap:6px 14px;font-size:12px}.pair{display:contents}.pair dt{color:#647168}.pair dd{margin:0;overflow-wrap:anywhere}.home section{margin-top:14px}.home h4{margin-bottom:6px;font-size:12px}.home section p{font-size:12px;line-height:1.55;white-space:pre-wrap}.preserve-lines{white-space:pre-wrap}.preferences{border:1px solid #d9e1da;border-radius:12px;padding:16px}.preferences dl{display:grid;grid-template-columns:minmax(135px,190px) 1fr;gap:7px 14px;font-size:12px}@media print{body{padding:0}.home,.preferences{break-inside:avoid-page}}
  </style></head><body><header><p class="eyebrow">HomeCompass · Household planning</p><h1>Decision summary</h1><p class="lede">Evidence and household notes for the selected saved homes.</p></header><section class="preferences"><h2>Household preferences</h2><dl>${htmlDefinitionList(preferences.length ? preferences : [['Preferences', 'No preferences recorded']])}</dl></section><h2>Selected homes (${homes.length})</h2>${homeSections}</body></html>`;
}

export function DecisionSummary({ homes = [], brief = {}, decisions = {} }) {
  const preferences = preferenceEntries(brief);

  function downloadHtml() {
    const content = standaloneHtml(homes, brief, decisions);
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `homecompass-decision-summary-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <div className="space-y-4">
    <style>{`
      @media print {
        @page { margin: 14mm; }
        body * { visibility: hidden !important; }
        [data-homecompass-decision-summary], [data-homecompass-decision-summary] * { visibility: visible !important; }
        body *:has([data-homecompass-decision-summary]) { display: block !important; height: auto !important; overflow: visible !important; padding: 0 !important; margin: 0 !important; }
        body *:not(:has([data-homecompass-decision-summary])):not([data-homecompass-decision-summary]):not([data-homecompass-decision-summary] *) { display: none !important; }
        [data-homecompass-decision-summary] { position: static !important; width: 100% !important; max-width: none !important; max-height: none !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: #fff !important; color: #17231b !important; box-shadow: none !important; }
        [data-homecompass-decision-summary] .no-print { display: none !important; }
        [data-homecompass-decision-summary] * { color: #17231b !important; box-shadow: none !important; text-shadow: none !important; }
        [data-homecompass-decision-summary] .print-home { break-inside: avoid-page; border-color: #d7ded8 !important; background: #fff !important; }
        [data-homecompass-decision-summary] time { white-space: nowrap; }
      }
    `}</style>
    <section data-homecompass-decision-summary aria-label="Printable decision summary" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">Ready to share</p><p className="mt-1 text-xs text-muted-foreground">Print or save a standalone copy of these selected homes.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print summary</Button>
          <Button type="button" variant="outline" onClick={downloadHtml}><Download className="size-4" />Download HTML</Button>
        </div>
      </div>

      <header className="border-b border-border/70 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">HomeCompass · Household planning</p>
        <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Decision summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">Evidence and household notes for {homes.length} selected {homes.length === 1 ? 'home' : 'homes'}.</p>
      </header>

      <section aria-labelledby="summary-preferences-title" className="mt-5 rounded-xl border bg-background/50 p-4">
        <h3 id="summary-preferences-title" className="font-display text-lg font-semibold">Household preferences</h3>
        {preferences.length ? <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[minmax(150px,0.4fr)_1fr]">
          {preferences.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 font-medium">{value}</dd></div>)}
        </dl> : <p className="mt-2 text-sm text-muted-foreground">No household preferences recorded.</p>}
      </section>

      <div className="mt-5 space-y-4">
        {homes.map((home) => {
          const decision = decisionFor(decisions, home.id);
          const ratings = Array.isArray(decision.ratings) ? decision.ratings : [];
          const checklist = decision.checklist && typeof decision.checklist === 'object' ? decision.checklist : {};
          const checked = Object.entries(checklist).filter(([, value]) => value === true).map(([key]) => checklistLabel(key));
          const floorArea = floorAreaLabel(home);
          const remainingLease = remainingLeaseLabel(home);
          const leaseCommencement = leaseCommencementLabel(home);
          return <article key={home.id} className="print-home rounded-xl border bg-background/40 p-4 sm:p-5">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{home.town || 'Town unavailable'}</Badge><span className="text-xs text-muted-foreground">{home.type || 'Home type unavailable'}</span></div>
                <h3 className="font-display text-lg font-semibold">{home.address || 'Saved home'}</h3>
                <p className="mt-1 font-medium">{hasValue(home.price) ? money(Number(home.price)) : 'Price unavailable'}</p>
              </div>
              <Badge variant="outline">{STATUS_LABELS[decision.status] || STATUS_LABELS.research}</Badge>
            </header>
            <EvidenceContext home={home} className="mt-4" />
            <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-[minmax(150px,0.4fr)_1fr]">
              {floorArea && <><dt className="text-muted-foreground">Floor area</dt><dd>{floorArea}</dd></>}
              {remainingLease && <><dt className="text-muted-foreground">Remaining lease</dt><dd>{remainingLease}</dd></>}
              {leaseCommencement && <><dt className="text-muted-foreground">Lease commenced</dt><dd>{leaseCommencement}</dd></>}
              <dt className="text-muted-foreground">Scheduled visit</dt><dd>{hasValue(decision.visitDate) ? <time dateTime={decision.visitDate}>{dateLabel(decision.visitDate)}</time> : 'Not scheduled'}</dd>
              {ratings.map((rating, index) => <div key={`rating-${index}`} className="contents"><dt className="text-muted-foreground">{hasValue(rating.name) ? `${rating.name}’s rating` : `Household rating ${index + 1}`}</dt><dd>{rating.score || 3} / 5</dd></div>)}
              {checked.length > 0 && <><dt className="text-muted-foreground">Viewing checks complete</dt><dd>{checked.join(' · ')}</dd></>}
            </dl>
            {(hasValue(decision.pros) || hasValue(decision.cons) || hasValue(decision.notes)) && <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {hasValue(decision.pros) && <section className="rounded-lg border bg-card p-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pros</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{decision.pros}</p></section>}
              {hasValue(decision.cons) && <section className="rounded-lg border bg-card p-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trade-offs</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{decision.cons}</p></section>}
              {hasValue(decision.notes) && <section className="rounded-lg border bg-card p-3 sm:col-span-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Household notes</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{decision.notes}</p></section>}
            </div>}
          </article>;
        })}
      </div>
    </section>
  </div>;
}
