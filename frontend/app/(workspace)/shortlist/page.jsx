'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, Check, CircleAlert, ListFilter, Search, StickyNote, X } from 'lucide-react';
import { CandidateDetails } from '@/components/candidate-details';
import { ComparisonAction } from '@/components/comparison-action';
import { ComparisonWorkspace } from '@/components/comparison-workspace';
import { setAssistantOpen } from '@/lib/assistant-state';
import { HousingChat } from '@/components/housing-chat';
import { LoadingScene } from '@/components/loading-scene';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWorkspace } from '@/components/workspace-provider';
import { usePlanning } from '@/components/planning-provider';
import { useAuth } from '@/components/auth-provider';
import { money } from '@/lib/utils';
import './saved.css';

const SavedDecisionEditor = dynamic(() => import('@/components/decision-board').then(module => module.SavedDecisionEditor), { loading: () => <LoadingScene label="Opening viewing plan…" /> });
const stages = [
  { key: 'research', label: 'Researching' }, { key: 'visit', label: 'Plan a visit' },
  { key: 'considering', label: 'Considering' }, { key: 'ruled-out', label: 'Ruled out' },
];
const stageFor = decision => stages.some(stage => stage.key === decision?.status) ? decision.status : 'research';

export default function ShortlistPage() {
  const workspace = useWorkspace();
  const { shortlistHomes, shortlistIds, selectedHomes, ensureSaved, toggleShortlist, reorderShortlist, toggleCompare, appliedBrief, brief, workspaceReady } = workspace;
  const { decisions = {}, photos = {}, updateDecision, ready, status: planStatus, error: planError, retry, reloadRemote } = usePlanning();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [sort, setSort] = useState('manual');
  const [grouped, setGrouped] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState('details');
  const [compareOpen, setCompareOpen] = useState(false);
  const [pendingRemovals, setPendingRemovals] = useState([]);
  const [moving, setMoving] = useState(false);
  const panelRef = useRef(null);
  const opener = useRef(null);
  const headingRef = useRef(null);
  const detail = shortlistHomes.find(home => home.id === detailId);
  const ordered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return shortlistHomes.filter(home => (stage === 'all' || stageFor(decisions[home.id]) === stage)
      && (!text || `${home.address} ${home.town} ${home.type} ${decisions[home.id]?.notes || ''}`.toLocaleLowerCase().includes(text)))
      .sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === 'score' ? (b.score ?? -Infinity) - (a.score ?? -Infinity) : shortlistIds.indexOf(a.id) - shortlistIds.indexOf(b.id));
  }, [shortlistHomes, shortlistIds, decisions, query, stage, sort]);
  const groups = stages.map(item => ({ ...item, homes: ordered.filter(home => stageFor(decisions[home.id]) === item.key) })).filter(item => item.homes.length);
  const counts = Object.fromEntries(stages.map(item => [item.key, shortlistHomes.filter(home => stageFor(decisions[home.id]) === item.key).length]));
  const canReorder = sort === 'reorder' && !query.trim() && stage === 'all' && !grouped;

  function inspect(home, tab, event) {
    if (event?.currentTarget) opener.current = event.currentTarget;
    setDetailId(home.id); setDetailTab(tab);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }
  function closeDetail() {
    setDetailId(null);
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : headingRef.current)?.focus({ preventScroll: true }));
  }
  useEffect(() => {
    if (!detailId) return;
    function escape(event) { if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) closeDetail(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [detailId]);
  useEffect(() => { if (detailId && !detail) closeDetail(); }, [detailId, detail]);
  useEffect(() => { panelRef.current?.querySelector('.saved-detail-scroll')?.scrollTo?.({ top: 0 }); }, [detailId, detailTab]);

  async function remove(home) {
    if (pendingRemovals.includes(home.id)) return;
    setPendingRemovals(current => [...current, home.id]);
    try {
      const removed = ensureSaved ? await ensureSaved(home, false) : await toggleShortlist(home);
      if (removed === false) return;
      workspace.flash?.(`${home.address} removed from Saved.`, 'info', { label: 'Undo', onClick: async () => {
        const restored = ensureSaved ? await ensureSaved(home, true) : await toggleShortlist(home);
        if (restored !== false) workspace.flash?.('Home restored to Saved.', 'success');
      } });
    } finally { setPendingRemovals(current => current.filter(id => id !== home.id)); }
  }
  async function move(id, direction) {
    if (moving) return;
    const index = shortlistIds.indexOf(id), target = index + direction;
    if (index < 0 || target < 0 || target >= shortlistIds.length) return;
    const next = [...shortlistIds]; [next[index], next[target]] = [next[target], next[index]];
    setMoving(true); try { await reorderShortlist(next); } finally { setMoving(false); }
  }
  function resetFilters() { setQuery(''); setStage('all'); }
  const syncMessage = planStatus === 'saved' ? 'Notes synced' : planStatus === 'saving' || planStatus === 'pending' ? 'Syncing notes…' : planStatus === 'offline' ? 'Notes saved here · sync unavailable' : planStatus === 'conflict' ? 'Account plan changed · browser edits kept' : planStatus === 'cleared' ? 'Browser plan cleared · account plan kept' : user ? 'Account saves · browser-only photos' : 'Saved in this browser';

  function row(home) {
    const selected = selectedHomes.some(item => item.id === home.id);
    const decision = decisions[home.id] || {};
    const index = shortlistIds.indexOf(home.id);
    return <article key={home.id} className="saved-home" data-saved-home={home.id} data-active={detailId === home.id} data-compared={selected} aria-label={`Saved home: ${home.address}`}>
      <div className="saved-home-heading"><label className="saved-compare-check" title={selected ? 'Remove from comparison' : selectedHomes.length >= 3 ? 'Three homes selected. Uncheck one to choose another.' : 'Select 2–3 homes to compare'}><input type="checkbox" aria-label={`Compare ${home.address}`} checked={selected} disabled={!selected && selectedHomes.length >= 3} onChange={() => toggleCompare(home)} /><span className="sr-only">Compare {home.address}</span></label><button className="saved-home-address" aria-label={`Open details for ${home.address}`} onClick={event => inspect(home, 'details', event)}><strong>{home.address}</strong><span>{home.town} · {home.type}</span></button><div className="saved-home-price"><strong>{money(home.price)}</strong><span>Recorded {home.observedOn || home.transactionDate || 'date unavailable'}</span></div><Button className="saved-remove" variant="ghost" onClick={() => remove(home)} disabled={pendingRemovals.includes(home.id)} aria-label={`Remove ${home.address} from Saved`}><X aria-hidden="true" className="size-4" /><span>Remove</span></Button></div>
      <div className="saved-home-actions"><p className="saved-home-summary">{[home.floorAreaSqm != null && `${home.floorAreaSqm} m²`, home.remainingLeaseYears != null && `≈ ${home.remainingLeaseYears} years left`].filter(Boolean).join(' · ')}</p><label className="saved-stage"><span className="sr-only">Stage</span><select value={stageFor(decision)} disabled={!ready} aria-label={`Decision status for ${home.address}`} onChange={event => updateDecision(home.id, { status: event.target.value })}>{stages.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><Button variant="ghost" onClick={event => inspect(home, 'details', event)}>Details <ArrowRight aria-hidden="true" className="size-4" /></Button></div>
      <label className="saved-note"><StickyNote aria-hidden="true" className="size-4" /><span className="sr-only">Household notes for {home.address}</span><textarea rows={1} maxLength={4000} disabled={!ready} placeholder="Add a note — what stands out?" aria-label={`Household notes for ${home.address}`} value={decision.notes || ''} onChange={event => updateDecision(home.id, { notes: event.target.value })} /></label>
      {canReorder && <div className="saved-home-footer"><div className="saved-reorder"><span>Order {index + 1}</span><Button variant="ghost" size="icon" aria-label={`Move ${home.address} up`} title="Move up" disabled={moving || index === 0} onClick={() => move(home.id, -1)}><ArrowUp aria-hidden="true" className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={`Move ${home.address} down`} title="Move down" disabled={moving || index === shortlistIds.length - 1} onClick={() => move(home.id, 1)}><ArrowDown aria-hidden="true" className="size-4" /></Button></div></div>}

    </article>;
  }

  if (compareOpen) return <ComparisonWorkspace homes={selectedHomes} onRemove={toggleCompare} availableHomes={shortlistHomes.filter(home => !selectedHomes.some(selected => selected.id === home.id))} onAdd={toggleCompare} brief={appliedBrief || brief} decisions={decisions} photos={photos} user={user} workspaceReady={workspaceReady !== false} onClose={() => setCompareOpen(false)} backLabel="Back to saved homes" />;
  return <div className="saved-desk">
    <header className="saved-heading"><div><h1 ref={headingRef} tabIndex={-1}><Bookmark aria-hidden="true" />Saved homes <span>{shortlistHomes.length}</span></h1></div><Button asChild variant="outline"><Link href="/explore">Explore more <ArrowRight aria-hidden="true" className="size-4" /></Link></Button></header>
    {!compareOpen && <HousingChat context="saved" user={user} homes={detail ? [detail] : ordered.slice(0, 3)} selectedHome={detail} brief={appliedBrief || brief} workspaceReady={workspaceReady !== false} />}

    <div className="saved-command-bar"><div className="saved-tools"><label className="saved-search"><Search aria-hidden="true" className="size-4" /><input type="search" placeholder="Find a saved home or note" aria-label="Search saved homes" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear saved search" onClick={() => setQuery('')}><X aria-hidden="true" className="size-4" /></button>}</label><label className="saved-sort"><span className="sr-only">Sort</span><select aria-label="Sort saved homes" value={sort} onChange={event => setSort(event.target.value)}><option value="manual">Your order</option><option value="price">Lowest price</option><option value="score">Source score</option><option value="reorder">Reorder homes</option></select></label><Button className="saved-group-toggle" variant={grouped ? 'soft' : 'ghost'} aria-label="Group saved homes by stage" aria-pressed={grouped} onClick={() => setGrouped(value => !value)}><ListFilter aria-hidden="true" className="size-4" /><span>Group by stage</span></Button><div className="saved-compare-action"><span>Select 2–3 to compare</span><ComparisonAction homes={selectedHomes} onRemove={toggleCompare} onOpen={() => { setAssistantOpen(true); setCompareOpen(true); }} /></div></div><div className="saved-stage-filters" role="group" aria-label="Filter saved homes by stage">{[{ key: 'all', label: 'All homes' }, ...stages].map(item => <button key={item.key} type="button" aria-pressed={stage === item.key} onClick={() => setStage(item.key)}>{item.label}<span>{item.key === 'all' ? shortlistHomes.length : counts[item.key]}</span></button>)}</div></div>
    <div className="saved-context"><p>Historical transactions, not live listings.</p><div aria-live="polite">{['offline', 'conflict'].includes(planStatus) ? <CircleAlert aria-hidden="true" className="size-3.5" /> : <Check aria-hidden="true" className="size-3.5" />}{syncMessage}{(planStatus === 'offline' || planStatus === 'conflict') && <button onClick={retry}>Retry sync</button>}{planStatus === 'conflict' && <button onClick={() => { if (window.confirm('Replace unsynced browser edits with the account version?')) reloadRemote?.(); }}>Load account version</button>}{planStatus === 'cleared' && <button onClick={() => reloadRemote?.()}>Load account plan</button>}</div></div>
    {planError && <p className="saved-plan-error" role="alert">{typeof planError === 'string' ? planError : planError.message}</p>}
    <div className="saved-layout" data-panel-open={Boolean(detail)}>
      <section className="saved-list" aria-label="Saved homes" aria-busy={workspaceReady === false}>
        {workspaceReady === false ? <div className="saved-loading" role="status">Loading your saved homes…</div> : !shortlistHomes.length ? <div className="saved-empty"><Bookmark aria-hidden="true" className="size-8" /><h2>Your shortlist starts here.</h2><p>Save homes in Explore. Come back to compare, add notes and plan a closer look.</p><Button asChild><Link href="/explore">Explore places <ArrowRight aria-hidden="true" className="size-4" /></Link></Button></div> : !ordered.length ? <div className="saved-empty"><Search aria-hidden="true" className="size-8" /><h2>No saved homes match.</h2><p>Your saves are still here. Try another name or clear the stage filter.</p><Button variant="outline" onClick={resetFilters}>Clear filters</Button></div> : grouped ? groups.map(group => <section className="saved-stage-group" key={group.key} aria-label={group.label}><h2>{group.label}<span>{group.homes.length}</span></h2>{group.homes.map(row)}</section>) : ordered.map(row)}
        {shortlistIds.length > shortlistHomes.length && <p className="saved-unavailable">{shortlistIds.length - shortlistHomes.length} saved record(s) could not be loaded. Your saved IDs are retained.</p>}
      </section>
      {detail && <aside className="saved-detail" ref={panelRef} tabIndex={-1} aria-labelledby="saved-detail-title" role="region"><header><div><p>{detail.town} · {detail.type}</p><h2 id="saved-detail-title">{detail.address}</h2></div><Button variant="ghost" size="icon" aria-label="Close saved home details" onClick={closeDetail}><X aria-hidden="true" className="size-4" /></Button></header><div className="saved-detail-tabs" role="group" aria-label="Saved home information"><Button variant={detailTab === 'details' ? 'soft' : 'ghost'} aria-pressed={detailTab === 'details'} onClick={() => setDetailTab('details')}>Home details</Button><Button variant={detailTab === 'plan' ? 'soft' : 'ghost'} aria-pressed={detailTab === 'plan'} onClick={() => setDetailTab('plan')}>Viewing plan</Button></div><div className="saved-detail-scroll">{detailTab === 'details' ? <CandidateDetails home={detail} homes={shortlistHomes} brief={appliedBrief || brief} saved selected={selectedHomes.some(home => home.id === detail.id)} onCompare={toggleCompare} onLocate={home => { window.location.href = `/explore?search=1&saved=1&view=map&detail=${encodeURIComponent(home.id)}`; }} /> : <SavedDecisionEditor key={detail.id} home={detail} />}</div><footer><Button variant="ghost" onClick={closeDetail}><ArrowLeft aria-hidden="true" className="size-4" />Back to saved</Button><div><Button variant="outline" size="icon" aria-label="Previous saved home" disabled={ordered.findIndex(home => home.id === detail.id) <= 0} onClick={() => { const i = ordered.findIndex(home => home.id === detail.id); if (i > 0) inspect(ordered[i - 1], detailTab); }}><ArrowUp aria-hidden="true" className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Next saved home" disabled={ordered.findIndex(home => home.id === detail.id) < 0 || ordered.findIndex(home => home.id === detail.id) >= ordered.length - 1} onClick={() => { const i = ordered.findIndex(home => home.id === detail.id); if (i >= 0 && i < ordered.length - 1) inspect(ordered[i + 1], detailTab); }}><ArrowDown aria-hidden="true" className="size-4" /></Button></div></footer></aside>}
    </div>

  </div>;
}
