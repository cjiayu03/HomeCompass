import { describe, expect, it } from 'vitest';
import { preferenceEntries, standaloneHtml, visitDateLabel } from '../components/decision-summary';

it('keeps rules for budget, towns, flat type, access and advanced criteria in exports', () => {
  const entries = preferenceEntries({ budget: 500000, preferredTowns: ['Bedok'], preferredFlatType: '4 ROOM', schoolDistance: 1000, minLease: 50, requirements: { budget: false, towns: true, flatType: false, schoolDistance: false, minLease: true } });
  expect(entries.map(([key]) => key)).toEqual(['Budget (preference)', 'Towns (must-have)', 'Flat type (preference)', 'Minimum estimated lease (must-have)', 'School straight-line target (preference)']);
});
it('treats viewing wall-clock times as Singapore time', () => {
  expect(visitDateLabel('2026-10-28T09:30')).toBe(visitDateLabel('2026-10-28T01:30:00Z'));
  expect(visitDateLabel('2026-10-28T09:30')).toContain('SGT (Asia/Singapore)');
});
it('exports missing checks, distance context, score components and photo choice safely', () => {
  const home = { id: '1', address: '<script>home</script>', scoreDetails: { coverage: 0.5, components: [{ name: 'school', normalizedValue: 80, contribution: 40, weight: 1 }], missingEvidence: ['care'] }, placeDistances: [{ label: 'Grandparents', method: 'straight-line', distanceM: 750, maximumDistanceM: 1000 }] };
  const decisions = { 1: { checklist: { daylight: true, 'custom-检查': false, 'custom-uuid': false }, checklistLabels: { 'custom-uuid': '噪音和通风' }, notes: '<img onerror=alert(1)>' } };
  const photos = { 1: [{ name: 'viewing.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }, { name: 'unsafe', dataUrl: 'javascript:alert(1)' }] };
  const html = standaloneHtml([home], {}, decisions, photos);
  expect(html).toContain('To check: 检查');
  expect(html).toContain('To check: 噪音和通风');
  expect(html).toContain('750 m straight-line estimate · target maximum 1000 m');
  expect(html).toContain('Evidence coverage'); expect(html).toContain('50%'); expect(html).toContain('40 points');
  expect(html).toContain('&lt;script&gt;home&lt;/script&gt;');
  expect(html).not.toContain('data:image/jpeg');
  expect(standaloneHtml([home], {}, decisions, photos, true)).toContain('data:image/jpeg;base64,AAAA');
  expect(standaloneHtml([home], {}, decisions, photos, true)).not.toContain('javascript:');
});
