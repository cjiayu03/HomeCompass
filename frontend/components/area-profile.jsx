'use client';

import { cohortProfile } from '@/components/evidence-helpers';
import { money } from '@/lib/utils';

export function AreaProfile({ homes = [], home, town }) {
  const profile = cohortProfile(homes, { home, town });
  return <section aria-label="Loaded area transaction profile" className="space-y-3 rounded-xl border p-4">
    <div><h3 className="font-display text-lg font-semibold">{profile.town || 'Loaded area'} research profile</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{profile.count} loaded historical {profile.count === 1 ? 'transaction' : 'transactions'} across {profile.blocks.length} recorded addresses. This is the loaded search cohort; it does not represent the whole market or available homes.</p></div>
    {profile.count > 0 ? <><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Median of {profile.pricedCount} priced records</dt><dd className="mt-1 font-semibold">{profile.median == null ? 'Unavailable' : money(profile.median)}</dd></div><div><dt className="text-xs text-muted-foreground">Recorded dates in this cohort</dt><dd className="mt-1">{profile.start ? `${profile.start} to ${profile.end}` : 'Unavailable'}</dd></div></dl><details><summary className="min-h-11 cursor-pointer text-sm font-medium">Addresses in the loaded cohort</summary><ul className="space-y-2 text-sm">{profile.blocks.map(([address, count]) => <li key={address} className="flex justify-between gap-3"><span>{address}</span><span>{count} {count === 1 ? 'record' : 'records'}</span></li>)}</ul></details></> : <p className="text-sm text-muted-foreground">No historical records loaded for this area. Illustrative records are excluded.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Different flat types, floor areas, storeys and remaining leases can affect recorded prices. This cohort is not a valuation, building condition survey or availability check.</p>
  </section>;
}
