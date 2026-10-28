'use client';

import Link from 'next/link';
import { ComparisonView } from '@/components/comparison-view';
import { useWorkspace } from '@/components/workspace-provider';
import { usePlanning } from '@/components/planning-provider';
import { Button } from '@/components/ui/button';

export default function ComparePage() {
  const { selectedHomes, compareIds, shortlistHomes, toggleCompare, appliedBrief, brief } = useWorkspace();
  const { decisions, photos } = usePlanning();
  return <div className="container max-w-[1400px] space-y-6 px-4 py-7 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-3xl font-semibold">Compare candidates</h1><p className="mt-2 text-sm text-muted-foreground">Discuss recorded prices, evidence and the checks still to make.</p></div><Button asChild variant="outline"><Link href="/explore">Back to Explore</Link></Button></header>
    <ComparisonView homes={selectedHomes} onRemove={toggleCompare} availableHomes={shortlistHomes.filter(home => !compareIds.includes(home.id))} onAdd={toggleCompare} brief={appliedBrief || brief} decisions={decisions} photos={photos} />
  </div>;
}
