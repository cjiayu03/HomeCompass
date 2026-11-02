'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Compass, Database, Bookmark, Sparkles, Settings2, Moon, Sun, LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppTheme } from '@/components/theme-provider';
import { useAuth } from '@/components/auth-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { HOME_SAVED_EVENT } from '@/lib/workspace-events';
import { AssistantOrb } from '@/components/assistant-orb';
import { useAssistantOpen } from '@/lib/assistant-state';
import './dock.css';

const destinations = [
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/shortlist', label: 'Saved', icon: Bookmark },
  { href: '/sources', label: 'Sources', icon: Database },
  { href: '/account', label: 'Account', icon: Settings2 },
];

function DockLink({ href, label, icon: Icon, active, celebrateSave = false }) {
  const linkRef = useRef(null);
  useEffect(() => {
    if (!celebrateSave) return;
    let animations = [];
    function celebrate() {
      const link = linkRef.current;
      if (!link?.animate) return;
      animations.forEach(animation => animation.cancel());
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      animations = [link.animate([
        { backgroundColor: 'hsl(var(--primary) / 0)', color: 'hsl(var(--muted-foreground))', boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
        { offset: .25, backgroundColor: 'hsl(var(--primary) / .18)', color: 'hsl(var(--primary))', boxShadow: '0 0 18px 3px hsl(var(--primary) / .28)' },
        { offset: .65, backgroundColor: 'hsl(var(--primary) / .1)', color: 'hsl(var(--primary))', boxShadow: '0 0 10px 1px hsl(var(--primary) / .12)' },
        { backgroundColor: 'hsl(var(--primary) / 0)', color: 'hsl(var(--muted-foreground))', boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
      ], { duration: reduced ? 650 : 1200, easing: 'ease-out' })];
      if (!reduced) animations.push(link.querySelector('svg').animate([
        { transform: 'translateY(0) scale(1)', fill: 'hsl(var(--primary) / 0)' },
        { offset: .3, transform: 'translateY(-5px) scale(1.22)', fill: 'hsl(var(--primary) / .25)' },
        { offset: .5, transform: 'translateY(1px) scale(.96)', fill: 'hsl(var(--primary) / .18)' },
        { offset: .72, transform: 'translateY(-2px) scale(1.08)', fill: 'hsl(var(--primary) / .1)' },
        { transform: 'translateY(0) scale(1)', fill: 'hsl(var(--primary) / 0)' },
      ], { duration: 800, easing: 'ease-out' }));
      if (!reduced) {
        animations.push(link.querySelector('.dock-save-glint').animate([
          { transform: 'translateX(-160%) skewX(-24deg)', opacity: 0 },
          { offset: .15, opacity: 1 },
          { offset: .75, opacity: 1 },
          { transform: 'translateX(260%) skewX(-24deg)', opacity: 0 },
        ], { duration: 850, delay: 70, easing: 'cubic-bezier(.16,1,.3,1)' }));
        animations.push(link.querySelector('.dock-save-sparkle').animate([
          { transform: 'scale(.2) rotate(-35deg)', opacity: 0 },
          { offset: .28, transform: 'scale(1.2) rotate(8deg)', opacity: 1 },
          { offset: .52, transform: 'scale(.9) rotate(0deg)', opacity: .9 },
          { transform: 'scale(.3) rotate(25deg)', opacity: 0 },
        ], { duration: 760, delay: 180, easing: 'ease-out' }));
      }
    }
    window.addEventListener(HOME_SAVED_EVENT, celebrate);
    return () => {
      window.removeEventListener(HOME_SAVED_EVENT, celebrate);
      animations.forEach(animation => animation.cancel());
    };
  }, [celebrateSave]);
  return <div className="dock-item">
    <Link ref={linkRef} href={href} aria-label={label} title={label} aria-current={active ? 'page' : undefined} className={cn('dock-control', active && 'dock-control--active')}>
      <Icon aria-hidden="true" className="size-5" />
      {href === '/shortlist' && <><span className="dock-save-sheen" aria-hidden="true"><span className="dock-save-glint" /></span><Sparkles aria-hidden="true" className="dock-save-sparkle" /></>}
      <span className="dock-label">{label}</span>
    </Link>
  </div>;
}

export function Dock() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useAppTheme();
  const { user, signOut, transitioning = false, sessionVerified = true } = useAuth();
  const { flash } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);
  const [assistantOpen, setAssistantOpen] = useAssistantOpen();
  const assistantVisible = assistantOpen && ['/explore', '/shortlist'].includes(pathname);
  function toggleAssistant() {
    if (!['/explore', '/shortlist'].includes(pathname)) { setAssistantOpen(true); router.push('/explore'); return; }
    setAssistantOpen(current => !current);
  }
  const authPaused = transitioning || Boolean(user) && !sessionVerified;
  async function handleAuthAction() {
    if (signingOut || authPaused) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/');
    } catch (error) {
      flash(error.message || 'Sign-out could not be completed. Please retry; your session is still active.', 'error');
    } finally {
      setSigningOut(false);
    }
  }

  return <nav className="dock-wrap" aria-label="Main navigation">
    <div id="homecompass-dock-panel" className="dock" role="group" aria-label="HomeCompass navigation and account actions">
      {destinations.map(({ href, label, icon }) => <DockLink key={href} href={href} label={label} icon={icon} celebrateSave={href === '/shortlist' && pathname === '/explore'} active={pathname === href || (href !== '/explore' && pathname.startsWith(`${href}/`))} />)}
      <div className="dock-item"><button type="button" data-housing-assistant className={cn('dock-control dock-assistant', assistantVisible && 'dock-control--active')} onClick={toggleAssistant} aria-label={assistantVisible ? 'Close housing assistant' : 'Open housing assistant'} aria-expanded={assistantVisible} aria-controls={pathname === '/explore' && assistantOpen ? 'housing-assistant-panel' : undefined}><AssistantOrb active={assistantVisible} /><span className="dock-label">Ask AI</span></button></div>
      <span className="dock-divider" aria-hidden="true" />
      <div className="dock-item">
        <button type="button" className="dock-control" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>
          {theme === 'dark' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
          <span className="dock-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
      <div className="dock-item">
        <button type="button" className="dock-control" disabled={signingOut || authPaused} aria-busy={signingOut || transitioning} onClick={handleAuthAction} aria-label={user ? (signingOut ? 'Signing out' : 'Sign out') : 'Sign in'}>
          {user ? <LogOut aria-hidden="true" className="size-5" /> : <LogIn aria-hidden="true" className="size-5" />}
          <span className="dock-label">{signingOut ? 'Signing out' : user ? 'Sign out' : 'Sign in'}</span>
        </button>
      </div>
    </div>
  </nav>;
}
