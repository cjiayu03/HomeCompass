'use client';

import { useState } from 'react';
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
import { SavedDecisionSections } from '@/components/saved-searches';
import { requestJson } from '@/lib/api-client';

function DeleteDialog({ open, onCancel, onConfirm }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Clear this local workspace?</AlertDialogTitle><AlertDialogDescription>This clears the shortlist and comparison selection from this browser. It does not delete any server account.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" onClick={onConfirm}>Clear workspace</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function AccountDeleteDialog({ open, onCancel, onConfirm, busy }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Delete your account?</AlertDialogTitle><AlertDialogDescription>This permanently removes your local account, saved records, and active sessions. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete account'}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
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
  const { shortlistIds, compareIds, setShortlistIds, setCompareIds, setBrief, flash, syncState, syncResult, syncGuestData, pendingLocalPlaceCount } = useWorkspace();
  const { user, refreshSession } = useAuth();
  const ownerIdentity = user?.id ? `account:${user.id}` : 'guest';
  const [language, setLanguage] = useState('en');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [placeUploadOpen, setPlaceUploadOpen] = useState(false);
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountDeleteBusy, setAccountDeleteBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);
  const router = useRouter();
  const acceptedCount = syncSectionCount(syncResult?.accepted);
  const skippedCount = syncSectionCount(syncResult?.skipped);
  const skippedHistoryCount = syncValueCount(syncResult?.skipped?.history);
  const retryableHistoryCount = syncValueCount(syncResult?.skipped?.retryableHistoryIndexes);
  const syncCanRetry = syncState === 'error' || retryableHistoryCount > 0;
  const conflictFields = (syncResult?.conflicts || []).map((conflict) => conflict.field).filter(Boolean);
  function confirmDelete() { setDeleteOpen(false); setShortlistIds([]); setCompareIds([]); flash('Local shortlist and comparison cleared.', 'success'); }

  async function confirmPlaceUpload() {
    const result = await syncGuestData({ confirmPlaces: true });
    if (result?.ok) setPlaceUploadOpen(false);
  }

  async function confirmAccountDelete() {
    setAccountDeleteBusy(true);
    try {
      await requestJson('/api/v1/account', { method: 'DELETE' });
      setShortlistIds([]);
      setCompareIds([]);
      setBrief((current) => ({ ...current, placeConstraints: [] }));
      setAccountDeleteOpen(false);
      await refreshSession();
      router.replace('/');
    } catch (error) {
      flash(error.message || 'Account deletion could not be completed.', 'error');
    } finally {
      setAccountDeleteBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ tone: 'warning', text: 'The new passwords do not match.' });
      return;
    }
    setPasswordBusy(true);
    try {
      await requestJson('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ tone: 'success', text: 'Password updated. Other signed-in sessions have been ended.' });
    } catch (error) {
      setPasswordMessage({ tone: 'warning', text: error.message || 'Password could not be updated.' });
    } finally {
      setPasswordBusy(false);
    }
  }

  return <div className="workspace-canvas min-h-[calc(100dvh-4rem)]">
    <div className="container flex max-w-[1120px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
      <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Settings2 className="size-3.5 text-primary" />Account</div><h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Your workspace, your settings.</h1><p className="mt-3 text-base leading-7 text-muted-foreground">Choose a display language and manage the places saved with your account.</p></div>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader><CardTitle>Language</CardTitle><p className="text-sm text-muted-foreground">English is available now. Other languages will appear after translation review.</p></CardHeader>
          <CardContent><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Display language</span><select name="language" className="h-11 w-full rounded-xl border border-white/50 bg-background/50 px-3 text-sm backdrop-blur-xl dark:border-white/10" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="zh" disabled>Chinese · translation review pending</option><option value="ms" disabled>Malay · translation review pending</option><option value="ta" disabled>Tamil · translation review pending</option></select></label></CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>Account</CardTitle><p className="mt-1 text-sm text-muted-foreground">{user ? user.email : 'Sign in to sync saved source records across devices.'}</p></div><Badge variant="secondary">{user ? 'Signed in' : 'Guest'}</Badge></div></CardHeader>
          <CardContent><div className="grid grid-cols-2 gap-3"><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={shortlistIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">saved homes</p></div><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={compareIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">in comparison</p></div></div><Alert tone="info" className="mt-4 text-xs leading-5">{user ? 'Your account and saved records are stored by this app. Passwords are stored as one-way Argon2id hashes.' : 'Account creation and sign-in are on their own pages. Guest choices remain in this browser.'}</Alert>
            <Alert tone={syncState === 'error' ? 'warning' : syncState === 'synced' ? 'success' : 'info'} className="mt-3 flex-col text-xs leading-5">
              <p>Guest data sync: {syncState}.</p>
              {syncResult && <p>{acceptedCount} accepted · {skippedCount} skipped · {conflictFields.length} conflicts.</p>}
              {skippedHistoryCount > 0 && retryableHistoryCount > 0 && <p>Skipped search history remains saved in this browser and can be retried.</p>}
              {conflictFields.length > 0 && <p>Account values were kept for: {conflictFields.join(', ')}.</p>}
              {pendingLocalPlaceCount > 0 && <p>{pendingLocalPlaceCount} local personal {pendingLocalPlaceCount === 1 ? 'place is' : 'places are'} still on this browser until you confirm an upload.</p>}
            </Alert>
            {user && syncCanRetry && <Button className="mt-3" variant="outline" disabled={syncState === 'syncing'} onClick={() => syncGuestData()}>Retry account sync</Button>}
            {user && pendingLocalPlaceCount > 0 && <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3"><p className="text-xs text-muted-foreground">Local saved places include personal location details.</p><Button size="sm" variant="outline" onClick={() => setPlaceUploadOpen(true)}>Review upload</Button></div>}
          </CardContent>
        </Card>
      </div>

      <PlaceManager key={ownerIdentity} />
      <SavedDecisionSections />

      {user && <Card><CardHeader><CardTitle>Change password</CardTitle><p className="text-sm text-muted-foreground">Choose a new password with at least 8 characters.</p></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-3" onSubmit={changePassword}><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Current password</span><Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">New password</span><Input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Confirm new password</span><Input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><div className="flex items-center gap-3 sm:col-span-3">{passwordMessage && <Alert tone={passwordMessage.tone} className="text-xs">{passwordMessage.text}</Alert>}<Button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</Button></div></form></CardContent></Card>}

      <Card>
        <CardHeader><CardTitle>Data and privacy</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2"><p className="flex gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />Passwords are stored as one-way Argon2id hashes in the local application database. Password recovery requires an operator reset.</p><p className="flex gap-2"><Globe2 className="mt-0.5 size-4 shrink-0 text-primary" />Government records are dated comparison evidence, not live listing availability.</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />OpenStreetMap tiles include visible attribution.</p><div className="flex items-center justify-between gap-4 sm:col-span-2"><div><p className="font-semibold text-foreground">Clear local data</p><p className="mt-1 text-xs">Remove saved home and comparison choices from this browser only.</p></div><Button variant="outline" onClick={() => setDeleteOpen(true)}>Clear this browser</Button></div>{user && <div className="flex items-center justify-between gap-4 border-t pt-4 sm:col-span-2"><div><p className="font-semibold text-destructive">Delete account and saved records</p><p className="mt-1 text-xs">This is separate from clearing this browser and cannot be undone.</p></div><Button variant="destructive" onClick={() => setAccountDeleteOpen(true)}>Delete account</Button></div>}</CardContent>
      </Card>
      <DeleteDialog open={deleteOpen} onCancel={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <AlertDialog open={placeUploadOpen} onOpenChange={setPlaceUploadOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Upload local personal places?</AlertDialogTitle><AlertDialogDescription>This sends {pendingLocalPlaceCount} saved {pendingLocalPlaceCount === 1 ? 'place' : 'places'} to your account, including its label, address, and coordinates. Nothing is uploaded until you confirm here.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={syncState === 'syncing'}>Cancel</Button></AlertDialogCancel><Button onClick={confirmPlaceUpload} disabled={syncState === 'syncing'}>{syncState === 'syncing' ? 'Syncing…' : 'Confirm upload'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AccountDeleteDialog open={accountDeleteOpen} busy={accountDeleteBusy} onCancel={() => setAccountDeleteOpen(false)} onConfirm={confirmAccountDelete} />
    </div>
  </div>;
}
