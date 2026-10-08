'use client';

import { useWorkspace } from '@/components/workspace-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, Database, MapPin, RefreshCw } from 'lucide-react';

const labels = {
  hdb_resale: 'HDB resale transactions', hdb_building: 'HDB building footprints', hdb_property: 'HDB property information',
  silver_zone: 'LTA Silver Zones', dementia_gtp: 'Dementia-friendly points', chas_clinic: 'CHAS clinics', moe_school: 'MOE school directory',
  school_zone: 'LTA school zones', childcare: 'Child Care Services', kindergarten: 'Kindergartens', childcare_registry: 'ECDA centre directory',
  childcare_fees: 'ECDA centre services and fees', childcare_charges: 'ECDA incidental charges', student_care: 'Student Care Services',
  dengue_cluster: 'NEA active dengue clusters', geocoding_and_routing: 'OneMap geocoding and routing',
};

function stateLabel(state) {
  return ({ valid: 'Imported', degraded: 'Imported with rejected rows', not_imported: 'Awaiting first import', needs_credentials: 'Needs OneMap access', configured: 'Configured' })[state] || state;
}

function dateLabel(value) {
  if (!value) return 'Not reported by source';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export default function SourcesPage() {
  const { sourceStatus } = useWorkspace();
  const sources = sourceStatus?.items || [];
  const imported = sources.filter((source) => ['valid', 'degraded'].includes(source.state)).length;

  return <div className="container flex max-w-[1320px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Database className="size-3.5 text-primary" />Verified source register</div><h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Data, with its limits visible.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Official data is imported as dated snapshots. This page separates available files from data that has actually been fetched into the local database.</p></div>
      <Badge variant="secondary" className="w-fit">{imported} / {sourceStatus?.registered ?? (sources.length || '—')} imported</Badge>
    </div>

    <Alert><div className="flex gap-3"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Why some access distances may still be blank</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The source CSVs contain addresses rather than coordinates; verified OneMap points are attached in a separate step. A distance appears only when the corresponding current amenity snapshot also has a located record. Distances are straight-line estimates, not travel times or routes.</p></div></div></Alert>

    {!sources.length ? <Card><CardContent className="p-6"><p className="font-semibold">Source status has not loaded</p><p className="mt-1 text-sm text-muted-foreground">Start the local backend and database, then reload this page. The source register is served by the backend.</p><Button className="mt-4" variant="outline" onClick={() => window.location.reload()}><RefreshCw className="size-4" />Reload source status</Button></CardContent></Card> : <div className="grid gap-3 md:grid-cols-2">
      {sources.map((source) => <Card key={source.sourceId} className="overflow-hidden"><CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-display text-base font-semibold">{labels[source.resourceType] || source.resourceType}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{source.sourceId}</p></div><Badge variant={source.state === 'valid' ? 'secondary' : source.state === 'degraded' ? 'outline' : 'outline'} className="shrink-0">{stateLabel(source.state)}</Badge></div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Records</p><p className="mt-1 font-semibold">{source.rows?.toLocaleString?.() ?? '—'}{source.rejected ? <span className="font-normal text-muted-foreground"> · {source.rejected} rejected</span> : null}</p></div><div><p className="text-muted-foreground">Source updated</p><p className="mt-1 font-semibold">{dateLabel(source.sourceUpdatedAt || source.version)}</p></div><div className="col-span-2"><p className="text-muted-foreground">Retrieved locally</p><p className="mt-1 font-semibold">{dateLabel(source.retrievedAt)}</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t pt-3"><span className="text-[11px] text-muted-foreground">{source.state === 'valid' || source.state === 'degraded' ? 'Snapshot stored in the database' : source.resourceType === 'geocoding_and_routing' ? 'Not a data.gov.sg dataset' : 'Registered; not yet fetched'}</span>{source.url && <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Official source <ArrowUpRight className="size-3.5" /></a>}</div>
      </CardContent></Card>)}
    </div>}
  </div>;
}
