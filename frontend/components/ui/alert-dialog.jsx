'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({ className, ...props }) {
  return <AlertDialogPrimitive.Portal><AlertDialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" /><AlertDialogPrimitive.Content className={cn('glass-panel fixed left-1/2 top-1/2 z-[100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 overscroll-contain', className)} {...props} /></AlertDialogPrimitive.Portal>;
}

export function AlertDialogHeader({ className, ...props }) { return <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />; }
export function AlertDialogFooter({ className, ...props }) { return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />; }
export function AlertDialogTitle({ className, ...props }) { return <AlertDialogPrimitive.Title className={cn('font-display text-xl font-semibold tracking-tight', className)} {...props} />; }
export function AlertDialogDescription({ className, ...props }) { return <AlertDialogPrimitive.Description className={cn('text-sm leading-6 text-muted-foreground', className)} {...props} />; }
