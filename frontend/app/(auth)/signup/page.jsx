import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Create account' };

export default function SignupPage() {
  return <><div className="mb-7 text-center"><p className="text-xs font-semibold text-primary">A quieter way to compare</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em]">Create an account</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Save a shortlist and return to it whenever you need.</p></div><AuthForm mode="signup" /></>;
}
