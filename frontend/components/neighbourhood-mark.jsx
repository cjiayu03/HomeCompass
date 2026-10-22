// A decorative neighbourhood sketch, not a photograph or a listing preview.
export function NeighbourhoodMark() {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 76 56" className="neighbourhood-mark h-12 w-16 shrink-0">
    <circle cx="59" cy="13" r="8" fill="var(--friendly-sun)" />
    <path d="M5 49c17-8 40-8 65 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3" />
    <path d="M13 27 31 12l18 15v21H13Z" fill="var(--friendly-leaf)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="m9 28 22-18 22 18M27 48V34h9v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="19" y="28" width="7" height="7" rx="1.5" fill="var(--friendly-sky)" stroke="currentColor" strokeWidth="1.5" />
    <path d="M61 47V31" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M51 32c-5-8 2-17 9-14 6-5 14 3 11 9 5 8-7 14-11 9-4 3-9 1-9-4Z" fill="var(--friendly-leaf)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}
