function countPhrase(value, singular, plural) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return `${value} ${Number(value) === 1 ? singular : plural}`;
}

export function summarizeHouseholdAges(brief = {}) {
  return [
    countPhrase(brief.adults, 'adult aged 18–59', 'adults aged 18–59'),
    countPhrase(brief.children, 'child aged 0–17', 'children aged 0–17'),
    countPhrase(brief.olderAdults, 'person aged 60+', 'people aged 60+'),
  ].filter(Boolean).join(' · ');
}
