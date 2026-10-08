import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return <><div className="mb-7 text-center"><p className="text-xs font-semibold text-primary">Your places, kept together</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em]">Sign in</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Use your account to return to saved homes and comparisons.</p></div><AuthForm mode="login" /></>;
}
