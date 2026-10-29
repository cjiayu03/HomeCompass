'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// One fixed panel owns the search controls and the currently selected content.
export function MapResearchSidebar({ open, onOpenChange, toolbar, children }) {
  return <Collapsible.Root open={open} onOpenChange={onOpenChange} className="map-research-sidebar">
    <Collapsible.Content forceMount inert={!open} className="map-research-content" aria-label="Housing search sidebar" role="region">
      {toolbar}
      <div className="map-research-records">{children}</div>
    </Collapsible.Content>
    <Collapsible.Trigger asChild>
      <Button variant="outline" className="map-sidebar-toggle" aria-label={open ? 'Collapse search sidebar' : 'Open search sidebar'} title={open ? 'Collapse search sidebar' : 'Open search sidebar'}>
        {open ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span className="sr-only">{open ? 'Show entire map' : 'Search and results'}</span>
      </Button>
    </Collapsible.Trigger>
  </Collapsible.Root>;
}
