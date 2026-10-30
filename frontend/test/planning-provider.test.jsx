import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanningProvider, usePlanning } from '../components/planning-provider';
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn(() => ({ user: null, loading: false })) }));
vi.mock('../components/auth-provider',()=>({useAuth:authMock}));
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();authMock.mockReturnValue({user:null,loading:false});});
function Probe(){const planning=usePlanning();return <><span data-testid="count">{Object.keys(planning.decisions).length}</span><button onClick={()=>planning.updateDecision('home-a',{notes:'Private note'})}>Add note</button><button onClick={()=>planning.addPhoto('home-a',{type:'image/png',size:42,slice:()=>({arrayBuffer:async()=>new Uint8Array([60,115,118,103]).buffer})}).catch(e=>{document.getElementById('photo-error').textContent=e.message;})}>Add invalid photo</button><p id="photo-error"/></>;}
it('rejects an image with spoofed MIME type before decoding or persisting',async()=>{vi.stubGlobal('createImageBitmap',vi.fn());render(<PlanningProvider><Probe/></PlanningProvider>);fireEvent.click(screen.getByText('Add invalid photo'));await waitFor(()=>expect(document.getElementById('photo-error')).toHaveTextContent('not a valid'));expect(createImageBitmap).not.toHaveBeenCalled();});
it('clears plan caches and visible notes without deleting server data',async()=>{vi.stubGlobal('fetch',vi.fn());render(<PlanningProvider><Probe/></PlanningProvider>);fireEvent.click(screen.getByText('Add note'));await waitFor(()=>expect(screen.getByTestId('count')).toHaveTextContent('1'));fireEvent(window,new CustomEvent('homecompass:clear-local-data'));await waitFor(()=>expect(screen.getByTestId('count')).toHaveTextContent('0'));expect(localStorage.getItem('homecompass-planning:guest')).toBeNull();expect(fetch).not.toHaveBeenCalled();});

it('keeps account A draft planning local while ownership is unverified and loads B separately', async () => {
  const accountA = { user: { id: 'a' }, loading: false, sessionVerified: false };
  authMock.mockReturnValue(accountA);
  const draft = { scenarios: [], decisions: { 'private-a': { notes: 'Account A draft' } }, revision: 0 };
  localStorage.setItem('homecompass-planning:a', JSON.stringify({ workspace: draft, dirty: true }));
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ scenarios: [], decisions: {}, revision: 0 })));
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<PlanningProvider><Probe /></PlanningProvider>);
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  await act(() => new Promise(resolve => setTimeout(resolve, 750)));
  expect(fetchMock).not.toHaveBeenCalled();
  authMock.mockReturnValue({ user: { id: 'b' }, loading: false, sessionVerified: true });
  view.rerender(<PlanningProvider><Probe /></PlanningProvider>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
  expect(fetchMock.mock.calls.every(([, options = {}]) => options.method !== 'PUT')).toBe(true);
  expect(JSON.parse(localStorage.getItem('homecompass-planning:a')).workspace).toEqual(draft);
  expect(JSON.parse(localStorage.getItem('homecompass-planning:b')).workspace.decisions).toEqual({});
});

it('aborts an old planning read on account transition and ignores its late result', async () => {
  let release;
  let signal;
  const response = new Promise(resolve => { release = resolve; });
  vi.stubGlobal('fetch', vi.fn((_path, options) => { signal = options.signal; return response; }));
  authMock.mockReturnValue({ user: { id: 'a' }, loading: false, sessionVerified: true });
  const view = render(<PlanningProvider><Probe /></PlanningProvider>);
  await waitFor(() => expect(signal).toBeDefined());
  act(() => {
    fireEvent(window, new CustomEvent('homecompass:auth-transition', { detail: { phase: 'start' } }));
    authMock.mockReturnValue({ user: { id: 'a' }, loading: false, transitioning: true, sessionVerified: false });
    view.rerender(<PlanningProvider><Probe /></PlanningProvider>);
  });
  expect(signal.aborted).toBe(true);
  await act(async () => { release(new Response(JSON.stringify({ scenarios: [], decisions: { 'wrong-owner': { notes: 'Do not install' } }, revision: 4 }))); });
  expect(screen.getByTestId('count')).toHaveTextContent('0');
  expect(JSON.parse(localStorage.getItem('homecompass-planning:a')).workspace.decisions).toEqual({});
});
