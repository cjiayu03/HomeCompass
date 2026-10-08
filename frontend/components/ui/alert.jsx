import { cn } from '@/lib/utils';

export function Alert({ className, tone = 'info', ...props }) {
  const tones = { info: 'border-primary/20 bg-primary/5 text-foreground', warning: 'border-slate-400/35 bg-slate-400/10 text-foreground', error: 'border-destructive/25 bg-destructive/10 text-foreground', success: 'border-emerald-500/25 bg-emerald-500/10 text-foreground' };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', tones[tone], className)} {...props} />;
}
