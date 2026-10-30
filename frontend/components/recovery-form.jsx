'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/auth-provider';
import { requestJson } from '@/lib/api-client';

export function RecoveryForm({ reset = false }) {
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[token,setToken]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[success,setSuccess]=useState(false);
 const errorRef=useRef(null);
 const initialized=useRef(false);
 const {refreshSession}=useAuth();
 useEffect(()=>{if(reset&&!initialized.current){initialized.current=true;setToken(new URLSearchParams(window.location.hash.slice(1)).get('token')||'');window.history.replaceState(null,'',window.location.pathname);}},[reset]);
 async function submit(event){event.preventDefault();setMessage('');setSuccess(false);if(reset&&password!==confirm){setMessage('Passwords do not match.');return;}setBusy(true);try{const result=await requestJson(`/api/v1/auth/${reset?'reset-password':'forgot-password'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reset?{token,password}:{email})});setSuccess(true);setMessage(reset?'Password updated. Sign in with your new password.':result.message);if(reset){setToken('');await refreshSession();}}catch(error){setMessage(error.message);}finally{setBusy(false);}}
 useEffect(()=>{if(message&&!success)errorRef.current?.focus();},[message,success]);
 return <Card><CardHeader><CardTitle>{reset?'Choose a new password':'Forgot your password?'}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{reset?'Reset links can be used once within 30 minutes. Changing your password ends all existing sessions.':'Enter your account email to request a single-use reset link.'}</p><form method="post" onSubmit={submit} className="space-y-4">{reset?<><label className="grid gap-2">New password<Input type={show?'text':'password'} autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="grid gap-2">Confirm new password<Input type={show?'text':'password'} autoComplete="new-password" minLength={8} maxLength={128} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>Show password</label></>:<label className="grid gap-2">Email<Input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}{message&&<div ref={errorRef} tabIndex={-1} role={success?'status':'alert'}><Alert tone={success?'success':'warning'}>{message}</Alert></div>}{reset&&!token&&!success&&<p role="alert" className="text-sm">Open the complete link from your email, or <Link href="/forgot-password" className="underline">request a new link</Link>.</p>}<Button type="submit" disabled={busy||(reset&&(!token||success))}>{busy?'Working…':reset?'Reset password':'Request reset link'}</Button></form><Link href="/login" className="inline-block text-sm underline">Back to sign in</Link></CardContent></Card>;
}
