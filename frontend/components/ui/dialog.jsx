'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, overlayClassName, children, onOpenAutoFocus, onCloseAutoFocus, ...props }) {
  const opener = useRef(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn('dialog-backdrop fixed inset-0 z-[90] bg-black/45', overlayClassName)} />
      <DialogPrimitive.Content className={cn('dialog-surface fixed left-1/2 top-1/2 z-[100] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overscroll-contain rounded-xl border bg-popover p-6 text-popover-foreground shadow-xl duration-200', className)} {...props}
        onOpenAutoFocus={event => { opener.current = document.activeElement; onOpenAutoFocus?.(event); }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          // A new dialog owns focus during a filter/place editor handoff.
          if (!document.querySelector('[role="dialog"][data-state="open"]') && opener.current?.isConnected) opener.current.focus();
        }}>
        {children}
        <DialogPrimitive.Close className="clear-button clear-button-quiet absolute right-4 top-4 grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /><span className="sr-only">Close</span></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />; }
export function DialogFooter({ className, ...props }) { return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />; }
export function DialogTitle({ className, ...props }) { return <DialogPrimitive.Title className={cn('font-display text-xl font-semibold tracking-tight', className)} {...props} />; }
export function DialogDescription({ className, ...props }) { return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />; }
