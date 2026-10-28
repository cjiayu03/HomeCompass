'use client';

import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';

const statuses = { research: 'Researching', visit: 'Plan a visit', considering: 'Considering', 'ruled-out': 'Ruled out' };
const defaultChecks = { daylight: false, noise: false, ventilation: false, condition: false, accessibility: false };
const hasValue = value => value != null && String(value).trim() !== '';
const titleCase = value => String(value).replace(/^custom[-_:]?/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function visitDateLabel(value) {
  if (!hasValue(value)) return 'Not scheduled';
  // datetime-local represents the Singapore viewing wall clock, regardless of browser timezone.
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ? `${value}+08:00` : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? `${value} (time zone unverified)` : `${date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT (Asia/Singapore)`;
}

export function preferenceEntries(brief = {}) {
  const entries = [];
  const rule = key => brief.requirements?.[key] === false ? 'preference' : 'must-have';
  const add = (key, label, value) => { if (hasValue(value)) entries.push([`${label} (${rule(key)})`, value]); };
  const household = [['Adults', brief.adults], ['Children', brief.children], ['Older adults', brief.olderAdults]].filter(([, value]) => hasValue(value));
  if (household.length) entries.push(['Household', household.map(([label, value]) => `${value} ${label.toLowerCase()}`).join(' · ')]);
  if (hasValue(brief.budget)) add('budget', 'Budget', money(Number(brief.budget)));
  if (brief.preferredTowns?.length) add('towns', 'Towns', brief.preferredTowns.join(', '));
  add('flatType', 'Flat type', brief.preferredFlatType);
  for (const [key, label, unit] of [
    ['minFloorArea', 'Minimum area', 'm²'], ['maxFloorArea', 'Maximum area', 'm²'],
    ['minStorey', 'Minimum storey', ''], ['maxStorey', 'Maximum storey', ''],
    ['minLease', 'Minimum estimated lease', 'years'], ['maxPricePerSqm', 'Maximum price per m²', 'SGD'],
    ['observedAfter', 'Transactions from', ''], ['schoolDistance', 'School straight-line target', 'm'],
    ['childcareDistance', 'Childcare straight-line target', 'm'], ['careDistance', 'Care straight-line target', 'm'],
  ]) if (hasValue(brief[key])) add(key, label, `${brief[key]} ${unit}`.trim());
  if (hasValue(brief.pinLocation)) entries.push([brief.pinLabel || 'Reference location', brief.pinLocation]);
  for (const constraint of brief.placeConstraints || []) add('placeConstraints', `Saved place ${constraint.label || constraint.placeId}`, `${constraint.maxDistanceM} m maximum straight-line distance`);
  if (brief.priorityWeights && Object.keys(brief.priorityWeights).length) entries.push(['Source score priority weights', Object.entries(brief.priorityWeights).map(([key, value]) => `${titleCase(key)} ${value}/3`).join(' · ')]);
  return entries;
}

const definitionList = entries => `<dl>${entries.map(([label, value]) => `<div class="pair"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
const textSection = (title, value) => hasValue(value) ? `<section><h4>${escapeHtml(title)}</h4><p>${escapeHtml(value)}</p></section>` : '';

function evidenceEntries(home) {
  const details = home.scoreDetails || {};
  const components = Array.isArray(details.components) ? details.components : [];
  const missing = [...new Set([...(Array.isArray(details.missingEvidence) ? details.missingEvidence : []), ...components.filter(component => component.evidenceStatus === 'missing' || !Number.isFinite(component.normalizedValue) || !Number.isFinite(component.contribution)).map(component => component.name)])];
  return [
    ['Record meaning', home.sourceSemantics === 'historical_transaction' ? 'Historical transaction · not a current listing' : /fixture/i.test(`${home.sourceSemantics} ${home.source}`) ? 'Illustrative sample · not verified source data' : 'Source semantics unavailable'],
    ['Source', home.source || 'Unavailable'], ['Source date', home.sourceUpdated || 'Unavailable'],
    ['Transaction date', home.observedOn || home.transactionDate || 'Unavailable'],
    ['Source score', Number.isFinite(home.score) ? `${home.score} / 100` : 'Insufficient evidence'],
    ['Evidence coverage', Number.isFinite(details.coverage) ? `${Math.round(details.coverage * 100)}%` : 'Unavailable'],
    ['Score policy', details.policyVersion || 'Unavailable'],
    ...components.map(component => [`${titleCase(component.name)} score component`, component.evidenceStatus === 'missing' || !Number.isFinite(component.normalizedValue) || !Number.isFinite(component.contribution) ? 'Evidence missing; no contribution assigned' : `Normalized ${component.normalizedValue} / 100 · weight ${component.weight ?? 'unavailable'} · ${component.contribution} points`]),
    ['Missing score evidence', missing.length ? missing.map(titleCase).join(' · ') : Array.isArray(details.missingEvidence) ? 'No missing evidence reported' : 'Unavailable'],
    ['Geocoding', home.geocodeStatus || 'Unavailable'], ['Geocode source', home.geocodeSource || 'Unavailable'],
    ['Current availability', 'Unavailable; not a live listing feed'],
  ];
}

function distanceEntries(home) {
  if (!home.placeDistances?.length) return [['Saved place distances', 'No distance evidence recorded']];
  return home.placeDistances.map(distance => [`Distance to ${distance.label || distance.placeId || 'saved place'}`, `${distance.method === 'straight-line' && Number.isFinite(Number(distance.distanceM)) && distance.distanceM != null ? `${Math.round(Number(distance.distanceM))} m straight-line estimate` : 'Distance unavailable; method unverified'}${distance.maximumDistanceM != null ? ` · target maximum ${distance.maximumDistanceM} m` : ''}. Travel time and route unavailable.`]);
}

const safePhoto = photo => typeof photo?.dataUrl === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl);

