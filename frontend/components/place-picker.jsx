'use client';

import { useWorkspace } from '@/components/workspace-provider';
import { Alert } from '@/components/ui/alert';

function formatDistance(distance) {
  if (distance == null || distance === '' || !Number.isFinite(Number(distance))) return 'Unavailable';
  const metres = Number(distance);
  return metres >= 1000 ? `${Number((metres / 1000).toFixed(1))} km` : `${Math.round(metres)} m`;
}

function selectedDistance(constraints, id, fallback) {
  const constraint = constraints.find((item) => item.placeId === id);
  return constraint ? Number(constraint.maxDistanceM) : Number(fallback || 5000);
}

export function PlaceDistanceList({ distances = [] }) {
  if (!Array.isArray(distances) || distances.length === 0) return null;

  return <section aria-label="Saved place distances" className="rounded-xl border border-border/70 bg-background/55 p-3">
    <h4 className="mb-2 text-xs font-semibold">Saved place distances</h4>
    <ul className="space-y-2">
      {distances.map((distance) => {
        const hasStraightLineMethod = distance.method === 'straight-line';
        return <li key={distance.placeId} className="flex items-start justify-between gap-3 text-xs">
          <div className="min-w-0">
            <p className="font-medium">{distance.label || 'Saved place'}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {hasStraightLineMethod ? 'Straight-line distance estimate' : 'Distance method unavailable'}
              {distance.maximumDistanceM != null && ` · maximum ${formatDistance(distance.maximumDistanceM)}`}
            </p>
          </div>
          <span className="shrink-0 font-semibold">{hasStraightLineMethod ? formatDistance(distance.distanceM) : 'Unavailable'}</span>
        </li>;
      })}
    </ul>
  </section>;
}

export function PlacePicker() {
  const { places, placeState, brief, setBrief } = useWorkspace();
  const constraints = Array.isArray(brief.placeConstraints) ? brief.placeConstraints : [];

  function updateConstraint(place, { selected, maxDistanceM }) {
    setBrief((current) => {
      const currentConstraints = Array.isArray(current.placeConstraints) ? current.placeConstraints : [];
      let nextConstraints = currentConstraints.filter((constraint) => constraint.placeId !== place.id);
      if (selected) {
        nextConstraints = [...nextConstraints, {
          placeId: place.id,
          maxDistanceM: maxDistanceM == null
            ? selectedDistance(currentConstraints, place.id, place.maximumDistanceM)
            : Number(maxDistanceM),
        }];
      }
      const primaryPlace = nextConstraints.length
        ? places.find((savedPlace) => savedPlace.id === nextConstraints[0].placeId)
        : null;
      return {
        ...current,
        placeConstraints: nextConstraints,
        ...(primaryPlace ? { pinLabel: primaryPlace.label, pinLocation: primaryPlace.address || primaryPlace.label } : {}),
      };
    });
  }

  return <section aria-label="Saved place filters" className="space-y-3 rounded-xl border border-border/70 bg-background/25 p-4">
    <div>
      <h3 className="text-sm font-semibold">Saved places for this search</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Select account places and set an estimated straight-line distance limit. These saved locations provide the coordinates for place filters.</p>
    </div>
    {placeState.status === 'signed_out' && <Alert tone="info">Sign in to use account places in a search.</Alert>}
    {placeState.status === 'loading' && <p className="text-xs text-muted-foreground">Loading saved places…</p>}
    {placeState.status === 'error' && <Alert tone="warning">{placeState.error?.message || 'Saved places could not be loaded.'}</Alert>}
    {placeState.status === 'empty' && <p className="text-xs text-muted-foreground">No saved account places yet. Add one from Account.</p>}
    {places.map((place) => {
      const checked = constraints.some((constraint) => constraint.placeId === place.id);
      const distance = selectedDistance(constraints, place.id, place.maximumDistanceM);
      return <div key={place.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" aria-label={`Use ${place.label} in this search`} checked={checked} onChange={(event) => updateConstraint(place, {
            selected: event.target.checked,
            maxDistanceM: selectedDistance(constraints, place.id, place.maximumDistanceM),
          })} className="mt-1 accent-[hsl(var(--primary))]" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{place.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{place.address || 'Address unavailable'}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">Provider: {place.geocodeSource || 'Unknown'} · straight-line distance estimate</span>
          </span>
        </label>
        {checked && <label className="mt-3 flex flex-col gap-1.5 pl-7 text-[11px] font-semibold text-muted-foreground">{place.label} maximum straight-line distance in metres
          <input aria-label={`${place.label} maximum straight-line distance in metres`} type="number" min="0" max="100000" step="1" value={distance} onChange={(event) => updateConstraint(place, { selected: true, maxDistanceM: event.target.value })} className="h-9 rounded-lg border bg-background px-3 text-sm font-normal text-foreground" />
        </label>}
      </div>;
    })}
  </section>;
}

export default PlacePicker;
