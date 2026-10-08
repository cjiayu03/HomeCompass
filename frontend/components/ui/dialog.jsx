'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, overlayClassName, children, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn('fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in', overlayClassName)} />
      <DialogPrimitive.Content className={cn('glass-panel fixed left-1/2 top-1/2 z-[100] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 duration-200', className)} {...props}>
        {children}
        <DialogPrimitive.Close className="clear-button clear-button-quiet absolute right-4 top-4 grid size-9 place-items-center rounded-xl text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /><span className="sr-only">Close</span></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />; }
export function DialogFooter({ className, ...props }) { return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />; }
export function DialogTitle({ className, ...props }) { return <DialogPrimitive.Title className={cn('font-display text-xl font-semibold tracking-tight', className)} {...props} />; }
export function DialogDescription({ className, ...props }) { return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />; }
