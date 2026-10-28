'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDownRight, ArrowRight, HeartPulse, MapPin, Moon, Sun, UsersRound } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { APP_NAME, homes } from '@/lib/data';
import { useAppTheme } from '@/components/theme-provider';
import { MapPanel } from '@/components/map-panel';
import { BlurFade } from '@/components/ui/blur-fade';
import { MagicCard } from '@/components/ui/magic-card';
import { Button } from '@/components/ui/button';
import { NumberTicker } from '@/components/ui/number-ticker';

const features = [
  { icon: UsersRound, step: '01', title: 'Start with your household', description: 'Set the needs and budget that shape a move for everyone at home.' },
  { icon: MapPin, step: '02', title: 'Explore places on the map', description: 'See candidate homes alongside nearby schools, childcare and care access.' },
  { icon: HeartPulse, step: '03', title: 'Compare the trade-offs', description: 'Keep dated source details together as you decide what matters most.' },
];

function FeatureCard({ icon: Icon, step, title, description, reduceMotion }) {
  return <BlurFade direction="up" offset={reduceMotion ? 0 : 18} duration={0.62} inView>
    <MagicCard className="magic-card-frame h-full rounded-2xl" gradientSize={230} gradientColor="rgba(108, 132, 111, 0.13)" gradientOpacity={0.16} gradientFrom="#e2e9e3" gradientTo="#829385">
      <div className="relative z-40 flex h-full min-h-52 flex-col p-5 sm:p-6">
        <div className="mb-8 flex items-center justify-between"><span className="glass-card grid size-10 place-items-center rounded-xl text-primary"><Icon className="size-4" /></span><span className="text-xs font-medium tracking-[0.14em] text-muted-foreground">{step}</span></div>
        <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </MagicCard>
  </BlurFade>;
}