function summaryBody(homes, brief, decisions, photos, includePhotos) {
  const preferences = preferenceEntries(brief);
  const sections = homes.map(home => {
    const decision = decisions?.[home.id] || {};
    const checklist = { ...defaultChecks, ...(decision.checklist || {}) };
    const checks = Object.entries(checklist);
    const completed = checks.filter(([, checked]) => checked === true).length;
    const ratings = Array.isArray(decision.ratings) ? decision.ratings : [];
    const viewingPhotos = includePhotos ? (photos?.[home.id] || []).filter(safePhoto) : [];
    const facts = [
      ['Decision', statuses[decision.status] || statuses.research], ['Scheduled visit', visitDateLabel(decision.visitDate)],
      ['Recorded price', Number.isFinite(home.price) ? money(home.price) : 'Unavailable'],
      ['Floor area', home.floorAreaSqm != null ? `${home.floorAreaSqm} m²` : 'Unavailable'],
      ['Storey range', home.storeyRange || 'Unavailable'],
      ['Remaining lease', home.remainingLeaseYears != null ? `${home.remainingLeaseYears} years (estimate)` : 'Unavailable'],
      ['School access', home.school || 'Unavailable'], ['Childcare access', home.childcare || 'Unavailable'],
      ['Care access', home.care || 'Unavailable'], ['Dengue context', home.risk || 'Unavailable'],
      ...ratings.map((rating, index) => [`${rating.name || `Household member ${index + 1}`} rating`, `${rating.score ?? 'Unavailable'} / 5`]),
    ];
    return `<article class="summary-home"><header><p class="eyebrow">${escapeHtml(home.town || 'Town unavailable')} · ${escapeHtml(home.type || 'Flat type unavailable')}</p><h3>${escapeHtml(home.address || 'Saved candidate')}</h3></header>${definitionList(facts)}<section><h4>Evidence and source coverage</h4>${definitionList(evidenceEntries(home))}</section><section><h4>Private place distance context</h4>${definitionList(distanceEntries(home))}</section>${textSection('Pros', decision.pros)}${textSection('Trade-offs', decision.cons)}${textSection('Household notes', decision.notes)}<section><h4>Viewing checklist: ${completed} of ${checks.length} complete</h4><ul>${checks.map(([key, checked]) => `<li>${checked === true ? 'Complete' : 'To check'}: ${escapeHtml(decision.checklistLabels?.[key] || titleCase(key))}</li>`).join('')}</ul></section>${viewingPhotos.length ? `<section><h4>Viewing photos (included by your choice)</h4><div class="summary-photos">${viewingPhotos.map(photo => `<figure><img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.name || 'Viewing photo')}"/><figcaption>${escapeHtml(photo.name || 'Viewing photo')}</figcaption></figure>`).join('')}</div></section>` : ''}</article>`;
  }).join('');
  return `<header><p class="eyebrow">HomeCompass · Household planning</p><h2>Decision summary</h2><p>Evidence and household notes for ${homes.length} selected candidates. This copy contains private notes and saved place labels; choose who receives it.</p></header><section class="summary-preferences"><h3>Household criteria</h3>${definitionList(preferences.length ? preferences : [['Criteria', 'No criteria recorded']])}</section>${sections}`;
}

