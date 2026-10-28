'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Compass, Database, Bookmark, Settings2, Moon, Sun, LogIn, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppTheme } from '@/components/theme-provider';
import { useAuth } from '@/components/auth-provider';
import { useWorkspace } from '@/components/workspace-provider';
import './dock.css';

const destinations = [
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/shortlist', label: 'Plans', icon: Bookmark },
  { href: '/sources', label: 'Sources', icon: Database },
  { href: '/account', label: 'Account', icon: Settings2 },
];

function DockLink({ href, label, icon: Icon, active, reduceMotion }) {
  return <motion.div whileHover={reduceMotion ? undefined : { x: 4, scale: 1.1 }} whileFocus={reduceMotion ? undefined : { x: 3, scale: 1.06 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }} className="dock-item">
    <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} title={label} className={cn('dock-control', active && 'dock-control--active')}>
      <Icon aria-hidden="true" className="size-5" />
      <span className="dock-label">{label}</span>
    </Link>
  </motion.div>;
}

export function Dock() {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { theme, setTheme } = useAppTheme();
  const { user, signOut } = useAuth();
  const { flash } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);

  async function handleAuthAction() {
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
    <div className="dock" role="group" aria-label="HomeCompass navigation and account actions">
      {destinations.map(({ href, label, icon }) => <DockLink key={href} href={href} label={label} icon={icon} active={pathname === href || (href !== '/explore' && pathname.startsWith(`${href}/`))} reduceMotion={reduceMotion} />)}
      <span className="dock-divider" aria-hidden="true" />
      <motion.div whileHover={reduceMotion ? undefined : { x: 4, scale: 1.1 }} whileFocus={reduceMotion ? undefined : { x: 3, scale: 1.06 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }} className="dock-item">
        <button type="button" className="dock-control" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>
          {theme === 'dark' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
          <span className="dock-label">Theme</span>
        </button>
      </motion.div>
      <motion.div whileHover={reduceMotion ? undefined : { x: 4, scale: 1.1 }} whileFocus={reduceMotion ? undefined : { x: 3, scale: 1.06 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }} className="dock-item">
        <button type="button" className="dock-control" disabled={signingOut} onClick={handleAuthAction} aria-label={user ? (signingOut ? 'Signing out' : 'Sign out') : 'Sign in'} title={user ? (signingOut ? 'Signing out…' : 'Sign out') : 'Sign in'}>
          {user ? <LogOut aria-hidden="true" className="size-5" /> : <LogIn aria-hidden="true" className="size-5" />}
          <span className="dock-label">{signingOut ? 'Signing out' : user ? 'Sign out' : 'Sign in'}</span>
        </button>
      </motion.div>
    </div>
  </nav>;
}
