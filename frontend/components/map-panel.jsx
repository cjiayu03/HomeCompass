'use client';

import dynamic from 'next/dynamic';
import { Crosshair, ExternalLink, LocateFixed, Layers3 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const MapView = dynamic(() => import('@/components/map-view'), { ssr: false, loading: () => <div className="grid h-full min-h-[420px] place-items-center bg-secondary text-sm text-muted-foreground">Loading live map…</div> });

const mapLayers = [
  ['silver_zone', 'Silver Zones', '#68886c'], ['dementia_gtp', 'Dementia-friendly points', '#697d91'],
  ['chas_clinic', 'CHAS clinics', '#7887a2'], ['childcare', 'Child care', '#8a7898'], ['student_care', 'Student care', '#6e8b7c'],
  ['kindergarten', 'Kindergartens', '#627f90'], ['school_zone', 'School zones', '#8291a6'], ['dengue_cluster', 'Active dengue clusters', '#b65360'],
];

export function MapPanel({ homes, resources = [], sourceStatus, selectedHome, onSelect, className }) {
  const [centerRequest, setCenterRequest] = useState(0);
  const [visibleResourceTypes, setVisibleResourceTypes] = useState(['silver_zone', 'dengue_cluster']);
  const mappedCount = homes.filter((home) => home.lat !== null && home.lat !== undefined && home.lng !== null && home.lng !== undefined && Number.isFinite(Number(home.lat)) && Number.isFinite(Number(home.lng))).length;
  const visibleFeatureCount = resources.filter((feature) => visibleResourceTypes.includes(feature.properties?.resourceType)).length;
  const counts = resources.reduce((result, feature) => { const type = feature.properties?.resourceType; result[type] = (result[type] || 0) + 1; return result; }, {});
  function toggleLayer(type, checked) { setVisibleResourceTypes((current) => checked ? [...new Set([...current, type])] : current.filter((item) => item !== type)); }
  return (
    <section className={cn('relative isolate z-0 min-h-[440px] overflow-hidden rounded-xl border bg-secondary shadow-soft lg:h-full lg:min-h-0', className)} aria-label="Movable OpenStreetMap view">
      <MapView homes={homes} resources={resources} visibleResourceTypes={visibleResourceTypes} selectedHome={selectedHome} onSelect={onSelect} centerRequest={centerRequest} />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3">
        <div className="glass-card pointer-events-auto rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className="size-2 rounded-full bg-primary" />OpenStreetMap</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Drag to browse · select a source marker for details</p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          <details className="glass-card relative rounded-lg px-3 py-2 text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold"><Layers3 className="size-3.5 text-primary" />Layers <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px]">{visibleResourceTypes.length}</span></summary>
            <div className="absolute right-0 top-11 z-[80] w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-float">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">Map layers</p>
                <div className="flex gap-2">
                  <button className="text-[10px] text-primary hover:underline" onClick={() => setVisibleResourceTypes(mapLayers.filter(([type]) => counts[type]).map(([type]) => type))}>All</button>
                  <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => setVisibleResourceTypes([])}>Clear</button>
                </div>
              </div>
              <div className="space-y-1">
                {mapLayers.map(([type, label, color]) => (
                  <label key={type} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/70">
                    <input type="checkbox" className="size-3.5 accent-primary" checked={visibleResourceTypes.includes(type)} disabled={!counts[type]} onChange={(event) => toggleLayer(type, event.target.checked)} />
                    <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="text-[10px] text-muted-foreground">{(counts[type] || 0).toLocaleString()}</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 border-t pt-2 text-[10px] leading-4 text-muted-foreground">Distances use located points in the current snapshots; route times are not provided.</p>
            </div>
          </details>
          <Button size="icon" variant="outline" aria-label="Center map on Singapore" onClick={() => setCenterRequest((value) => value + 1)}><LocateFixed className="size-4" /></Button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-3">
        <div className="glass-card pointer-events-auto rounded-lg px-3 py-2 text-[11px] text-muted-foreground">
          <div className="mb-1 flex items-center gap-2 font-semibold text-foreground"><span className="size-2 rounded-full bg-primary" />Home <span className="size-2 rounded-full bg-accent-foreground" />Selected <span className="size-2 rounded-full bg-[#7887a2]" />Services <span className="size-2 rounded-full bg-[#b65360]" />Dengue</div>
          <p>© OpenStreetMap contributors</p>
        </div>
        <div className="glass-card pointer-events-auto flex flex-col items-end gap-1 rounded-lg px-3 py-2 text-[11px] font-medium">
          <span className="flex items-center gap-2"><Crosshair className="size-3.5 text-primary" />{mappedCount} mapped / {homes.length} homes <a className="text-primary hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" aria-label="OpenStreetMap attribution"><ExternalLink className="inline size-3" /></a></span>
          <span className="text-muted-foreground">{visibleFeatureCount} visible / {resources.length} mapped features · {sourceStatus?.imported ?? 0}/{sourceStatus?.registered ?? 0} snapshots</span>
        </div>
      </div>
    </section>
  );
}
