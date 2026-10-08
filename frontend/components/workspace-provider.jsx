'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { defaultBrief, filterHomes, homes as fixtureHomes } from '@/lib/data';
import { useAuth } from '@/components/auth-provider';

const WorkspaceContext = createContext(null);

function readStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(window.localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function WorkspaceProvider({ children }) {
  const { client, user } = useAuth();
  const [brief, setBrief] = useState(defaultBrief);
  const [shortlistIds, setShortlistIds] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [homes, setHomes] = useState(fixtureHomes);
  const [resourceFeatures, setResourceFeatures] = useState([]);
  const [sourceStatus, setSourceStatus] = useState(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [profileOwner, setProfileOwner] = useState(null);

  useEffect(() => {
    setBrief(readStorage('family-brief', defaultBrief));
    setShortlistIds(readStorage('shortlist', []));
    setCompareIds(readStorage('compare-selection', []));
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) window.localStorage.setItem('family-brief', JSON.stringify(brief)); }, [brief, hydrated]);
  useEffect(() => { if (hydrated) window.localStorage.setItem('shortlist', JSON.stringify(shortlistIds)); }, [shortlistIds, hydrated]);
  useEffect(() => { if (hydrated) window.localStorage.setItem('compare-selection', JSON.stringify(compareIds)); }, [compareIds, hydrated]);

  useEffect(() => {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
    if (!hydrated) return undefined;
    let active = true;
    const types = ['silver_zone', 'dementia_gtp', 'chas_clinic', 'childcare', 'student_care', 'kindergarten', 'school_zone', 'dengue_cluster'];
    const params = new URLSearchParams({ limit: '5000' });
    types.forEach((type) => params.append('resource_type', type));
    Promise.allSettled([
      fetch(`${apiBase}/api/v1/homes`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiBase}/api/v1/resources?${params}`).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${apiBase}/api/v1/sources`).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([homeResult, resourceResult, sourceResult]) => {
      if (!active) return;
      if (homeResult.status === 'fulfilled') setHomes(homeResult.value.items || []);
      if (resourceResult.status === 'fulfilled') setResourceFeatures(resourceResult.value.features || []);
      if (sourceResult.status === 'fulfilled') setSourceStatus(sourceResult.value);
    });
    return () => { active = false; };
  }, [hydrated]);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    if (!hydrated || !client || !user) { if (!user) setProfileOwner(null); return undefined; }
    let active = true;
    (async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) return;
      try {
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const [shortlistResponse, profileResponse] = await Promise.all([
          fetch(`${apiBase.replace(/\/$/, '')}/api/v1/shortlists`, { headers }),
          fetch(`${apiBase.replace(/\/$/, '')}/api/v1/profile`, { headers }),
        ]);
        if (!active) return;
        if (shortlistResponse.ok) {
          const payload = await shortlistResponse.json();
          const imported = payload.items || [];
          setShortlistIds(imported.map((home) => home.id));
          if (imported.length) setHomes((current) => [...imported, ...current.filter((home) => !imported.some((item) => item.id === home.id))]);
        }
        if (profileResponse.ok) {
          const profile = await profileResponse.json();
          setBrief((current) => ({ ...current, adults: profile.adults, children: profile.children, olderAdults: profile.olderAdults, budget: profile.budgetCents == null ? current.budget : Math.round(profile.budgetCents / 100) }));
          setProfileOwner(user.id);
        }
      } catch { /* Keep current browser data if the API is temporarily unreachable. */ }
    })();
    return () => { active = false; };
  }, [client, hydrated, user]);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    if (!hydrated || profileOwner !== user?.id || !client) return undefined;
    const timer = window.setTimeout(async () => {
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) return;
      try {
        await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/profile`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ adults: brief.adults, children: brief.children, older_adults: brief.olderAdults, budget_cents: Math.round(Number(brief.budget) * 100), locale: 'en-SG' }),
        });
      } catch { /* Local current filters remain usable if profile sync is temporarily offline. */ }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [brief.adults, brief.budget, brief.children, brief.olderAdults, client, hydrated, profileOwner, user?.id]);

  const selectedHomes = useMemo(() => homes.filter((home) => compareIds.includes(home.id)), [homes, compareIds]);
  const shortlistHomes = useMemo(() => shortlistIds.map((id) => homes.find((home) => home.id === id)).filter(Boolean), [homes, shortlistIds]);

  function flash(text, tone = 'info') {
    setNotice({ text, tone });
    window.clearTimeout(flash.timeout);
    flash.timeout = window.setTimeout(() => setNotice(null), 4800);
  }

  async function toggleShortlist(home) {
    const isSaved = shortlistIds.includes(home.id);
    setShortlistIds((current) => isSaved ? current.filter((id) => id !== home.id) : [...current, home.id]);
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (user && client) {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (!session?.access_token) throw new Error('Your session expired.');
        const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/shortlists${isSaved ? `/${encodeURIComponent(home.id)}` : ''}`, {
          method: isSaved ? 'DELETE' : 'POST',
          headers: { ...(isSaved ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${session.access_token}` },
          body: isSaved ? undefined : JSON.stringify({ home_id: home.id }),
        });
        if (response.ok) { flash(isSaved ? `${home.address} removed from your account shortlist.` : `${home.address} saved to your account.`, 'success'); return; }
        if (response.status === 404) { flash('This illustrative sample stays in this browser; only imported source records can sync to your account.', 'warning'); return; }
        throw new Error('The account could not be updated.');
      } catch {
        flash(isSaved ? `${home.address} removed here; account sync failed.` : `${home.address} is saved here only because account sync failed.`, 'warning');
        return;
      }
    }
    flash(isSaved ? `${home.address} removed from this browser.` : `${home.address} saved in this browser.`, isSaved ? 'info' : 'success');
  }

  function toggleCompare(home) {
    const isSelected = compareIds.includes(home.id);
    if (!isSelected && compareIds.length >= 3) { flash('Comparison is limited to three homes.', 'warning'); return; }
    setCompareIds((current) => isSelected ? current.filter((id) => id !== home.id) : [...current, home.id]);
    flash(isSelected ? `${home.address} removed from comparison.` : `${home.address} added to comparison.`, 'info');
  }

  function applyLocalSearch(nextQuery = query) {
    const results = filterHomes(fixtureHomes, nextQuery, brief);
    setHomes(results);
    flash(results.length ? `${results.length} labelled fixture candidates found.` : 'No homes match every current filter. Adjust the filters to search again.', results.length ? 'info' : 'warning');
    return results;
  }

  async function applySearch(nextQuery = query) {
    setBusy(true);
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
    try {
        let criteria = { query: nextQuery, budget: brief.budget, max_school_distance_m: brief.schoolDistance, max_care_distance_m: brief.careDistance };
        let interpretationNotice = '';
        if (nextQuery.trim()) {
          try {
            const interpreted = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/ai/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: nextQuery }) });
            if (interpreted.ok) {
              const parsed = await interpreted.json();
              criteria = { ...parsed.filters, budget: brief.budget, max_school_distance_m: brief.schoolDistance, max_care_distance_m: brief.careDistance };
              if (parsed.needs_clarification && parsed.clarifying_question) interpretationNotice = parsed.clarifying_question;
            } else {
              const errorPayload = await interpreted.json().catch(() => ({}));
              interpretationNotice = errorPayload.detail?.message || 'Phrase interpretation is unavailable; searching the words as typed.';
            }
          } catch { interpretationNotice = 'Phrase interpretation is unavailable; searching the words as typed.'; }
        }
        const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(criteria),
        });
        if (!response.ok) throw new Error('Search service unavailable');
        const payload = await response.json();
        const results = payload.items || [];
        setHomes(results);
        if (payload.unappliedCriteria?.length) flash(`Location-based filters were not applied because transaction coordinates and verified proximity matching are not ready (${payload.unappliedCriteria.join(', ')}). ${results.length} historical records remain; these are not live listings.`, 'warning');
        else if (interpretationNotice) flash(interpretationNotice, 'warning');
        else flash(results.length ? `${results.length} dated resale records found. They are not current listings.` : 'No source records match these applied filters.', results.length ? 'info' : 'warning');
        setBusy(false);
        return results;
    } catch {
      // Keep the planning workflow useful when the optional API is offline.
    }
    const results = applyLocalSearch(nextQuery);
    flash('The source service is unavailable. These illustrative examples are for UI preview only.', 'warning');
    setBusy(false);
    return results;
  }

  function resetSearch() { setQuery(''); setHomes(fixtureHomes); flash('Search reset to the full labelled fixture set.', 'info'); }

  const value = { brief, setBrief, homes, setHomes, resourceFeatures, sourceStatus, query, setQuery, notice, setNotice, busy, shortlistIds, setShortlistIds, shortlistHomes, compareIds, setCompareIds, selectedHomes, toggleShortlist, toggleCompare, applyLocalSearch, applySearch, resetSearch, flash };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
