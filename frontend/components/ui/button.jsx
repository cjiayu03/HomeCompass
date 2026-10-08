import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'clear-button relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'clear-button-primary text-primary-foreground',
        secondary: 'clear-button-secondary text-secondary-foreground',
        outline: 'clear-button-outline text-foreground',
        ghost: 'clear-button-quiet text-muted-foreground hover:text-foreground',
        soft: 'clear-button-soft text-primary',
        warning: 'clear-button-secondary text-accent-foreground',
        destructive: 'clear-button-danger text-destructive-foreground',
        link: 'clear-button-link text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-lg px-5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
