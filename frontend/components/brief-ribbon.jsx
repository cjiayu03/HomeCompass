import { MapPin, SlidersHorizontal } from 'lucide-react';
import { money } from '@/lib/utils';
import { summarizeHouseholdAges } from '@/lib/household';
import { Button } from '@/components/ui/button';

export function BriefRibbon({ brief, onEdit }) {
  const towns = Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [];
  return <div className="glass-card flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5" aria-label="Current filters"><div className="mr-1 flex items-center gap-2 text-xs font-semibold text-foreground"><SlidersHorizontal className="size-4 text-primary" />Current filters</div><span className="text-xs text-muted-foreground">{summarizeHouseholdAges(brief)}</span><span className="text-muted-foreground">·</span><span className="text-xs font-medium text-foreground">Budget {money(brief.budget)}</span>{towns.length > 0 && <span className="text-xs text-muted-foreground">· {towns.join(', ')}</span>}{brief.preferredFlatType && <span className="text-xs text-muted-foreground">· {brief.preferredFlatType}</span>}<span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3 text-primary" />{brief.pinLabel || 'Place'}: {brief.pinLocation || 'not set'}</span>{onEdit && <Button type="button" variant="link" size="sm" className="ml-auto h-auto px-1 py-0 text-xs" onClick={onEdit}>Filter</Button>}</div>;
}
