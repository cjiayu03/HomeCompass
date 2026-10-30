'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { requestJson } from '@/lib/api-client';

const Context = createContext(null);
const empty = { scenarios: [], decisions: {}, revision: 0 };

function photoStore(action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('homecompass-viewing-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
    request.onerror = () => reject(new Error('Photo storage is unavailable in this browser.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('photos', 'readwrite');
      const req = action(tx.objectStore('photos'));
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(new Error('Could not save the photo. Browser storage may be full.')); };
    };
  });
}

function PlanningOwner({ owner, signedIn, children }) {
  const key = `homecompass-planning:${owner}`;
  const [workspace, setWorkspace] = useState(empty);
  const [photos, setPhotos] = useState({});
  const [ready, setReady] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [onlineReady, setOnlineReady] = useState(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const active = useRef(true);
  const generation = useRef(0);
  const current = useRef(empty);
  const pending = useRef(false);
  const photoRef = useRef({});
  const inFlight = useRef(false);
  const requestSequence = useRef(0);
  const clearVersion = useRef(0);
  const authPaused = useRef(!signedIn);
  const controllers = useRef(new Set());

  const refresh = useCallback(async (replace = false) => {
    if (!signedIn || authPaused.current) return;
    active.current = true;
    setCleared(false);
    setReady(true);
    const sequence=++requestSequence.current;
    setError('');
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const remote = await requestJson('/api/v1/planning/workspace', { signal: controller.signal });
      if (!active.current || sequence!==requestSequence.current) return;
      if (replace || !pending.current) {
        current.current = remote;
        setWorkspace(remote);
        pending.current = false;
        setDirty(false);
      } else if (remote.revision !== current.current.revision) {
        setStatus('conflict');
        setError('This plan changed in another session. Your edits remain in this browser. Load the account version to resolve the conflict.');
        setOnlineReady(false);
        return;
      }
      setOnlineReady(true);
      setStatus(pending.current ? 'pending' : 'saved');
    } catch (e) {
      if (controller.signal.aborted) return;
      if (active.current && sequence===requestSequence.current) { setStatus('offline'); setOnlineReady(false); setError(e.message); }
    } finally { controllers.current.delete(controller); }
  }, [signedIn]);

  useEffect(() => {
    active.current = true;
    authPaused.current = !signedIn;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached?.workspace && Array.isArray(cached.workspace.scenarios) && cached.workspace.decisions) {
        current.current = cached.workspace;
        pending.current = Boolean(cached.dirty);
        setWorkspace(cached.workspace);
        setDirty(Boolean(cached.dirty));
      }
    } catch { setError('Browser storage could not be read.'); }
    setReady(true);
    if (signedIn) refresh(); else setStatus('local');
    const loadVersion=clearVersion.current;
    photoStore(store => store.getAll()).then(rows => {
      if (!active.current || loadVersion!==clearVersion.current) return;
      const grouped = {};
      for (const row of rows.filter(row => row.owner === owner)) (grouped[row.homeId] ||= []).push(row);
      photoRef.current = grouped;
      setPhotos(grouped);
    }).catch(() => { /* Photos are optional; addPhoto reports failures. */ });
    return () => {
      active.current = false;
      authPaused.current = true;
      requestSequence.current+=1;
      controllers.current.forEach(controller => controller.abort());
    };
  }, [owner, key, signedIn, refresh]);

  useEffect(() => {
    const pause = event => {
      if (event.detail?.phase !== 'start') return;
      authPaused.current = true;
      requestSequence.current += 1;
      controllers.current.forEach(controller => controller.abort());
      setOnlineReady(false);
    };
    window.addEventListener('homecompass:auth-transition', pause);
    return () => window.removeEventListener('homecompass:auth-transition', pause);
  }, []);

  useEffect(() => {
    function clearBrowserPlan(event) {
      active.current = false;
      clearVersion.current += 1;
      requestSequence.current += 1;
      generation.current += 1;
      pending.current = false;
      current.current = empty;
      photoRef.current = {};
      setReady(false);
      setCleared(true);
      setDirty(false);
      setOnlineReady(false);
      setWorkspace(empty);
      setPhotos({});
      setError('');
      setStatus(signedIn ? 'cleared' : 'local');
      const cleanup = (async () => {
        for (const storageKey of Object.keys(localStorage)) {
          if (storageKey.startsWith('homecompass-planning:')) localStorage.removeItem(storageKey);
        }
        await photoStore(store => store.clear());
      })().catch(() => {
        const message = 'Browser photos could not be cleared. Use your browser’s site storage settings to remove them.';
        setError(message);
        throw new Error(message);
      });
      if (event.detail?.waitUntil) event.detail.waitUntil(cleanup);
      else cleanup.catch(() => {});
    }
    window.addEventListener('homecompass:clear-local-data', clearBrowserPlan);
    return () => window.removeEventListener('homecompass:clear-local-data', clearBrowserPlan);
  }, [signedIn]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify({ workspace, dirty })); }
    catch { setError('Browser storage is full. Keep this tab open and reconnect to save your edits.'); }
  }, [key, ready, workspace, dirty]);

  useEffect(() => {
    if (!ready || !signedIn || !onlineReady || !dirty) return;
    const timer = setTimeout(async () => {
      if(inFlight.current || authPaused.current)return;
      inFlight.current=true;
      const localGeneration=generation.current;
      const localRequestSequence=requestSequence.current;
      setStatus('saving');
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const saved = await requestJson('/api/v1/planning/workspace', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current.current),signal:controller.signal});
        if (!active.current || localRequestSequence!==requestSequence.current) return;
        current.current = { ...current.current, revision: saved.revision };
        setWorkspace(w => ({...w, revision:saved.revision}));
        if (generation.current === localGeneration) { pending.current = false; setDirty(false); setStatus('saved'); }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!active.current || localRequestSequence!==requestSequence.current) return;
        setError(e.status===409 ? 'This plan changed in another session. Your edits remain in this browser.' : e.message);
        setStatus(e.status===409 ? 'conflict' : 'offline');
        setOnlineReady(false);
      } finally {controllers.current.delete(controller);inFlight.current=false;}
    }, 700);
    return () => clearTimeout(timer);
  }, [ready, signedIn, onlineReady, dirty, workspace]);

  const mutate = useCallback(fn => {
    if (!ready && !cleared) return;
    if (cleared) { active.current=true; setReady(true); setCleared(false); }
    generation.current += 1;
    current.current = fn(current.current);
    pending.current = true;
    setWorkspace(current.current);
    setDirty(true);
    setStatus(previous => signedIn ? onlineReady ? 'pending' : previous==='conflict'?'conflict':'offline' : 'local');
  }, [ready, cleared, signedIn, onlineReady]);

  const updateDecision = useCallback((homeId, patch) => {
    if (!current.current.decisions[homeId] && Object.keys(current.current.decisions).length >= 100) {setError('This plan contains the maximum of 100 decision records.');return;}
    mutate(w => ({...w, decisions:{...w.decisions,[homeId]:{...w.decisions[homeId],...patch}}}));
  }, [mutate]);

  const saveScenario = useCallback((name, brief, weights) => {
    if (!name.trim()) throw new Error('Give the scenario a name.');
    if (current.current.scenarios.length >= 10) throw new Error('Keep up to ten scenarios. Delete one to save another.');
    const item = {id:crypto.randomUUID(),name:name.trim().slice(0,80),brief:structuredClone(brief),weights,createdAt:new Date().toISOString()};
    mutate(w=>({...w,scenarios:[...w.scenarios,item]}));
    return item;
  }, [mutate]);

  const addPhoto = useCallback(async (homeId, file) => {
    if (cleared) { active.current=true; setReady(true); setCleared(false); }
    const photoVersion=clearVersion.current;
    if (!['image/jpeg','image/png','image/webp'].includes(file?.type) || file.size > 5*1024*1024) throw new Error('Choose a JPG, PNG or WebP image up to 5 MB.');
    const existing = photoRef.current;
    if ((existing[homeId]?.length||0)>=6 || Object.values(existing).flat().length>=40) throw new Error('Photo limit reached (six per home, forty in this browser account).');
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    const isPng = [137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte);
    const isWebp = String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if (!({ 'image/jpeg': isJpeg, 'image/png': isPng, 'image/webp': isWebp })[file.type]) throw new Error('This file is not a valid JPG, PNG or WebP image.');
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be decoded. Choose a valid JPG, PNG or WebP.'); }
    if (bitmap.width * bitmap.height > 40000000) { bitmap.close(); throw new Error('Choose an image smaller than 40 megapixels.'); }
    const canvas = document.createElement('canvas');
    const factor = Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*factor)); canvas.height=Math.max(1,Math.round(bitmap.height*factor));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg',0.78);
    const row = {id:crypto.randomUUID(),owner,homeId,name:file.name.slice(0,120),dataUrl};
    if(!active.current || photoVersion!==clearVersion.current) return;
    await photoStore(store=>store.put(row));
    if(active.current && photoVersion===clearVersion.current) { photoRef.current={...photoRef.current,[homeId]:[...(photoRef.current[homeId]||[]),row]}; setPhotos(photoRef.current); }
  }, [owner, cleared]);
  const removePhoto = useCallback(async(homeId,id)=>{
    if(!(photoRef.current[homeId]||[]).some(p=>p.id===id)) return;
    await photoStore(store=>store.delete(id));
    if(active.current) { photoRef.current={...photoRef.current,[homeId]:(photoRef.current[homeId]||[]).filter(p=>p.id!==id)}; setPhotos(photoRef.current); }
  },[]);

  return <Context.Provider value={{...workspace,photos,updateDecision,saveScenario,deleteScenario:id=>{if(window.confirm('Delete this saved scenario?'))mutate(w=>({...w,scenarios:w.scenarios.filter(s=>s.id!==id)}));},status,error,ready:ready||cleared,retry:()=>refresh(),reloadRemote:()=>refresh(true),addPhoto,removePhoto}}>{children}</Context.Provider>;
}

export function PlanningProvider({children}) {
  const {user,loading,transitioning=false,sessionVerified=true}=useAuth();
  const owner=user?.id||'guest';
  return <PlanningOwner key={owner} owner={owner} signedIn={Boolean(user)&&!loading&&!transitioning&&sessionVerified}>{children}</PlanningOwner>;
}
export function usePlanning(){ const value=useContext(Context); if(!value)throw new Error('PlanningProvider is required');return value; }
