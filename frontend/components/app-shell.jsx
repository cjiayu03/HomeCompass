'use client';

import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { Dock } from '@/components/ui/dock';

export function AppShell({ children }) {
  const pathname = usePathname();
  const { notice, setNotice } = useWorkspace();
  const explorePage = pathname === '/explore';

  return <div className="min-h-screen bg-background text-foreground">
    <a href="#main-content" className="sr-only z-[150] rounded-lg bg-card px-3 py-2 text-sm font-semibold text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
    <main id="main-content" className={cn('app-main app-scrollbar', explorePage && 'app-shell--explore')} tabIndex={-1}>{children}</main>
    <Dock />
    {notice && <div className="pointer-events-none fixed right-3 top-3 z-[120] mx-auto max-w-lg sm:right-5" role={notice.tone === 'error' ? 'alert' : 'status'}><div className={cn('pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-sm shadow-xl', notice.tone === 'error' && 'border-destructive/50')}><span className="flex-1 leading-6">{notice.text}</span><Button size="icon" variant="ghost" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X className="size-4" /></Button></div></div>}
  </div>;
}
