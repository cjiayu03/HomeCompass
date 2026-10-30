'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Globe2, LockKeyhole, Settings2, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberTicker } from '@/components/ui/number-ticker';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';
import { PlaceManager } from '@/components/place-manager';
import { requestJson } from '@/lib/api-client';

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
  const { shortlistIds, compareIds, clearLocalData, profileSyncState, retryProfileSync, flash, syncState, syncResult, syncGuestData, pendingLocalPlaceCount } = useWorkspace();
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

  return <div className="workspace-canvas min-h-[calc(100dvh-4rem)]">
    <div className="container flex max-w-[1120px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
      <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Settings2 className="size-3.5 text-primary" />Account</div><h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Your workspace, your settings.</h1><p className="mt-3 text-base leading-7 text-muted-foreground">Manage your password, personal places and browser data.</p></div>

      <div className="grid gap-5">

        {user && !sessionVerified && <Alert tone="warning" className="flex-wrap items-center justify-between gap-3"><p>We couldn’t verify your session. Account changes are paused until we can confirm who is signed in.</p><Button variant="outline" size="sm" disabled={sessionRetryBusy || transitioning} onClick={retrySessionCheck}>{sessionRetryBusy ? 'Checking session…' : 'Retry session check'}</Button></Alert>}

        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>Account</CardTitle><p className="mt-1 text-sm text-muted-foreground">{user ? user.email : 'Sign in to sync saved source records across devices.'}</p></div><Badge variant="secondary">{user ? (accountActionsPaused ? 'Session not verified' : 'Signed in') : 'Guest'}</Badge></div></CardHeader>
          <CardContent><div className="grid grid-cols-2 gap-3"><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={shortlistIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">saved homes</p></div><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={compareIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">in comparison</p></div></div><Alert tone="info" className="mt-4 text-xs leading-5">{user ? 'Your saved homes and decision notes can sync across devices. Viewing photos stay in this browser.' : 'Sign in to sync your saved homes and preferences. Guest choices remain in this browser.'}</Alert>
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

      <fieldset className="contents" disabled={Boolean(user) && accountActionsPaused}><PlaceManager key={ownerIdentity} /></fieldset>

      {user && <Card><CardHeader><CardTitle>Change password</CardTitle><p className="text-sm text-muted-foreground">Choose a new password with at least 8 characters.</p></CardHeader><CardContent><form method="post" className="grid gap-4 sm:grid-cols-3" onSubmit={changePassword}><fieldset className="contents" disabled={accountActionsPaused || passwordBusy}><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Current password</span><Input ref={currentPasswordRef} type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">New password</span><Input type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm new password</span><Input type={showPasswords ? 'text' : 'password'} maxLength={128} autoComplete="new-password" minLength={8} ref={confirmPasswordRef} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={showPasswords} onChange={event=>setShowPasswords(event.target.checked)}/>Show passwords</label><div className="flex flex-wrap items-center gap-3 sm:col-span-3">{passwordMessage && <Alert tone={passwordMessage.tone} className="text-xs">{passwordMessage.text}</Alert>}<Button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</Button></div></fieldset></form></CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Data and privacy</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2"><p className="flex gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />You can change your password here or request a reset link from the sign-in page. Email delivery must be configured by the app operator.</p><p className="flex gap-2"><Globe2 className="mt-0.5 size-4 shrink-0 text-primary" />Government records are dated comparison evidence, not live listing availability.</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />OpenStreetMap tiles include visible attribution.</p><div className="flex items-center justify-between gap-4 sm:col-span-2"><div><p className="font-semibold text-foreground">Clear local data</p><p className="mt-1 text-xs">Remove searches, preferences, choices, decision notes and photos from this browser. Account data stays on the server.</p></div><Button variant="outline" onClick={() => setDeleteOpen(true)}>Clear this browser</Button></div>{user && <div className="flex items-center justify-between gap-4 border-t pt-4 sm:col-span-2"><div><p className="font-semibold text-destructive">Delete account and saved records</p><p className="mt-1 text-xs">This is separate from clearing this browser and cannot be undone.</p></div><Button variant="destructive" disabled={accountActionsPaused} onClick={() => setAccountDeleteOpen(true)}>Delete account</Button></div>}</CardContent>
      </Card>
      <DeleteDialog busy={clearBusy} open={deleteOpen} onCancel={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <AlertDialog open={placeUploadOpen} onOpenChange={setPlaceUploadOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Upload local personal places?</AlertDialogTitle><AlertDialogDescription>This sends {pendingLocalPlaceCount} saved {pendingLocalPlaceCount === 1 ? 'place' : 'places'} to your account, including its label, address, and coordinates. Nothing is uploaded until you confirm here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={syncState === 'syncing'}>Cancel</Button></AlertDialogCancel><Button onClick={confirmPlaceUpload} disabled={accountActionsPaused || syncState === 'syncing'}>{syncState === 'syncing' ? 'Syncing…' : 'Confirm upload'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AccountDeleteDialog disabled={accountActionsPaused} open={accountDeleteOpen} busy={accountDeleteBusy} onCancel={() => setAccountDeleteOpen(false)} onConfirm={confirmAccountDelete} />
    </div>
  </div>;
}
