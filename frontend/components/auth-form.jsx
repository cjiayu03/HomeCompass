'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const formRef = useRef(null);
  const alertRef = useRef(null);
  useEffect(() => { if (message) alertRef.current?.focus(); }, [message]);
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    const errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8 || password.length > 128) errors.password = 'Use between 8 and 128 characters.';
    if (isSignup && password !== confirm) errors.confirm = 'Passwords do not match.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) { formRef.current?.elements.namedItem(Object.keys(errors)[0])?.focus(); return; }
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
      <form ref={formRef} noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Email</span><Input name="email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "auth-email-error" : undefined} type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />{fieldErrors.email && <span id="auth-email-error" className="text-xs text-destructive">{fieldErrors.email}</span>}</label>
        <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Password</span><Input name="password" aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "auth-password-error" : undefined} type={showPassword ? "text" : "password"} autoComplete={isSignup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" minLength={8} maxLength={128} required />{fieldErrors.password && <span id="auth-password-error" className="text-xs text-destructive">{fieldErrors.password}</span>}</label>
        {isSignup && <label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm password</span><Input name="confirm" aria-invalid={Boolean(fieldErrors.confirm)} aria-describedby={fieldErrors.confirm ? "auth-confirm-error" : undefined} type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="••••••••" minLength={8} maxLength={128} required />{fieldErrors.confirm && <span id="auth-confirm-error" className="text-xs text-destructive">{fieldErrors.confirm}</span>}</label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={e=>setShowPassword(e.target.checked)}/>Show password</label>
        {!isSignup && <Link href="/forgot-password" className="text-sm underline">Forgot password?</Link>}
        {message && <div ref={alertRef} tabIndex={-1} role="alert"><Alert tone="warning" className="text-xs leading-5">{message}</Alert></div>}
        <Button type="submit" disabled={busy} aria-busy={busy} className="mt-1 h-12 w-full">{busy ? <LoadingScene compact label={isSignup ? 'Creating your account…' : 'Signing you in…'} /> : <>{isSignup ? 'Create account' : 'Sign in'} <ArrowRight className="size-4" /></>}</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">{isSignup ? 'Already have an account?' : 'New here?'} <Link href={isSignup ? '/login' : '/signup'} className="font-semibold text-foreground underline decoration-primary/50 underline-offset-4 hover:decoration-primary">{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
    </CardContent>
  </Card>;
}
