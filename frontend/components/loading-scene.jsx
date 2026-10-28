export function LoadingScene({ label = 'Getting things ready…', detail, compact = false, announce = true }) {
  return <span role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined} className={`loading-scene ${compact ? 'loading-scene-compact' : 'loading-scene-full'}`}>
    <svg viewBox="0 0 96 96" aria-hidden="true" focusable="false" className="loading-compass">
      <circle cx="48" cy="48" r="39" fill="none" stroke="currentColor" strokeWidth="1" opacity=".15" />
      <circle className="loading-compass-orbit" cx="48" cy="48" r="39" pathLength="100" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="24 76" strokeLinecap="round" />
      <circle className="loading-compass-orbit loading-compass-counter" cx="48" cy="48" r="32" pathLength="100" fill="none" stroke="var(--friendly-sun)" strokeWidth="4" strokeDasharray="16 84" strokeLinecap="round" />
      <path d="M48 22v5m26 21h-5M48 74v-5M22 48h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
      <path className="loading-compass-route" d="M26 64c14 0 10-31 22-31s7 30 23 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 6" opacity=".4" />
      <g className="loading-compass-needle"><path d="m48 29 10 29-10-6-10 6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="m48 52 10 6-10 9-10-9Z" fill="var(--friendly-sky)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></g>
      <circle cx="48" cy="48" r="3" fill="var(--friendly-sun)" />
    </svg>
    <span className="loading-copy"><span className="font-medium">{label}</span>{detail && <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>}</span>
    <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>
  </span>;
}
