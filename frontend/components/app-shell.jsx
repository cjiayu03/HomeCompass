'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, Database, LogOut, MapPinned, Menu, Moon, Settings2, Sun, X } from 'lucide-react';
import { APP_NAME } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { useAppTheme } from '@/components/theme-provider';
import { useAuth } from '@/components/auth-provider';

export function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useAppTheme();
  const { shortlistIds, notice, setNotice, flash } = useWorkspace();
  const { user, signOut } = useAuth();
  const [savedActive, setSavedActive] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    const read = () => setSavedActive(new URLSearchParams(window.location.search).get('saved') === '1');
    read();
    window.addEventListener('popstate', read); window.addEventListener('homecompass:view-change', read);
    const escape = event => { if (event.key === 'Escape') moreRef.current?.removeAttribute('open'); };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('popstate', read); window.removeEventListener('homecompass:view-change', read); window.removeEventListener('keydown', escape); };
  }, [pathname]);
  function changeCollection(event, saved) {
    if (pathname !== '/explore' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(window.location.href);
    if (saved) url.searchParams.set('saved', '1'); else url.searchParams.delete('saved');
    window.history.pushState({}, '', url.pathname + url.search);
    window.dispatchEvent(new Event('homecompass:view-change'));
    setSavedActive(saved);
  }
  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); moreRef.current?.removeAttribute('open'); router.replace('/'); }
    catch (error) { flash(error.message || 'Sign-out could not be completed. Please retry; your session is still active.', 'error'); }
    finally { setSigningOut(false); }
  }
  function collectionLinks(className = '') {
    return <nav className={cn('flex min-w-0 items-center gap-1', className)} aria-label="Primary navigation"><Link href="/explore" onClick={event => changeCollection(event, false)} className={cn('flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium sm:flex-none', pathname === '/explore' && !savedActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary')} aria-current={pathname === '/explore' && !savedActive ? 'page' : undefined}><MapPinned aria-hidden="true" className="size-4" />Explore</Link><Link href="/explore?saved=1" onClick={event => changeCollection(event, true)} className={cn('flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium sm:flex-none', pathname === '/explore' && savedActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary')} aria-current={pathname === '/explore' && savedActive ? 'page' : undefined}><Bookmark aria-hidden="true" className="size-4" />Saved <span className="tabular-nums">{shortlistIds.length}</span></Link></nav>;
  }
  return <div className="min-h-screen bg-background text-foreground"><a href="#main-content" className="sr-only z-[150] rounded-lg bg-card px-3 py-2 text-sm font-semibold text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur"><div className="container flex min-h-16 max-w-[1600px] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8"><Link href="/explore" className="flex min-h-11 min-w-0 items-center gap-2" aria-label={`${APP_NAME} home`}><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/50 text-primary"><MapPinned aria-hidden="true" className="size-4" /></span><span className="font-display text-sm font-semibold tracking-tight">{APP_NAME}</span></Link>{collectionLinks('hidden sm:flex sm:flex-1')}
      <div className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>{!user && <Button asChild variant="ghost"><Link href="/login">Sign in</Link></Button>}<details ref={moreRef} className="relative"><summary aria-label="More navigation and account options" className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium hover:bg-secondary"><Menu aria-hidden="true" className="size-4" /><span className="hidden md:inline">More</span></summary><nav aria-label="More navigation" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-2 shadow-xl">{[['/shortlist', Bookmark, 'Decision plans'], ['/sources', Database, 'Data sources'], ['/account', Settings2, user ? 'Account and settings' : 'Settings and browser data']].map(([href, Icon, label]) => <Link key={href} href={href} onClick={() => moreRef.current?.removeAttribute('open')} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-secondary"><Icon aria-hidden="true" className="size-4" />{label}</Link>)}{user ? <Button className="mt-1 w-full justify-start" variant="ghost" disabled={signingOut} onClick={handleSignOut}><LogOut aria-hidden="true" className="size-4" />{signingOut ? 'Signing out…' : 'Sign out'}</Button> : <Link href="/signup" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary hover:bg-secondary">Create account</Link>}</nav></details></div>
    </div><div className="container max-w-[1600px] border-t px-4 py-1 sm:hidden">{collectionLinks()}</div></header>
    <main id="main-content" className="app-scrollbar min-h-[calc(100dvh-4rem)]" tabIndex={-1}>{children}</main>
    {notice && <div className="pointer-events-none fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] mx-auto max-w-lg sm:inset-x-auto sm:right-5" role={notice.tone === 'error' ? 'alert' : 'status'}><div className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-sm shadow-xl', notice.tone === 'error' && 'border-destructive/50')}><span className="flex-1 leading-6">{notice.text}</span><Button size="icon" variant="ghost" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X className="size-4" /></Button></div></div>}
  </div>;
}
