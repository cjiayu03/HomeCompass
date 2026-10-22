'use client';

import { useId, useState } from 'react';
import { scoreLabel } from '@/lib/utils';

const criterionLabels = {
  school: 'School',
  childcare: 'Childcare',
  care: 'Care access',
  affordability: 'Affordability',
};

function criterionLabel(name) {
  return criterionLabels[name] || String(name || 'Unknown criterion')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function componentHasMissingEvidence(component, missingEvidence) {
  return component?.evidenceStatus === 'missing'
    || (missingEvidence && missingEvidence.includes(component?.name))
    || !Number.isFinite(component?.normalizedValue)
    || !Number.isFinite(component?.contribution);
}

export function ScoreBreakdown({ score, scoreDetails, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const evidenceId = useId();
  const scoreText = Number.isFinite(score) ? `${score} / 100` : 'Insufficient evidence';
  const coverage = Number.isFinite(scoreDetails?.coverage)
    ? `${Math.round(scoreDetails.coverage * 100)}%`
    : 'unavailable';
  const policyVersion = typeof scoreDetails?.policyVersion === 'string' && scoreDetails.policyVersion.trim()
    ? scoreDetails.policyVersion
    : 'unavailable';
  const components = Array.isArray(scoreDetails?.components) ? scoreDetails.components : [];
  const missingEvidence = Array.isArray(scoreDetails?.missingEvidence) ? scoreDetails.missingEvidence : null;
  const missingEvidenceItems = missingEvidence === null
    ? null
    : [...new Set([
      ...missingEvidence,
      ...components
        .filter((component) => componentHasMissingEvidence(component, missingEvidence))
        .map((component) => component?.name),
    ])];

  return <section className={`rounded-xl border border-border/70 bg-background/35 p-3 ${className}`}>
    <button type="button" aria-expanded={expanded} aria-controls={evidenceId} onClick={() => setExpanded((current) => !current)} className="flex w-full cursor-pointer flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
      <span className="font-display text-lg font-semibold text-foreground">{scoreText}</span>
      {Number.isFinite(score) && <span className="text-xs font-medium text-primary">{scoreLabel(score)}</span>}
      <span className="text-xs text-muted-foreground">Coverage {coverage}</span>
      <span className="text-xs text-muted-foreground">Policy {policyVersion}</span>
      <span className="sr-only">{expanded ? 'Hide' : 'View'} score evidence</span>
    </button>
    <div id={evidenceId} hidden={!expanded} className="mt-3 border-t border-border/70 pt-3">
      <h4 className="text-xs font-semibold text-foreground">Score evidence</h4>
      {components.length > 0 ? <ul aria-label="Score components" className="mt-2 space-y-2">
        {components.map((component, index) => {
          const name = component?.name;
          const isMissing = componentHasMissingEvidence(component, missingEvidence);
          const contribution = isMissing
            ? 'No contribution · evidence missing'
            : `${component.contribution} points`;
          const normalized = !isMissing && Number.isFinite(component?.normalizedValue)
            ? `${component.normalizedValue} / 100`
            : 'Unavailable';
          const weight = Number.isFinite(component?.weight)
            ? component.weight
            : 'unavailable';

          return <li key={`${name || 'criterion'}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-muted/35 px-3 py-2 text-xs">
            <span className="font-medium text-foreground">{criterionLabel(name)}</span>
            <span className="text-muted-foreground">Normalized {normalized} · weight {weight}</span>
            <span className={isMissing ? 'text-muted-foreground' : 'font-semibold text-foreground'}>{contribution}</span>
          </li>;
        })}
      </ul> : <p className="mt-2 text-xs text-muted-foreground">Component evidence unavailable.</p>}
      <div className="mt-3">
        <h5 className="text-xs font-semibold text-foreground">Missing evidence</h5>
        {missingEvidenceItems === null
          ? <p className="mt-1 text-xs text-muted-foreground">Missing evidence unavailable.</p>
          : missingEvidenceItems.length > 0
            ? <ul aria-label="Missing evidence" className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {missingEvidenceItems.map((item, index) => <li key={`${item}-${index}`}>{criterionLabel(item)}</li>)}
            </ul>
            : <p className="mt-1 text-xs text-muted-foreground">No missing evidence reported.</p>}
      </div>
    </div>
  </section>;
}
