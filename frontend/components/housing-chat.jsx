'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, ArrowUpRight, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getApiBase, requestJson } from '@/lib/api-client';
import { buildCriteria, briefFromCriteria } from '@/lib/planning';
import { AssistantOrb } from '@/components/assistant-orb';
import { useAssistantOpen, useAssistantSummary, clearAssistantSummary } from '@/lib/assistant-state';

const starters = [
  'Find 4-room flats in Clementi under $700,000',
  'What does the fit score mean?',
  'What should I check about this record?',
];

export function normalizeChatFilters(filters, options) {
  const normalize = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = (value, choices) => {
    if (!value) return null;
    if (typeof value !== 'string' || /[<>\[\]{}]|&(?:lt|gt);|```/i.test(value)) throw new Error('The assistant returned an invalid filter. Your search has not changed. Please try again.');
    if (!choices?.length) throw new Error(options?.status === 'error' ? 'Search options are unavailable. Refresh the page and try again.' : 'Search options are still loading. Please try again in a moment.');
    const cleaned = String(value).replace(/,?\s*singapore$/i, '').replace(/\s+(?:hdb\s+)?(?:flat|flats|new town)$/i, '').trim();
    const room = cleaned.match(/^(?:hdb\s+)?([1-5])\s*[- ]?\s*room$/i);
    const target = room ? `${room[1]}ROOM` : normalize(cleaned);
    return choices.find(choice => normalize(choice) === target) || null;
  };
  const requestedTowns = filters.towns?.length ? filters.towns : filters.town ? [filters.town] : [];
  const towns = [...new Set(requestedTowns.flatMap(town => {
    if (normalize(town) === 'JURONG') {
      return ['Jurong East', 'Jurong West'].map(name => match(name, options?.towns));
    }
    return [match(town, options?.towns)];
  }))];
  const flatType = match(filters.flat_type, options?.flatTypes);
  if (towns.some(town => !town)) throw new Error('I couldn’t match a requested town to the available towns. Your search has not changed. Try a specific town or use Filters.');
  if (filters.flat_type && !flatType) throw new Error('I couldn’t match the requested flat type to the available types. Your search has not changed. Try another wording or use Filters.');
  return { ...filters, towns, town: null, flat_type: flatType };
}

// Apply only fields the assistant changed; unrelated manual and chat choices survive follow-ups.
export function applyChatChanges(brief, filters) {
  const baseline = buildCriteria(brief);
  const changed = { ...baseline };
  const mapping = { school_distance: 'max_school_distance_m', childcare_distance: 'max_childcare_distance_m', care_distance: 'max_care_distance_m' };
  for (const key of filters.clear_filters || []) delete changed[mapping[key] || key];
  for (const key of ['budget', 'flat_type', 'max_school_distance_m', 'max_childcare_distance_m', 'max_care_distance_m', 'min_floor_area_sqm', 'max_floor_area_sqm', 'min_storey', 'max_storey', 'min_remaining_lease_years', 'observed_after', 'max_price_per_sqm']) {
    if (filters[key] != null) changed[key] = filters[key];
  }
  if (filters.towns?.length) changed.towns = filters.towns;
  const next = briefFromCriteria(brief, changed);
  if (filters.clear_filters?.includes('budget')) { next.budget = null; next.requirements.budget = false; }
  else if (filters.budget != null) next.requirements.budget = filters.budget_is_ceiling !== false;
  else if (brief.requirements?.budget === false) { next.budget = brief.budget; next.requirements.budget = false; }
  next.priorityWeights = { ...brief.priorityWeights, ...(filters.school_priority ? { school: 3 } : {}), ...filters.priority_weights };
  next.placeConstraints = brief.placeConstraints || [];
  return next;
}

function describeFilters(filters) {
  const parts = [];
  if (filters.towns?.length) parts.push(filters.towns.join(', '));
  if (filters.flat_type) parts.push(filters.flat_type);
  if (filters.budget != null) parts.push(`${filters.budget_is_ceiling === false ? 'budget target' : 'up to'} $${Number(filters.budget).toLocaleString('en-SG')}`);
  if (filters.school_priority) parts.push('prioritising school access');
  for (const [key, value] of Object.entries(filters.priority_weights || {})) parts.push(`${key} priority ${value}/3`);
  for (const key of filters.clear_filters || []) parts.push(`removed ${key.replaceAll('_', ' ')} filter`);
  for (const [key, label] of [['max_school_distance_m', 'school'], ['max_childcare_distance_m', 'childcare'], ['max_care_distance_m', 'care']]) {
    if (filters[key] != null) parts.push(`${label} within ${Number(filters[key]).toLocaleString('en-SG')} m`);
  }
  for (const [key, label, unit] of [['min_floor_area_sqm', 'area from', 'm²'], ['max_floor_area_sqm', 'area up to', 'm²'], ['min_storey', 'storey from', ''], ['max_storey', 'storey up to', ''], ['min_remaining_lease_years', 'lease from', 'years'], ['max_price_per_sqm', 'price per m² up to', 'SGD']]) {
    if (filters[key] != null) parts.push(`${label} ${Number(filters[key]).toLocaleString('en-SG')}${unit ? ` ${unit}` : ''}`);
  }
  if (filters.observed_after) parts.push(`transactions from ${filters.observed_after}`);
  return parts.length ? parts.join(' · ') : 'no location, flat type or price filters';
}

export function HousingChat({ user, homes, selectedHome, brief, onSearch, workspaceReady, options, embedded = false, context = 'explore', focus = 'all', onDismiss }) {
  const [dockOpen, setOpen] = useAssistantOpen();
  const open = embedded || dockOpen;
  const contextKey = context === 'comparison' || context === 'saved' ? (homes || []).map(home => String(home.id)).sort().join(',') : context === 'detail' ? String(selectedHome?.id || '') : 'explore';
  const prompts = context === 'comparison' || context === 'saved' ? ['Explain the main trade-offs between these homes', 'Which fits my priorities, and what evidence is missing?', 'What should I verify before making a decision?'] : context === 'detail' ? ['What are the strengths and trade-offs of this record?', 'How does this fit my current preferences?', 'What should I verify before deciding?'] : starters;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const controller = useRef(null);
  const thread = useRef(null);
  const input = useRef(null);

  const owner = user?.id || null;
  const summaryRequest = useAssistantSummary();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => { controller.current?.abort(); setMessages([]); setDraft(''); setError(''); setStatus(''); setPending(false); }, [owner, context, contextKey, focus]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('assistant') === '1') setOpen(true);
  }, [setOpen]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open || embedded) return;
    const closeOnEscape = event => { if (event.key === 'Escape') { event.preventDefault(); closeChat(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, embedded]);
  useEffect(() => { if (open && thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [messages, pending, open]);
  useEffect(() => {
    if (!summaryRequest || !user || !workspaceReady || pending || controller.current) return;
    const matchesOwner = summaryRequest.ownerId === String(user.id);
    const records = [selectedHome, ...(homes || [])].filter(Boolean);
    const matchesRecord = records.some(home => String(home.id) === summaryRequest.homeId);
    clearAssistantSummary();
    if (!matchesOwner || !matchesRecord) return;
    generateEvidenceSummary(summaryRequest);
  }, [summaryRequest, owner, workspaceReady, pending, contextKey]);


  function closeChat() {
    if (onDismiss) { onDismiss(); return; }
    setOpen(false);
    requestAnimationFrame(() => document.querySelector('[data-housing-assistant]')?.focus());
  }

  async function generateEvidenceSummary(request) {
    const abort = new AbortController();
    controller.current = abort;
    setMessages(current => [...current, { role: 'user', text: `Summarize the evidence for ${request.address}.` }]);
    setError(''); setPending(true); setStatus('Preparing the evidence summary…');
    try {
      const result = await requestJson(`/api/v1/ai/summaries/${encodeURIComponent(request.homeId)}`, { method: 'POST', signal: abort.signal });
      if (!abort.signal.aborted) setMessages(current => [...current, { role: 'assistant', text: result.overview, summary: result }]);
    } catch (err) {
      if (!abort.signal.aborted) setError(err?.message || 'The evidence summary could not be generated. Please try again.');
    } finally {
      if (controller.current === abort) { controller.current = null; setPending(false); setStatus(''); }
    }
  }

  async function send(value, summaryHomeId = null) {
    const text = value.trim();
    if (!text || text.length > 500 || pending || !user || !workspaceReady) return;
    const abort = new AbortController();
    controller.current = abort;
    const history = messages.filter(item => item.role === 'user' || item.role === 'assistant').slice(-8).map(item => ({ role: item.role, text: item.text.slice(0, 1000) }));
    const contextHomes = context === 'comparison' || context === 'saved' ? homes || [] : context === 'detail' ? [selectedHome].filter(Boolean) : [selectedHome, ...(homes || [])].filter(Boolean);
    const ids = summaryHomeId ? [summaryHomeId] : [...new Set(contextHomes.map(home => String(home.id)))].slice(0, 3);
    setMessages(current => [...current, { role: 'user', text }]);
    setDraft(''); setError(''); setPending(true); setStatus('Checking the available evidence…');
    try {
      const response = await fetch(`${getApiBase()}/api/v1/ai/chat/stream`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history, home_ids: ids, view: context, comparison_focus: focus, current_search: { ...buildCriteria(brief), ...(brief.budget != null ? { budget: Number(brief.budget) } : {}), priority_weights: brief.priorityWeights }, budget_is_ceiling: brief.requirements?.budget !== false }), signal: abort.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail?.message || 'The assistant is unavailable. Try again.');
      }
      if (!response.body) throw new Error('Streaming is unavailable in this browser.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data = null;
      let receivedText = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'text') {
            if (typeof event.text !== 'string' || /<|&lt;|```/i.test(event.text)) continue;
            if (!receivedText) {
              receivedText = true;
              setMessages(current => [...current, { role: 'assistant', text: event.text, streaming: true }]);
            } else {
              setMessages(current => current.map((item, index) => index === current.length - 1 && item.streaming ? { ...item, text: event.text } : item));
            }
          } else if (event.type === 'reset') {
            setMessages(current => current.filter(item => !item.streaming));
            receivedText = false;
            setStatus('Rechecking the response…');
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'done') data = event;
        }
        if (done) break;
      }
      if (!data) throw new Error('The assistant response was interrupted. Please try again.');
      if (typeof data.reply !== 'string' || /<|&lt;|```/i.test(data.reply)) throw new Error('The assistant response could not be validated. Your search has not changed. Please try again.');
      if (abort.signal.aborted) return;
      let note = '';
      if (typeof onSearch === 'function' && context !== 'comparison' && data.action === 'search' && data.filters) {
        const filters = normalizeChatFilters(data.filters, data.searchOptions || optionsRef.current);
        const next = applyChatChanges(brief, filters);
        const result = await onSearch('', next, { interpret: false });
        if (abort.signal.aborted) return;
        note = result == null ? 'The search could not be applied. Check your connection and try again.' : `Search updated: ${describeFilters(filters)}. Results are historical transactions.`;
      }
      setMessages(current => [...current.filter(item => !item.streaming), { role: 'assistant', text: data.reply, note }]);
    } catch (err) {
      if (!abort.signal.aborted) {
        setMessages(current => current.filter(item => !item.streaming));
        setError(err instanceof SyntaxError ? 'The assistant response was interrupted. Your search has not changed. Please try again.' : (err?.message || 'The assistant is unavailable. Try again.'));
        setDraft(text);
      }
    } finally {
      if (controller.current === abort) { controller.current = null; setPending(false); setStatus(''); }
    }
  }

  return <>

    {open && <aside id={embedded ? undefined : "housing-assistant-panel"} className={`housing-chat${embedded ? ' housing-chat--embedded' : ''}${context === 'detail' && !embedded ? ' housing-chat--detail' : ''}`} aria-label="Housing assistant">
      <header className="housing-chat-header"><div className="housing-chat-heading"><AssistantOrb active={pending} /><div><h2>Ask HomeCompass</h2><p>{context === 'comparison' ? 'Only the homes in this comparison' : context === 'saved' ? 'The saved records on this screen' : context === 'detail' ? selectedHome?.address : 'A little help finding your bearings'}</p></div></div><div className="housing-chat-header-actions"><Button variant="ghost" size="icon" aria-label="Clear conversation" disabled={pending || !messages.length} onClick={() => { setMessages([]); setError(''); }}><RotateCcw size={17} aria-hidden="true" /></Button>{(!embedded || onDismiss) && <Button variant="ghost" size="sm" className="housing-chat-close" aria-label="Close housing assistant" onClick={closeChat}><X size={18} aria-hidden="true" /><span className="housing-chat-back-label">Back to workspace</span></Button>}</div></header>
      {(context === 'comparison' || context === 'saved') && <p className="housing-chat-record-context">Reading {(homes || []).slice(0, 3).map(home => home.address).join(' · ') || 'no selected records'}. Personal notes and photos are excluded.</p>}
      <div className="housing-chat-thread" ref={thread} role="log" aria-label="Conversation" aria-live="polite" aria-busy={pending} aria-relevant="additions">
        {!messages.length && <div className="housing-chat-intro"><div className="housing-chat-welcome-orb"><AssistantOrb /></div><h3>{context === 'comparison' ? 'Make the trade-offs clear.' : context === 'saved' ? 'A shortlist worth a closer look.' : context === 'detail' ? 'Look a little closer.' : <>A place to start.<br />Room to explore.</>}</h3><p>{context === 'comparison' ? 'Ask how these records differ, which evidence supports your priorities, and what is still worth checking.' : context === 'saved' ? 'Review the public evidence for the saved homes on screen. Your private notes and viewing plans stay here.' : context === 'detail' ? 'Ask about this record’s price, nearby services, lease estimate or missing evidence.' : 'A neighbourhood, a budget, or just a few things that matter. We can work through it together.'}</p><div className="housing-chat-suggestions" aria-label="Example questions">{prompts.map(text => <button key={text} type="button" disabled={!user || !workspaceReady} onClick={() => send(text)}>{text}<ArrowUpRight size={16} aria-hidden="true" /></button>)}</div><p className="housing-chat-context">HomeCompass uses dated HDB resale transactions, not live listings. <a href="https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view" target="_blank" rel="noreferrer">View the HDB source</a>.</p></div>}
        {messages.map((message, index) => <article key={index} className={`housing-chat-message housing-chat-message--${message.role}`}><span className="housing-chat-speaker">{message.role === 'user' ? 'You' : 'HomeCompass'}</span><p>{message.text}</p>{message.summary && <div className="housing-summary-cards">{message.summary.observations?.map((item, i) => <div className="housing-summary-card" key={i}><p>{item.text}</p><p className="housing-summary-evidence">Evidence: {item.evidence_fields.join(', ').replaceAll('_', ' ')}</p></div>)}<details className="housing-summary-sources"><summary>Sources and limitations</summary><p>Transaction source: {message.summary.source?.datasetId || 'not reported'} · {message.summary.source?.datasetVersion || 'version not reported'} · retrieved {message.summary.source?.retrievedAt || 'date not reported'}</p>{message.summary.limitations?.length > 0 && <ul>{message.summary.limitations.map(item => <li key={item}>{item}</li>)}</ul>}</details></div>}{message.note && <p className="housing-chat-applied" role="status">{message.note}</p>}</article>)}
        {pending && !messages.some(message => message.streaming) && <div className="housing-chat-thinking"><span className="housing-chat-pulse" aria-hidden="true" />{status}</div>}
        {error && <div className="housing-chat-error" role="alert">{error} <button type="button" onClick={() => setError('')}>Dismiss</button></div>}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
      <div className="housing-chat-compose">{!user ? <p className="housing-chat-signin"><Link href="/login">Sign in</Link> to use the housing assistant.</p> : <form onSubmit={event => { event.preventDefault(); send(draft); }}><label className="sr-only" htmlFor="housing-chat-input">Your question</label><div className="housing-chat-input-row"><textarea ref={input} id="housing-chat-input" rows={2} maxLength={500} placeholder="Tell me what matters to you…" value={draft} readOnly={pending} disabled={!workspaceReady} aria-describedby="housing-chat-help" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); } }} /><Button type="submit" size="icon" aria-label="Send message" disabled={!draft.trim() || pending || !workspaceReady}><ArrowUp size={19} aria-hidden="true" /></Button></div><div className="housing-chat-compose-meta"><span>Enter to send · Shift+Enter for a new line</span><span>{draft.length}/500</span></div></form>}<details className="housing-chat-privacy"><summary>About your data &amp; AI</summary><p id="housing-chat-help">Your question, current search and up to three displayed records are sent to Gemini. AI can make mistakes.<span className="sr-only"> Press Enter to send, or Shift and Enter for a new line. Press Escape to close chat.</span></p></details></div>
    </aside>}
  </>;
}