const summaryStyles = `
.decision-print{font-family:Arial,Helvetica,sans-serif;color:inherit;font-size:13px;line-height:1.55}.decision-print h2{font-size:26px;font-weight:600;margin:4px 0}.decision-print h3{font-size:18px;font-weight:600;margin:4px 0 12px}.decision-print h4{font-size:13px;font-weight:600;margin:0 0 8px}.decision-print .eyebrow{font-size:11px;opacity:.8}.decision-print dl{display:grid;grid-template-columns:minmax(110px,1fr) 2fr;gap:7px 16px;margin:0}.decision-print .pair{display:contents}.decision-print dt{opacity:.75}.decision-print dd{margin:0;overflow-wrap:anywhere}.decision-print p{margin:0;white-space:pre-wrap}.decision-print section{margin-top:16px}.decision-print .summary-home,.decision-print .summary-preferences{border:1px solid #a9b9ac;border-radius:12px;padding:16px;margin-top:20px;break-inside:avoid-page}.decision-print .summary-home header{border-bottom:1px solid #a9b9ac;margin-bottom:14px;padding-bottom:8px}.decision-print ul{padding-left:20px}.decision-print .summary-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.decision-print figure{margin:0}.decision-print img{max-width:100%;height:auto}.decision-print figcaption{overflow-wrap:anywhere;font-size:11px}
`;

export function standaloneHtml(homes = [], brief = {}, decisions = {}, photos = {}, includePhotos = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HomeCompass decision summary</title><style>body{margin:0 auto;max-width:1000px;padding:24px;color:#1d2922;background:white}${summaryStyles}@media print{body{padding:0}}</style></head><body><main class="decision-print">${summaryBody(homes, brief, decisions, photos, includePhotos)}</main></body></html>`;
}

export function DecisionSummary({ homes = [], brief = {}, decisions = {}, photos = {} }) {
  const [includePhotos, setIncludePhotos] = useState(false);
  const hasPhotos = homes.some(home => (photos?.[home.id] || []).some(safePhoto));
  function downloadHtml() {
    const blob = new Blob([standaloneHtml(homes, brief, decisions, photos, includePhotos)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `homecompass-decision-summary-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <div className="space-y-4">
    <style>{summaryStyles}{`@media print{@page{margin:14mm}body *{visibility:hidden!important}[data-homecompass-decision-summary],[data-homecompass-decision-summary] *{visibility:visible!important}body *:has([data-homecompass-decision-summary]){display:block!important;height:auto!important;overflow:visible!important;max-height:none!important;padding:0!important;margin:0!important}body *:not(:has([data-homecompass-decision-summary])):not([data-homecompass-decision-summary]):not([data-homecompass-decision-summary] *){display:none!important}[data-homecompass-decision-summary]{position:static!important;max-height:none!important;overflow:visible!important;background:white!important;color:#17231b!important}[data-homecompass-decision-summary] *{box-shadow:none!important;color:#17231b!important}}`}</style>
    <p className="text-xs leading-6 text-muted-foreground">Your copy includes household notes, criteria and private place distance context. Photos are excluded unless you select them here. Downloads do not put personal locations into a shared URL.</p>
    {hasPhotos && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includePhotos} onChange={event => setIncludePhotos(event.target.checked)} />Include viewing photos in print and download</label>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.print()}><Printer className="size-4" />Print summary</Button><Button variant="outline" onClick={downloadHtml}><Download className="size-4" />Download HTML</Button></div>
    <section data-homecompass-decision-summary aria-label="Printable decision summary" className="decision-print rounded-xl border bg-card p-4 sm:p-6" dangerouslySetInnerHTML={{ __html: summaryBody(homes, brief, decisions, photos, includePhotos) }} />
  </div>;
}