export function LandingPage() {
  const [selectedHome, setSelectedHome] = useState(homes[0]);
  const { theme, setTheme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const isDark = theme === 'dark';

  return <div className="landing-canvas min-h-screen overflow-hidden bg-background text-foreground">
    <header className="relative z-20 border-b border-border/70 bg-background/45 backdrop-blur-2xl">
      <div className="container flex h-[4.5rem] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={`${APP_NAME} home`}>
          <span className="grid size-9 place-items-center rounded-xl border border-primary/35 bg-primary/[0.07] text-primary"><MapPin className="size-4" /></span>
          <span className="font-display text-sm font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex" aria-label="Landing page navigation">
          <Link href="/explore" className="transition-colors hover:text-foreground">Explore</Link>
          <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="icon" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Sign in</Link></Button>
          <Button asChild size="sm"><Link href="/signup">Get started <ArrowRight className="size-3.5" /></Link></Button>
        </div>
      </div>
    </header>

    <main>
      <section className="container grid max-w-[1440px] items-center gap-10 px-5 pb-16 pt-9 sm:px-8 sm:pt-12 lg:min-h-[calc(100dvh-4.5rem)] lg:grid-cols-[minmax(320px,0.78fr)_minmax(540px,1.22fr)] lg:gap-12 lg:py-12">
        <div className="relative z-10 max-w-2xl">
          <BlurFade direction="up" offset={reduceMotion ? 0 : 26} duration={0.72}>
            <p className="mb-5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.19em] text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />A home search shaped around real life</p>
            <h1 className="font-display text-[clamp(3.25rem,6.2vw,6.2rem)] font-medium leading-[0.97] tracking-[-0.065em]">Find a place that fits <span className="text-primary">everyone.</span></h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">Explore Singapore homes through the details families live with every day: budget, school access, childcare and nearby care.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg"><Link href="/explore">Explore homes <ArrowRight className="size-4" /></Link></Button>
              <a href="#how-it-works" className="group inline-flex h-12 items-center gap-2 rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground">How it works <ArrowDownRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" /></a>
            </div>
          </BlurFade>

          <BlurFade direction="up" delay={0.14} offset={reduceMotion ? 0 : 18} duration={0.65}>
            <div className="mt-10 grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-[0.82fr_1.18fr]">
              <div className="glass-card flex flex-col justify-between rounded-2xl p-4 sm:p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Preview set</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <NumberTicker value={homes.length} className="font-display text-4xl font-semibold tracking-tight" />
                  <span className="text-sm font-medium">homes</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Illustrative data · not live listings</p>
              </div>
              <div className="glass-card rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Household priorities</p>
                    <p className="mt-2 text-sm font-semibold">Whole household in view</p>
                  </div>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true"><UsersRound className="size-4" /></span>
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-2.5 gap-y-1 border-t border-border/70 pt-2 text-[10px] font-medium leading-4 text-muted-foreground sm:text-[11px]">
                  <li className="whitespace-nowrap">Children</li>
                  <li className="whitespace-nowrap">Older adults</li>
                  <li className="whitespace-nowrap">Daily routines</li>
                </ul>
              </div>
            </div>
          </BlurFade>
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 32, scale: 0.975 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-w-0"
        >
          <div className="pointer-events-none absolute -inset-5 rounded-[2.5rem] bg-primary/[0.08] blur-3xl dark:bg-primary/[0.11]" />
          <MagicCard className="magic-card-frame relative rounded-[1.75rem]" gradientSize={340} gradientColor="rgba(108, 132, 111, 0.1)" gradientOpacity={0.12} gradientFrom="#e6ece6" gradientTo="#829385">
            <div className="relative z-40 p-2.5 sm:p-3">
              <div className="glass-card mb-2 flex items-center justify-between gap-4 rounded-xl px-4 py-3 sm:px-5">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Singapore · illustrative map pins</p><p className="mt-1 text-sm font-semibold">Explore neighbourhoods</p></div>
                <Link href="/explore" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">Open map <ArrowRight className="size-3.5" /></Link>
              </div>
              <MapPanel homes={homes} selectedHome={selectedHome} onSelect={setSelectedHome} className="h-[450px] rounded-xl sm:h-[500px] lg:h-[500px]" />
            </div>
          </MagicCard>
          <div className="glass-card absolute -bottom-5 left-4 z-10 flex items-center gap-3 rounded-xl px-4 py-3 shadow-float sm:-left-5 sm:bottom-9">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><MapPin className="size-4" /></span>
            <div><p className="text-xs font-semibold">Move the map. Open a marker.</p><p className="mt-0.5 text-[10px] text-muted-foreground">Pan and zoom the live map to explore.</p></div>
          </div>
        </motion.div>
      </section>

      <section id="how-it-works" className="container max-w-[1440px] scroll-mt-12 px-5 pb-20 pt-12 sm:px-8 sm:pb-28">
        <BlurFade direction="up" offset={reduceMotion ? 0 : 18} duration={0.62}>
          <div className="mb-7 flex flex-col justify-between gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-end">
            <div><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">A clear way through the search</p><h2 className="font-display text-3xl font-medium tracking-[-0.045em] sm:text-4xl">Start with what matters at home.</h2></div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">A map first, source details close by, and space to compare the trade-offs as a family.</p>
          </div>
        </BlurFade>
        <div className="grid gap-4 md:grid-cols-3">{features.map((feature) => <FeatureCard key={feature.step} {...feature} reduceMotion={reduceMotion} />)}</div>
        <div className="mt-10 flex flex-col justify-between gap-5 rounded-2xl border border-white/50 bg-white/25 px-5 py-5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.025] sm:flex-row sm:items-center sm:px-7">
          <div><h3 className="font-display text-xl font-semibold tracking-tight">Ready to look around?</h3><p className="mt-1 text-sm text-muted-foreground">Browse the map, then save places for a closer look.</p></div>
          <Button asChild><Link href="/explore">Go to Explore <ArrowRight className="size-4" /></Link></Button>
        </div>
      </section>
    </main>

    <footer className="border-t border-border/60 px-5 py-5 text-center text-xs text-muted-foreground">This preview uses illustrative records and pins. Government records will be labeled as dated historical evidence, not live listing availability.</footer>
  </div>;
}
