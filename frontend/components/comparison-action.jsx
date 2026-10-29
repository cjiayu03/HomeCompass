'use client';

import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';
import { COMPARISON_ADDED_EVENT } from '@/lib/workspace-events';

export function ComparisonAction({ homes, onRemove, onOpen }) {
  const [open, setOpen] = useState(false);
  const hoverOpened = useRef(false);
  const timer = useRef(null);
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const anchorRef = useRef(null);
  const titleId = useId();
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    let animations = [];
    function celebrate(event) {
      if (event.detail?.count < 2 || !anchorRef.current?.animate) return;
      animations.forEach(animation => animation.cancel());
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const group = anchorRef.current;
      animations = [group.animate([
        { transform: 'translateY(0) scale(1)' },
        { offset: .25, transform: 'translateY(-4px) scale(1.035)' },
        { offset: .5, transform: 'translateY(1px) scale(.99)' },
        { offset: .72, transform: 'translateY(-1px) scale(1.01)' },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 750, easing: 'ease-out' }), group.querySelector('.comparison-glint').animate([
        { transform: 'translateX(-160%) skewX(-24deg)', opacity: 0 },
        { offset: .15, opacity: 1 },
        { offset: .75, opacity: 1 },
        { transform: 'translateX(360%) skewX(-24deg)', opacity: 0 },
      ], { duration: 850, delay: 70, easing: 'cubic-bezier(.16,1,.3,1)' }), group.querySelector('.comparison-sparkle').animate([
        { transform: 'scale(.2) rotate(-35deg)', opacity: 0 },
        { offset: .28, transform: 'scale(1.2) rotate(8deg)', opacity: 1 },
        { offset: .52, transform: 'scale(.9) rotate(0deg)', opacity: .9 },
        { transform: 'scale(.3) rotate(25deg)', opacity: 0 },
      ], { duration: 760, delay: 180, easing: 'ease-out' })];
    }
    window.addEventListener(COMPARISON_ADDED_EVENT, celebrate);
    return () => {
      window.removeEventListener(COMPARISON_ADDED_EVENT, celebrate);
      animations.forEach(animation => animation.cancel());
    };
  }, []);

  function preview(event) {
    clearTimeout(timer.current);
    if (event.pointerType === 'touch') return;
    hoverOpened.current = true;
    timer.current = setTimeout(() => setOpen(true), 140);
  }
  function scheduleClose() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!contentRef.current?.contains(document.activeElement) && !anchorRef.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  }
  function openComparison() {
    if (homes.length < 2) return;
    clearTimeout(timer.current);
    setOpen(false);
    onOpen();
  }
  function remove(home) {
    onRemove(home);
    requestAnimationFrame(() => {
      const next = contentRef.current?.querySelector('[data-remove-comparison]');
      (next || triggerRef.current)?.focus({ preventScroll: true });
    });
  }

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild>
      <div ref={anchorRef} className="comparison-action-group" data-ready={homes.length >= 2} data-preview-open={open} onPointerEnter={preview} onPointerLeave={scheduleClose}>
        <Button className="comparison-action" variant={homes.length >= 2 ? 'default' : 'outline'} disabled={homes.length < 2} title={homes.length < 2 ? 'Select at least two homes to compare' : 'Compare selected homes'} aria-label={`Compare ${homes.length} selected records`} onClick={openComparison}>Compare <span className="comparison-count" aria-hidden="true">{homes.length}</span><span className="comparison-sheen" aria-hidden="true"><span className="comparison-glint" /></span><Sparkles className="comparison-sparkle" aria-hidden="true" /></Button>
        <Popover.Trigger asChild>
          <Button ref={triggerRef} size="icon" variant="outline" className="comparison-manage" aria-label="Manage comparisons" title="Edit selected homes or remove a comparison" onClick={event => { clearTimeout(timer.current); const fromHover = hoverOpened.current; hoverOpened.current = false; if (open && fromHover) { event.preventDefault(); contentRef.current?.querySelector('[data-remove-comparison]')?.focus({ preventScroll: true }); } }}><ChevronDown aria-hidden="true" className="comparison-edit-chevron size-4" /><span>Edit</span></Button>
        </Popover.Trigger>
      </div>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content className="comparison-preview" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId} ref={contentRef} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={scheduleClose} onFocusCapture={() => { clearTimeout(timer.current); hoverOpened.current = false; }} onBlurCapture={scheduleClose}
        onOpenAutoFocus={event => { if (hoverOpened.current) event.preventDefault(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (!hoverOpened.current && !document.querySelector('.dialog-surface[data-state="open"]')) triggerRef.current?.focus({ preventScroll: true }); }}>
        <header><h2 id={titleId}>Selected homes <span>{homes.length} / 3</span></h2><Popover.Close asChild><Button size="icon" variant="ghost" aria-label="Close comparison preview"><X aria-hidden="true" className="size-4" /></Button></Popover.Close></header>
        {homes.length ? <>
          <p className="comparison-help">Changed your mind? Remove a home below.</p>
          <ul aria-label="Homes in comparison">{homes.map(home => <li key={home.id}><div><p>{home.address}</p><span>{money(home.price)} · {home.town}</span></div><Button data-remove-comparison variant="ghost" aria-label={`Remove ${home.address} from comparison`} onClick={() => remove(home)}><X aria-hidden="true" className="size-4" />Remove</Button></li>)}</ul>
          <footer><Button variant="ghost" onClick={() => { homes.forEach(onRemove); triggerRef.current?.focus({ preventScroll: true }); }}>Clear all</Button><Button disabled={homes.length < 2} onClick={openComparison}>Open comparison</Button></footer>
        </> : <p className="comparison-empty">Choose Compare on a home to add it here.</p>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
