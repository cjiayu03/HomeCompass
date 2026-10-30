import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../components/auth-provider';
import { RecoveryForm } from '../components/recovery-form';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses POST for recovery and reset credential forms',()=>{render(<AuthProvider><RecoveryForm/></AuthProvider>);expect(document.querySelector('form')).toHaveAttribute('method','post');cleanup();window.history.replaceState(null,'','/');window.history.replaceState(null,'','/reset-password#token='+'a'.repeat(43));render(<AuthProvider><RecoveryForm reset/></AuthProvider>);expect(document.querySelector('form')).toHaveAttribute('method','post');});
function Probe(){ const {user,signOut}=useAuth();return <><span>{user?.email}</span><button onClick={()=>signOut().catch(()=>{})}>Sign out</button></>; }
it('retains authentication when logout fails', async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path)=>new Response(JSON.stringify(path.endsWith('/session')?{user:{id:'u',email:'a@example.com'}}:{detail:{message:'offline'}}),{status:path.endsWith('/session')?200:503})));
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('a@example.com');fireEvent.click(screen.getByText('Sign out'));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));expect(screen.getByText('a@example.com')).toBeInTheDocument();
});
it('shows unavailable delivery without claiming email sent', async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({detail:{message:'Password recovery is unavailable. Email delivery has not been configured.'}}),{status:503})));
 render(<AuthProvider><RecoveryForm/></AuthProvider>);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'a@example.com'}});fireEvent.click(screen.getByRole('button',{name:'Request reset link'}));expect(await screen.findByRole('alert')).toHaveTextContent('has not been configured');expect(screen.queryByText(/email sent/i)).toBeNull();
});

it('keeps a fragment reset token through React strict effects and removes it from the address',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({user:null}))));window.history.replaceState(null,'','/reset-password#token='+'a'.repeat(43));render(<StrictMode><AuthProvider><RecoveryForm reset/></AuthProvider></StrictMode>);await waitFor(()=>expect(screen.getByRole('button',{name:'Reset password'})).toBeEnabled());expect(window.location.hash).toBe('');});

it('refreshes authenticated browser state after a successful password reset',async()=>{let reset=false;vi.stubGlobal('fetch',vi.fn(async(path)=>{if(path.endsWith('/reset-password')){reset=true;return new Response(JSON.stringify({ok:true}));}return new Response(JSON.stringify({user:reset?null:{id:'u',email:'me@example.com'}}));}));window.history.replaceState(null,'','/reset-password#token='+'a'.repeat(43));render(<AuthProvider><Probe/><RecoveryForm reset/></AuthProvider>);await screen.findByText('me@example.com');fireEvent.change(screen.getByLabelText('New password'),{target:{value:'new-password'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'new-password'}});fireEvent.click(screen.getByRole('button',{name:'Reset password'}));await screen.findByText('Password updated. Sign in with your new password.');await waitFor(()=>expect(screen.queryByText('me@example.com')).toBeNull());});
