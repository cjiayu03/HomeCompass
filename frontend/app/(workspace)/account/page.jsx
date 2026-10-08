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
import { useWorkspace } from '@/components/workspace-provider';
import { useAuth } from '@/components/auth-provider';

function DeleteDialog({ open, onCancel, onConfirm }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Clear this local workspace?</AlertDialogTitle><AlertDialogDescription>This clears the shortlist and comparison selection from this browser. It does not delete any server account.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline">Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" onClick={onConfirm}>Clear workspace</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function AccountDeleteDialog({ open, onCancel, onConfirm, busy }) {
  return <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}><AlertDialogContent><AlertDialogHeader><div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></div><AlertDialogTitle>Delete your account?</AlertDialogTitle><AlertDialogDescription>This removes your saved application records and asks Supabase to delete the identity. This cannot be undone. If the identity provider is temporarily unavailable, the app will show that and let you retry.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></AlertDialogCancel><AlertDialogAction asChild><Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete account'}</Button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

export default function AccountPage() {
  const { shortlistIds, compareIds, setShortlistIds, setCompareIds, flash } = useWorkspace();
  const { client, user, configured } = useAuth();
  const [language, setLanguage] = useState('en');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountDeleteBusy, setAccountDeleteBusy] = useState(false);
  const router = useRouter();
  function confirmDelete() { setDeleteOpen(false); setShortlistIds([]); setCompareIds([]); flash('Local shortlist and comparison cleared.', 'success'); }

  async function confirmAccountDelete() {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
    if (!client) { flash('Account deletion is not configured. No server account data was removed.', 'warning'); return; }
    setAccountDeleteBusy(true);
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail?.message || 'Account deletion could not be completed.');
      await client.auth.signOut({ scope: 'local' });
      setShortlistIds([]);
      setCompareIds([]);
      setAccountDeleteOpen(false);
      router.replace('/');
    } catch (error) {
      flash(error.message || 'Account deletion could not be completed.', 'error');
    } finally {
      setAccountDeleteBusy(false);
    }
  }

  return <div className="workspace-canvas min-h-[calc(100dvh-4rem)]">
    <div className="container flex max-w-[1120px] flex-col gap-7 px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
      <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Settings2 className="size-3.5 text-primary" />Account</div><h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Your workspace, your settings.</h1><p className="mt-3 text-base leading-7 text-muted-foreground">Choose a display language and manage the places saved in this browser.</p></div>

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader><CardTitle>Language</CardTitle><p className="text-sm text-muted-foreground">English is available now. Other languages will appear after translation review.</p></CardHeader>
          <CardContent><label className="flex flex-col gap-2"><span className="text-xs font-semibold">Display language</span><select name="language" className="h-11 w-full rounded-xl border border-white/50 bg-background/50 px-3 text-sm backdrop-blur-xl dark:border-white/10" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="zh" disabled>Chinese · translation review pending</option><option value="ms" disabled>Malay · translation review pending</option><option value="ta" disabled>Tamil · translation review pending</option></select></label></CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle>Account</CardTitle><p className="mt-1 text-sm text-muted-foreground">{user ? user.email : 'Sign in to sync saved source records across devices.'}</p></div><Badge variant="secondary">{user ? 'Signed in' : configured ? 'Guest' : 'Auth not configured'}</Badge></div></CardHeader>
          <CardContent><div className="grid grid-cols-2 gap-3"><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={shortlistIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">saved places</p></div><div className="glass-card rounded-xl p-4"><p className="font-display text-3xl font-semibold"><NumberTicker value={compareIds.length} /></p><p className="mt-1 text-xs text-muted-foreground">in comparison</p></div></div><Alert tone="info" className="mt-4 text-xs leading-5">{user ? 'Email/password and Google sign-in are managed by Supabase. The application database stores your profile and saved records, not your password.' : 'Account creation and sign-in are on their own pages. Guest choices remain in this browser.'}</Alert></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Data and privacy</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2"><p className="flex gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />Passwords are handled by Supabase Auth and are not stored by the application database.</p><p className="flex gap-2"><Globe2 className="mt-0.5 size-4 shrink-0 text-primary" />Government records are dated comparison evidence, not live listing availability.</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />OpenStreetMap tiles include visible attribution.</p><div className="flex items-center justify-between gap-4 sm:col-span-2"><div><p className="font-semibold text-foreground">Clear local data</p><p className="mt-1 text-xs">Remove saved places and comparison choices from this browser only.</p></div><Button variant="outline" onClick={() => setDeleteOpen(true)}>Clear this browser</Button></div>{user && <div className="flex items-center justify-between gap-4 border-t pt-4 sm:col-span-2"><div><p className="font-semibold text-destructive">Delete account and saved records</p><p className="mt-1 text-xs">This is separate from clearing this browser and cannot be undone.</p></div><Button variant="destructive" onClick={() => setAccountDeleteOpen(true)}>Delete account</Button></div>}</CardContent>
      </Card>
      <DeleteDialog open={deleteOpen} onCancel={() => setDeleteOpen(false)} onConfirm={confirmDelete} />
      <AccountDeleteDialog open={accountDeleteOpen} busy={accountDeleteBusy} onCancel={() => setAccountDeleteOpen(false)} onConfirm={confirmAccountDelete} />
    </div>
  </div>;
}
