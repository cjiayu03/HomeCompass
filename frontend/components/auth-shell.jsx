'use client';

import Link from 'next/link';
import { ArrowLeft, MapPin, Moon, Sun } from 'lucide-react';
import { APP_NAME } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { useAppTheme } from '@/components/theme-provider';

export function AuthShell({ children }) {
  const { theme, setTheme } = useAppTheme();
  const isDark = theme === 'dark';
  return <div className="auth-canvas min-h-screen bg-background text-foreground">
    <header className="relative z-10 border-b border-border/70 bg-background/45 backdrop-blur-2xl">
      <div className="container flex h-16 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
          <span className="grid size-9 place-items-center rounded-xl border border-primary/35 bg-primary/[0.07] text-primary"><MapPin className="size-4" /></span>
          <span className="font-display text-sm font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/explore" className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground sm:text-sm">Explore without signing in</Link>
          <Button variant="ghost" size="icon" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
        </div>
      </div>
    </header>

    <main className="container flex min-h-[calc(100dvh-4rem)] max-w-2xl items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
      <section className="mx-auto w-full max-w-md">
        {children}
        <Link href="/" className="mx-auto mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-3.5" />Back to home</Link>
      </section>
    </main>
  </div>;
}
