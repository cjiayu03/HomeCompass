'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';
import { requestJson } from '@/lib/api-client';
import { LoadingScene } from '@/components/loading-scene';

export function AuthForm({ mode = 'login' }) {
  const isSignup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    if (isSignup && password !== confirm) { setMessage('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (isSignup) {
        await signUp({ email, password });
        router.replace('/onboarding');
      } else {
        await signIn({ email, password });
        let destination = '/explore';
        try {
          const profile = await requestJson('/api/v1/profile', { cache: 'no-store' });
          if (profile.onboardingCompleted === false) destination = '/onboarding';
        } catch {
          // A returning user should still be able to reach Explore when profile data is unavailable.
        }
        router.replace(destination);
      }
    } catch (error) {
      setMessage(error.message || 'Unable to authenticate. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <Card className="w-full rounded-2xl">
    <CardHeader className="gap-3 p-6 sm:p-7">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="size-4" /></div>
      <div><CardTitle className="text-2xl">{isSignup ? 'Create your account' : 'Welcome back'}</CardTitle><CardDescription className="mt-1">{isSignup ? 'Keep saved places and comparisons together.' : 'Sign in to pick up where you left off.'}</CardDescription></div>
    </CardHeader>
    <CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Email</span><Input name="email" type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Password</span><Input name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" minLength={8} required /></label>
        {isSignup && <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm password</span><Input name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="••••••••" minLength={8} required /></label>}
        {message && <Alert tone="warning" className="text-xs leading-5">{message}</Alert>}
        <Button type="submit" disabled={busy} aria-busy={busy} className="mt-1 h-12 w-full">{busy ? <LoadingScene compact label={isSignup ? 'Creating your account…' : 'Signing you in…'} /> : <>{isSignup ? 'Create account' : 'Sign in'} <ArrowRight className="size-4" /></>}</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">{isSignup ? 'Already have an account?' : 'New here?'} <Link href={isSignup ? '/login' : '/signup'} className="font-semibold text-foreground underline decoration-primary/50 underline-offset-4 hover:decoration-primary">{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
    </CardContent>
  </Card>;
}
