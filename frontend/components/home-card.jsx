'use client';

import { ArrowUpRight, Baby, Bookmark, Check, CircleHelp, HeartPulse, MapPin, Scale } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { money, scoreLabel } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MagicCard } from '@/components/ui/magic-card';
import { NumberTicker } from '@/components/ui/number-ticker';

function AccessTile({ icon: Icon, label, value }) {
  return <div className="rounded-xl border border-white/45 bg-white/35 p-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.035]">
    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Icon className="size-3.5 text-primary" />{label}</div>
    <p className="text-xs font-medium leading-5 text-foreground">{value}</p>
  </div>;
}

export function HomeCard({ home, saved, selected, onSave, onCompare, onInspect, compact = false, entranceDelay = 0 }) {
  const reduceMotion = useReducedMotion();
  return <motion.div
    layout={!reduceMotion}
    initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.975, filter: 'blur(8px)' }}
    animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
    whileHover={reduceMotion ? undefined : { y: -7, scale: 1.012 }}
    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
    transition={{ type: 'spring', stiffness: 360, damping: 25, mass: 0.7, delay: entranceDelay }}
    className="group"
  >
    <MagicCard
      className="magic-card-frame h-full rounded-2xl"
      gradientSize={260}
      gradientFrom={selected ? '#3f664b' : '#e2e9e3'}
      gradientTo={selected ? '#5d7f63' : '#829385'}
      gradientColor={selected ? 'rgba(63, 102, 75, 0.16)' : 'rgba(108, 132, 111, 0.13)'}
      borderColor={selected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
      gradientOpacity={reduceMotion ? 0 : 0.22}
    >
      <article className="relative z-40 overflow-hidden rounded-[inherit] p-4 sm:p-5" aria-label={`${home.address}, ${home.type}, ${money(home.price)} recorded price`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{home.town}</Badge><span className="rounded-md border border-border/70 bg-background/35 px-2 py-1">{home.type}</span></div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">{home.address}</h3>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-display text-2xl font-semibold tracking-tight text-foreground">{money(home.price)}</span><span className="text-[11px] text-muted-foreground">{home.sourceSemantics === 'historical_transaction' ? 'historical transaction' : 'illustrative sample value'}</span></div>
          </div>
          <div className="glass-card grid size-[4.5rem] shrink-0 place-items-center rounded-2xl border border-white/70 text-center dark:border-white/10">
            <div>{home.score !== null && home.score !== undefined && Number.isFinite(Number(home.score)) ? <NumberTicker value={home.score} className="font-display text-xl font-semibold leading-none text-foreground" /> : <span className="font-display text-xl font-semibold leading-none text-foreground">—</span>}<span className="mt-1 block text-[9px] font-medium text-muted-foreground">{scoreLabel(home.score)}</span></div>
          </div>
        </div>

        {!compact && <div className="mt-4"><div className="mb-2 flex items-center justify-between text-[10px] font-medium text-muted-foreground"><span>Household access</span><span>{home.distance || 'Distance unavailable'} to a key amenity</span></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <AccessTile icon={MapPin} label="School" value={home.school || 'Location match pending'} />
          <AccessTile icon={Baby} label="Childcare" value={home.childcare || 'Location match pending'} />
          <AccessTile icon={HeartPulse} label="Care" value={home.care || 'Location match pending'} />
        </div></div>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><Badge variant="outline" className="max-w-full">{home.risk}</Badge>{!compact && <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><CircleHelp className="size-3.5 shrink-0" />{home.source} · {home.sourceUpdated}</span>}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="icon" variant={saved ? 'soft' : 'ghost'} aria-label={saved ? `Remove ${home.address} from shortlist` : `Save ${home.address} to shortlist`} aria-pressed={saved} onClick={() => onSave(home)}>{saved ? <Bookmark className="size-4 fill-current" /> : <Bookmark className="size-4" />}</Button>
            {!compact && <><Button size="sm" variant="ghost" onClick={() => onInspect(home)}>Details <ArrowUpRight className="size-3.5" /></Button><Button size="sm" variant={selected ? 'soft' : 'outline'} onClick={() => onCompare(home)} aria-pressed={selected}>{selected ? <Check className="size-3.5" /> : <Scale className="size-3.5" />}{selected ? 'Selected' : 'Compare'}</Button></>}
          </div>
        </div>
      </article>
    </MagicCard>
  </motion.div>;
}
