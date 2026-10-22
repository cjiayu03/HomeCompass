'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { LoadingScene } from '@/components/loading-scene';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/components/auth-provider';
import { useWorkspace } from '@/components/workspace-provider';
import { requestJson } from '@/lib/api-client';

const OnboardingFlow = dynamic(() => import('@/components/onboarding-flow').then(module => module.OnboardingFlow), {
  loading: () => <LoadingScene label="Opening your household setup…" />,
});

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profileLoadState } = useWorkspace();
  const [profileStatus, setProfileStatus] = useState('loading');
  const [verificationError, setVerificationError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user) {
      router.replace('/explore');
      return undefined;
    }

    let active = true;
    setProfileStatus('loading');
    setVerificationError('');
    requestJson('/api/v1/profile', { cache: 'no-store' }).then((profile) => {
      if (!active) return;
      if (profile.onboardingCompleted === true) {
        setProfileStatus('complete');
        router.replace('/explore');
      } else {
        setProfileStatus('incomplete');
      }
    }).catch((error) => {
      if (!active) return;
      if (error?.status === 401) {
        router.replace('/explore');
        return;
      }
      setVerificationError(error.message || 'Your setup status could not be checked.');
      setProfileStatus('error');
    });
    return () => { active = false; };
  }, [authLoading, retryCount, router, user]);

  const loading = authLoading || !user || profileStatus === 'loading' || profileStatus === 'complete';
  return <AuthShell variant="wide">
    {loading ? <LoadingScene label="Checking your account…" />
      : profileStatus === 'error' ? <Card className="mx-auto max-w-xl rounded-2xl">
        <CardHeader><CardTitle>Setup could not be checked</CardTitle><CardDescription>Your account is still safe. Try again, or continue to Explore and set preferences later.</CardDescription></CardHeader>
        <CardContent className="space-y-4"><Alert tone="error">{verificationError}</Alert><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again <RefreshCw className="size-4" /></Button><Button type="button" variant="outline" onClick={() => router.replace('/explore')}>Go to Explore <ArrowRight className="size-4" /></Button></div></CardContent>
      </Card>
        : profileLoadState === 'loading' ? <LoadingScene label="Loading your saved preferences…" />
          : profileLoadState === 'error' ? <Card className="mx-auto max-w-xl rounded-2xl">
            <CardHeader><CardTitle>Your preferences could not be loaded</CardTitle><CardDescription>Reload to try again. You can also continue to Explore without finishing setup.</CardDescription></CardHeader>
            <CardContent><Alert tone="error" className="mb-4">Your account profile is temporarily unavailable.</Alert><div className="flex flex-wrap gap-2"><Button type="button" onClick={() => window.location.reload()}>Reload preferences <RefreshCw className="size-4" /></Button><Button type="button" variant="outline" onClick={() => router.replace('/explore')}>Go to Explore <ArrowRight className="size-4" /></Button></div></CardContent>
          </Card>
            : <OnboardingFlow />}
  </AuthShell>;
}
