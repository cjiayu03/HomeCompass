import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold leading-none tracking-wide', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      warning: 'border-transparent bg-accent text-accent-foreground',
    },
    defaultVariants: { variant: 'default' },
  },
});

export function Badge({ className, variant, ...props }) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
