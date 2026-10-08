import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }) {
  return <textarea className={cn('flex min-h-24 w-full resize-none rounded-xl border bg-background px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />;
}
