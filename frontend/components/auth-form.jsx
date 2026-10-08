'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Chrome, LockKeyhole } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';

export function AuthForm({ mode = 'login' }) {
  const isSignup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('warning');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { client, configured } = useAuth();

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setMessageTone('warning');
    if (isSignup && password !== confirm) { setMessage('Passwords do not match.'); return; }
    if (!client) { setMessage('Account sign-in is not configured yet. Add the Supabase project URL and publishable key to the frontend environment.'); return; }
    setBusy(true);
    const result = isSignup
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/explore`, data: { full_name: name.trim() } } })
      : await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    if (isSignup && !result.data.session) {
      setMessageTone('success');
      setMessage('Check your email to confirm your account, then return here to sign in.');
      return;
    }
    router.replace('/explore');
  }

  async function signInWithGoogle() {
    if (!client) { setMessage('Google sign-in is not configured yet.'); return; }
    setBusy(true);
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback?next=/explore` } });
    setBusy(false);
    if (error) setMessage(error.message);
  }

  return <Card className="w-full rounded-2xl">
    <CardHeader className="gap-3 p-6 sm:p-7">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="size-4" /></div>
      <div><CardTitle className="text-2xl">{isSignup ? 'Create your account' : 'Welcome back'}</CardTitle><CardDescription className="mt-1">{isSignup ? 'Keep saved places and comparisons together.' : 'Sign in to pick up where you left off.'}</CardDescription></div>
    </CardHeader>
    <CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {!configured && <Alert tone="warning" className="text-xs leading-5">Sign-in is unavailable until the Supabase URL and publishable key are configured.</Alert>}
        {isSignup && <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Name</span><Input name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /></label>}
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Email</span><Input name="email" type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Password</span><Input name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" minLength={8} required /></label>
        {isSignup && <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm password</span><Input name="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="••••••••" minLength={8} required /></label>}
        {message && <Alert tone={messageTone} className="text-xs leading-5">{message}</Alert>}
        <Button type="submit" disabled={busy || !configured} className="mt-1 w-full">{busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'} <ArrowRight className="size-4" /></Button>
        <div className="relative my-1"><div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div><span className="relative mx-auto block w-fit bg-card px-3 text-[11px] text-muted-foreground">or continue with</span></div>
        <Button type="button" variant="outline" disabled={busy || !configured} className="w-full" onClick={signInWithGoogle}><Chrome className="size-4" /> Google</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">{isSignup ? 'Already have an account?' : 'New here?'} <Link href={isSignup ? '/login' : '/signup'} className="font-semibold text-foreground underline decoration-primary/50 underline-offset-4 hover:decoration-primary">{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
    </CardContent>
  </Card>;
}
