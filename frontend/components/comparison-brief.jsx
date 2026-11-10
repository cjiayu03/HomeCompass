'use client';

import { money } from '@/lib/utils';

const measures = [
  { key: 'affordability', label: 'Lower recorded price', value: h => h.price, lower: true },
  { key: 'space', label: 'More floor space', value: h => h.floorAreaSqm },
  { key: 'lease', label: 'Longer estimated lease', value: h => h.remainingLeaseYears },
  ...['school', 'childcare', 'care'].map(key => ({ key, label: `Closer ${key === 'care' ? 'care service' : key}`, value: h => h.amenityDistancesM?.[key], lower: true })),
];
export function ComparisonBrief({ homes, brief, focus, onFocusChange }) {
  const relevant = focus === 'all' ? measures : measures.filter(m => m.key === focus);
  const findings = homes.map(home => {
    const strengths = [], gaps = [];
    for (const measure of relevant) {
      const values = homes.map(measure.value).filter(Number.isFinite);
      const value = measure.value(home);
      if (!Number.isFinite(value)) { gaps.push(measure.label.toLowerCase()); continue; }
      if (values.length < 2) continue;
      const best = measure.lower ? Math.min(...values) : Math.max(...values);
      if (value === best && new Set(values).size > 1) strengths.push(`${measure.label}${values.length < homes.length ? ' (among known values)' : ''}`);
    }
    return { home, strengths, gaps };
  });
  const first = homes[0], second = homes[1];
  const priceDiff = Number.isFinite(first?.price) && Number.isFinite(second?.price) ? second.price - first.price : null;
  const areaDiff = Number.isFinite(first?.floorAreaSqm) && Number.isFinite(second?.floorAreaSqm) ? second.floorAreaSqm - first.floorAreaSqm : null;
  const dates = [...new Set(homes.map(h => h.observedOn).filter(Boolean))];
  return <section className="comparison-brief" aria-label="Decision trade-offs">
    <div className="comparison-brief-heading"><div><h2>What changes the decision?</h2><p>Look at the trade-offs before choosing a favourite.</p></div><label>Focus on<select value={focus} onChange={e => onFocusChange(e.target.value)}><option value="all">All evidence</option>{measures.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label></div>
    <div className="comparison-advantages">{findings.map(({ home, strengths, gaps }) => <article key={home.id}><h3>{home.address}</h3>{Number.isFinite(home.price) && Number.isFinite(brief.budget) && brief.budget > 0 && <p className="comparison-budget">{money(Math.abs(home.price - brief.budget))} {home.price <= brief.budget ? 'below' : 'above'} your {brief.requirements?.budget === false ? 'budget target' : 'price ceiling'}</p>}<ul>{strengths.length ? strengths.map(s => <li key={s}>{s}</li>) : <li>No distinct advantage on the selected measures.</li>}</ul>{gaps.length > 0 && <p className="comparison-gap">Evidence missing: {gaps.join(', ')}.</p>}</article>)}</div>
    {second && <p className="comparison-pair-note">Compared with {first.address}, {second.address} has {priceDiff == null ? 'no comparable price evidence' : priceDiff === 0 ? 'the same recorded price' : `${money(Math.abs(priceDiff))} ${priceDiff > 0 ? 'higher' : 'lower'} recorded price`}{areaDiff == null ? '; floor-area evidence is incomplete' : areaDiff === 0 ? ' and the same recorded floor area' : ` and ${Math.abs(areaDiff)} m² ${areaDiff > 0 ? 'more' : 'less'} floor space`}.</p>}
    <p className="comparison-caution">{dates.length > 1 ? 'These transactions were recorded on different dates; price differences are not a like-for-like valuation. ' : 'Recorded prices are historical observations. '}Proximity is straight-line distance. Missing evidence stays unknown; condition, current availability and suitability need separate checks.</p>
  </section>;
}
