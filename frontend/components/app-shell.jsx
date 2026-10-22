'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bookmark, GitCompareArrows, MapPinned, Moon, Settings2, Sun, LogOut, CircleUserRound, Database } from 'lucide-react';
import { APP_NAME, navigation } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/components/workspace-provider';
import { useAppTheme } from '@/components/theme-provider';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';

const icons = { '/shortlist': Bookmark, '/compare': GitCompareArrows, '/sources': Database, '/account': Settings2 };

export function AppShell({ children }) {
  const pathname = usePathname();
  const { theme, setTheme } = useAppTheme();
  const { shortlistIds, compareIds, notice, setNotice } = useWorkspace();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const isDark = theme === 'dark';

  async function handleSignOut() {
    try { await signOut(); } catch { /* Local auth state is cleared even if the server is unreachable. */ }
    router.replace('/');
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only z-[100] rounded-lg bg-card px-3 py-2 text-sm font-semibold text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-16 max-w-[1600px] items-center gap-5">
          <Link href="/explore" className="flex shrink-0 items-center gap-2.5" aria-label={`${APP_NAME} home`}>
            <span className="grid size-8 place-items-center rounded-lg border border-primary/50 text-primary"><MapPinned className="size-4" /></span>
            <span className="font-display text-sm font-semibold tracking-tight">{APP_NAME}</span>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Primary navigation">
            {navigation.map((item) => {
              const active = pathname === item.href || (item.href === '/explore' && pathname === '/');
              const Icon = icons[item.href];
              const count = item.href === '/shortlist' ? shortlistIds.length : item.href === '/compare' ? compareIds.length : null;
              return (
                <Link key={item.href} href={item.href} className={cn('flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors', active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground')} aria-current={active ? 'page' : undefined}>
                  {Icon && <Icon className="size-3.5" />}
                  <span>{item.label}</span>
                  {count !== null && <Badge variant={active ? 'default' : 'secondary'} className="min-w-5 justify-center px-1.5 py-0.5 text-[10px]">{count}</Badge>}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="icon" aria-label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={() => setTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            {user ? <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/account"><CircleUserRound className="size-4" />{user.email?.split('@')[0] || 'Account'}</Link></Button>
              <Button variant="outline" size="sm" onClick={handleSignOut} aria-label="Sign out"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></Button>
            </> : <>
              <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm" className="hidden sm:inline-flex"><Link href="/signup">Create account</Link></Button>
            </>}
          </div>
        </div>
      </header>

      <main id="main-content" className="app-scrollbar min-h-[calc(100dvh-4rem)]" tabIndex={-1}>{children}</main>

      {notice && <div className="fixed bottom-5 right-5 z-[70] max-w-[min(380px,calc(100vw-2rem))] animate-fade-up"><div className={cn('glass-card rounded-lg px-4 py-3 text-sm shadow-float', notice.tone === 'warning' && 'border-slate-400/35', notice.tone === 'success' && 'border-emerald-500/30')} role={notice.tone === 'error' ? 'alert' : 'status'}><div className="flex items-start gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><span className="leading-5">{notice.text}</span><Button size="icon" variant="ghost" className="ml-1 size-8 shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</Button></div></div></div>}
    </div>
  );
}
