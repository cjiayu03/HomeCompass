'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bookmark, LockKeyhole, MapPin, Scale, Trash2, UsersRound } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { PlaceManager } from '@/components/place-manager';
import { requestJson } from '@/lib/api-client';
import { defaultBrief } from '@/lib/data';
import { money } from '@/lib/utils';

function DeleteDialog({ open, onCancel, onConfirm, busy }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Clear this local workspace?</AlertDialogTitle><AlertDialogDescription>This removes searches, preferences, saved choices, decision notes and viewing photos from this browser. Your account data stays on the server. Download any photos you want to keep first.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? 'Clearing…' : 'Clear workspace'}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function AccountDeleteDialog({ open, onCancel, onConfirm, busy, disabled }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Delete your account?</AlertDialogTitle><AlertDialogDescription>This permanently removes your local account, saved records, and active sessions. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" disabled={busy || disabled} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete account'}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function syncValueCount(value) {
  if (Array.isArray(value)) return value.length;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function syncSectionCount(section) {
  return Object.entries(section || {})
    .filter(([key]) => key !== 'retryableHistoryIndexes')
    .reduce((count, [, value]) => count + syncValueCount(value), 0);
}

export default function AccountPage() {
  const { brief = defaultBrief, places = [], shortlistIds, compareIds, clearLocalData, profileSyncState, retryProfileSync, flash, syncState, syncResult, syncGuestData, pendingLocalPlaceCount } = useWorkspace();
  const { user, refreshSession, transitioning = false, sessionVerified = true } = useAuth();
  const ownerIdentity = user?.id ? `account:${user.id}` : 'guest';
  const accountActionsPaused = transitioning || !sessionVerified;
  const ownerRef = useRef(ownerIdentity);
  ownerRef.current = ownerIdentity;
  const [sessionRetryBusy, setSessionRetryBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [placeUploadOpen, setPlaceUploadOpen] = useState(false);
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountDeleteBusy, setAccountDeleteBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const currentPasswordRef=useRef(null),confirmPasswordRef=useRef(null);
  const [passwordMessage, setPasswordMessage] = useState(null);
  useLayoutEffect(() => {
    setAccountDeleteOpen(false);
    setPlaceUploadOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordMessage(null);
    setShowPasswords(false);
    setAccountDeleteBusy(false);
    setPasswordBusy(false);
  }, [ownerIdentity]);
  const router = useRouter();
  const acceptedCount = syncSectionCount(syncResult?.accepted);
  const skippedCount = syncSectionCount(syncResult?.skipped);
  const skippedHistoryCount = syncValueCount(syncResult?.skipped?.history);
  const retryableHistoryCount = syncValueCount(syncResult?.skipped?.retryableHistoryIndexes);
  const syncCanRetry = syncState === 'error' || retryableHistoryCount > 0;
  const conflictFields = (syncResult?.conflicts || []).map((conflict) => conflict.field).filter(Boolean);
  async function confirmDelete() {
    setClearBusy(true);
    try { await clearLocalData(); setDeleteOpen(false); flash('Browser workspace cleared. Your account data is preserved.', 'success'); }
    catch(error) { flash(error.message || 'Some browser data could not be cleared.', 'error'); }
    finally { setClearBusy(false); }
  }

  async function confirmPlaceUpload() {
    if (accountActionsPaused) return;
    const result = await syncGuestData({ confirmPlaces: true });
    if (result?.ok) setPlaceUploadOpen(false);
  }

  async function confirmAccountDelete() {
    if (accountActionsPaused || accountDeleteBusy) return;
    const actionOwner = ownerIdentity;
    setAccountDeleteBusy(true);
    try {
      await requestJson('/api/v1/account', { method: 'DELETE' });
      if (ownerRef.current !== actionOwner) return;
      await clearLocalData().catch(error=>flash(`Account deleted. ${error.message || 'Some browser data could not be cleared.'}`, 'warning'));
      setAccountDeleteOpen(false);
      await refreshSession();
      router.replace('/');
    } catch (error) {
      if (ownerRef.current !== actionOwner) return;
      flash(error.message || 'Account deletion could not be completed.', 'error');
    } finally {
      if (ownerRef.current === actionOwner) setAccountDeleteBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (accountActionsPaused || passwordBusy) return;
    const actionOwner = ownerIdentity;
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ tone: 'warning', text: 'The new passwords do not match.' });
      confirmPasswordRef.current?.focus();
      return;
    }
    setPasswordBusy(true);
    try {
      await requestJson('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (ownerRef.current !== actionOwner) return;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ tone: 'success', text: 'Password updated. Other signed-in sessions have been ended.' });
    } catch (error) {
      if (ownerRef.current !== actionOwner) return;
      setPasswordMessage({ tone: 'warning', text: error.message || 'Password could not be updated.' });
      if(error.code === 'CURRENT_PASSWORD_INVALID')currentPasswordRef.current?.focus();
    } finally {
      if (ownerRef.current === actionOwner) setPasswordBusy(false);
    }
  }

  async function retrySessionCheck() {
    setSessionRetryBusy(true);
    try { await refreshSession(); } finally { setSessionRetryBusy(false); }
  }

  const household = [[brief.adults, 'adult', 'adults'], [brief.children, 'child', 'children'], [brief.olderAdults, 'older adult', 'older adults']]
    .filter(([count]) => Number(count) > 0).map(([count, singular, plural]) => `${count} ${Number(count) === 1 ? singular : plural}`).join(', ');
  const towns = brief.preferredTowns || [];
  const preferenceRows = [
    ['Household', household || 'Add your household'],
    ['Budget', brief.budget ? `${money(brief.budget)}${brief.requirements?.budget === false ? ' preferred' : ' maximum'}` : 'No budget set'],
    ['Preferred towns', towns.length ? towns.join(', ') : 'Open to all towns'],
    ['Flat type', brief.preferredFlatType || 'Open to any flat type'],
  ];
  return <div className="account-page min-h-[calc(100dvh-4rem)]">
    <div className="container flex max-w-[1120px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
      <header className="account-heading">
        <div><h1 className="font-display text-3xl font-semibold tracking-tight">Your household workspace</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{towns.length ? `Planning your next home in ${towns.join(', ')}.` : 'Keep your home search centred on the people and places that matter.'}</p></div>
        <Button asChild><Link href="/explore">Continue exploring<ArrowRight aria-hidden="true" className="size-4" /></Link></Button>
      </header>
      <div className="account-overview">
        <section className="account-preferences" aria-labelledby="household-preferences-heading">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="household-preferences-heading" className="text-lg font-semibold">Your search preferences</h2><Link href="/onboarding" className="account-edit-link">Edit preferences<ArrowRight aria-hidden="true" className="size-4" /></Link></div>
          <dl className="account-preference-list">{preferenceRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />These preferences help you compare homes for your household. Update them as your plans change.</p>
        </section>
        <nav className="account-shortcuts" aria-label="Your housing research">
          <h2 className="text-lg font-semibold">Pick up where you left off</h2>
          {[
            { href: '/shortlist', icon: Bookmark, title: 'Saved homes', description: shortlistIds.length ? `${shortlistIds.length} saved ${shortlistIds.length === 1 ? 'record' : 'records'} to revisit` : 'Save homes while you explore' },
            { href: '/compare', icon: Scale, title: 'Your comparison', description: compareIds.length ? `${compareIds.length} ${compareIds.length === 1 ? 'home' : 'homes'} selected for comparison` : 'Choose homes to compare side by side' },
            { href: '#household-places', icon: MapPin, title: 'Places that matter', description: places.length ? `${places.length} saved ${places.length === 1 ? 'place' : 'places'} for distance checks` : 'Add work, school or family addresses' },
          ].map(({ href, icon: Icon, title, description }) => <Link key={href} href={href} className="account-shortcut"><Icon aria-hidden="true" className="size-5 text-primary" /><span><strong>{title}</strong>{' '}<span>{description}</span></span><ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" /></Link>)}
        </nav>
      </div>

      <div className="grid gap-5">

        {user && !sessionVerified && <Alert tone="warning" className="flex-wrap items-center justify-between gap-3"><p>We couldn’t verify your session. Account changes are paused until we can confirm who is signed in.</p><Button variant="outline" size="sm" disabled={sessionRetryBusy || transitioning} onClick={retrySessionCheck}>{sessionRetryBusy ? 'Checking session…' : 'Retry session check'}</Button></Alert>}

        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>Account and sync</CardTitle><p className="mt-1 text-sm text-muted-foreground">{user ? user.email : 'Sign in to sync saved source records across devices.'}</p></div><Badge variant="secondary">{user ? (accountActionsPaused ? 'Session not verified' : 'Signed in') : 'Guest'}</Badge></div></CardHeader>
          <CardContent>
            <div className="account-sync-summary"><p className="text-sm leading-6 text-muted-foreground">{user ? 'Your saved homes and decision notes can sync across devices. Viewing photos stay in this browser.' : 'You’re exploring as a guest. Your preferences and saved choices stay in this browser.'}</p>{!user && <Button asChild variant="outline"><Link href="/login?next=%2Faccount">Sign in to sync</Link></Button>}</div>
            {user && profileSyncState && <div role="status" className="mt-3 text-xs"><p>Preferences: {({local:'Saved in this browser',syncing:'Saving to account…',synced:'Saved to account',error:'Could not save to account'})[profileSyncState.status]}</p>{profileSyncState.error && <p className="mt-1 text-destructive">{profileSyncState.error.message || String(profileSyncState.error)}</p>}{profileSyncState.status==='error' && <Button variant="outline" size="sm" className="mt-2" disabled={accountActionsPaused} onClick={retryProfileSync}>Retry saving preferences</Button>}</div>}
            <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Guest data transfer details</summary><Alert tone={syncState === 'error' ? 'warning' : syncState === 'synced' ? 'success' : 'info'} className="mt-3 flex-col text-xs leading-5">
              <p>Guest data sync: {syncState}.</p>
              {syncResult && <p>{acceptedCount} accepted · {skippedCount} skipped · {conflictFields.length} conflicts.</p>}
              {skippedHistoryCount > 0 && retryableHistoryCount > 0 && <p>Skipped search history remains saved in this browser and can be retried.</p>}
              {conflictFields.length > 0 && <p>Account values were kept for: {conflictFields.join(', ')}.</p>}
              {pendingLocalPlaceCount > 0 && <p>{pendingLocalPlaceCount} local personal {pendingLocalPlaceCount === 1 ? 'place is' : 'places are'} still on this browser until you confirm an upload.</p>}
            </Alert></details>
            {user && syncCanRetry && <Button className="mt-3" variant="outline" disabled={accountActionsPaused || syncState === 'syncing'} onClick={() => syncGuestData()}>Retry account sync</Button>}
            {user && pendingLocalPlaceCount > 0 && <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3"><p className="text-xs text-muted-foreground">Local saved places include personal location details.</p><Button size="sm" variant="outline" disabled={accountActionsPaused} onClick={() => setPlaceUploadOpen(true)}>Review upload</Button></div>}
          </CardContent>
        </Card>
      </div>

      <fieldset id="household-places" className="account-places min-w-0" disabled={Boolean(user) && accountActionsPaused}><PlaceManager key={ownerIdentity} /></fieldset>

      {user && <Card><CardHeader><CardTitle>Change password</CardTitle><p className="text-sm text-muted-foreground">Choose a new password with at least 8 characters.</p></CardHeader><CardContent><form method="post" className="grid gap-4 sm:grid-cols-3" onSubmit={changePassword}><fieldset className="contents" disabled={accountActionsPaused || passwordBusy}><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Current password</span><Input ref={currentPasswordRef} type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">New password</span><Input type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm new password</span><Input type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="new-password" minLength={8} ref={confirmPasswordRef} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={showPasswords} onChange={event=>setShowPasswords(event.target.checked)}/>Show passwords</label><div className="flex flex-wrap items-center gap-3 sm:col-span-3">{passwordMessage && <Alert tone={passwordMessage.tone} className="text-xs">{passwordMessage.text}</Alert>}<Button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</Button></div></fieldset></form></CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Data and privacy</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2"><p className="flex gap-2"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />Viewing photos stay in this browser. Download any photos you want to keep before clearing your workspace.</p><p className="flex gap-2"><MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />Browser-only places stay on this device until you choose to upload them. Review any pending uploads in Account and sync.</p><div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2"><div><p className="font-semibold text-foreground">Clear local data</p><p className="mt-1 text-xs">Remove searches, preferences, choices, decision notes and photos from this browser. Account data stays on the server.</p></div><Button variant="outline" onClick={() => setDeleteOpen(true)}>Clear this browser</Button></div>{user && <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4 sm:col-span-2"><div><p className="font-semibold text-destructive">Delete account and saved records</p><p className="mt-1 text-xs">This is separate from clearing this browser and cannot be undone.</p></div><Button variant="destructive" disabled={accountActionsPaused} onClick={() => setAccountDeleteOpen(true)}>Delete account</Button></div>}</CardContent>
      </Card>
      <DeleteDialog busy={clearBusy} open={deleteOpen} onCancel={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <AlertDialog open={placeUploadOpen} onOpenChange={setPlaceUploadOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Upload local personal places?</AlertDialogTitle><AlertDialogDescription>This sends {pendingLocalPlaceCount} saved {pendingLocalPlaceCount === 1 ? 'place' : 'places'} to your account, including its label, address, and coordinates. Nothing is uploaded until you confirm here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={syncState === 'syncing'}>Cancel</Button></AlertDialogCancel><Button onClick={confirmPlaceUpload} disabled={accountActionsPaused || syncState === 'syncing'}>{syncState === 'syncing' ? 'Syncing…' : 'Confirm upload'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AccountDeleteDialog disabled={accountActionsPaused} open={accountDeleteOpen} busy={accountDeleteBusy} onCancel={() => setAccountDeleteOpen(false)} onConfirm={confirmAccountDelete} />
    </div>
  </div>;
}
