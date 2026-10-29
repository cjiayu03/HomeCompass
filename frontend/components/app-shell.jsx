'use client';

import { usePathname } from 'next/navigation';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/components/workspace-provider';
import { Dock } from '@/components/ui/dock';

export function AppShell({ children }) {
  const pathname = usePathname();
  const { notice, setNotice, busy, homeState } = useWorkspace();
  const explorePage = pathname === '/explore';

  const loading = explorePage && (busy || ['idle', 'loading'].includes(homeState?.status));
  const NoticeIcon = notice?.tone === 'error' || notice?.tone === 'warning' ? TriangleAlert : notice?.tone === 'success' ? CheckCircle2 : Info;

  return <div className="min-h-screen bg-background text-foreground">
    <a href="#main-content" className="sr-only z-[150] rounded-lg bg-card px-3 py-2 text-sm font-semibold text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
    <main id="main-content" className={cn('app-main app-scrollbar', explorePage && 'app-shell--explore')} tabIndex={-1}>{children}</main>
    <Dock />
    {loading && <div className="workspace-loading" role="progressbar" aria-label="Loading housing data"><span /></div>}
    {notice && <div className="workspace-notice" role={notice.tone === 'error' ? 'alert' : 'status'}>
      <NoticeIcon aria-hidden="true" className={cn('size-4 shrink-0', notice.tone === 'error' ? 'text-destructive' : 'text-primary')} />
      <span className="workspace-notice-text">{notice.text}</span>
      {notice.action && <Button variant="ghost" className="workspace-notice-action" onClick={notice.action.onClick}>{notice.action.label}</Button>}
      <Button size="icon" variant="ghost" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X aria-hidden="true" className="size-4" /></Button>
    </div>}
  </div>;
}
