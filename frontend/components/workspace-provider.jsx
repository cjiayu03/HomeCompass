'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { defaultBrief, filterHomes, homes as fixtureHomes } from '@/lib/data';
import { useAuth } from '@/components/auth-provider';
import { ApiError, requestJson } from '@/lib/api-client';
import { buildCriteria, applyLocalRequirements, briefFromCriteria, briefValidationError, distanceM } from '@/lib/planning';

import { resourceTypes } from '@/lib/map-layers';
import { HOME_SAVED_EVENT, COMPARISON_ADDED_EVENT } from '@/lib/workspace-events';

const WorkspaceContext = createContext(null);
const priorityWeightKeys = Object.keys(defaultBrief.priorityWeights);
const HOME_PAGE_LIMIT = 50;
const RESOURCE_PAGE_LIMIT = 500;
const GUEST_SNAPSHOT_STORAGE_KEY = 'homecompass.guest-sync-pending';
const GUEST_SYNC_KEY_STORAGE_KEY = 'homecompass.guest-sync-key';
const GUEST_SYNC_FINGERPRINT_STORAGE_KEY = 'homecompass.guest-sync-fingerprint';
const GUEST_BRIEF_KEY = 'homecompass.guest.brief';
const GUEST_DECISION_HOMES_KEY = 'homecompass.guest.decision-homes';

const LOCAL_DATA_CLEARED_EVENT = 'homecompass:clear-local-data';
const AUTHENTICATED_WORKSPACE_SEEN_STORAGE_KEY = 'homecompass.authenticated-workspace-seen';

function cloneBrief(brief) {
  return JSON.parse(JSON.stringify(brief));
}

function decisionHomesFromStorage(value) {
  return Array.isArray(value) ? value.filter(home => home && typeof home.id === 'string').slice(0, 203) : [];
}

function validManualPin(candidate) {
  return candidate?.provider === 'user-entered'
    && typeof candidate.address === 'string' && candidate.address.trim()
    && typeof candidate.latitude === 'number' && Number.isFinite(candidate.latitude) && candidate.latitude >= -90 && candidate.latitude <= 90
    && typeof candidate.longitude === 'number' && Number.isFinite(candidate.longitude) && candidate.longitude >= -180 && candidate.longitude <= 180;
}

function accountWorkspaceStorageKey(userId) {
  return `homecompass.account.${encodeURIComponent(userId)}.workspace`;
}

function accountWorkspaceOwnerKey(userId) {
  return userId ? `account:${userId}` : 'guest';
}

function isValidPriorityWeights(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === priorityWeightKeys.length
    && priorityWeightKeys.every((key) => Object.hasOwn(value, key)
      && typeof value[key] === 'number'
      && Number.isFinite(value[key])
      && value[key] >= 0
      && value[key] <= 3);
}

function profileUpdatePayload(brief, onboardingCompleted) {
  const distance = value => value !== '' && value != null && Number.isInteger(Number(value)) ? Number(value) : null;
  const payload = {
    adults: brief.adults,
    children: brief.children,
    older_adults: brief.olderAdults,
    budget_cents: brief.budget == null || brief.budget === '' || brief.requirements?.budget === false ? null : Math.round(Number(brief.budget) * 100),
    locale: 'en-SG',
    priority_weights: brief.priorityWeights,
    preferred_towns: Array.isArray(brief.preferredTowns) ? brief.preferredTowns : [],
    preferred_flat_type: typeof brief.preferredFlatType === 'string' && brief.preferredFlatType.trim()
      ? brief.preferredFlatType.trim()
      : null,
    max_school_distance_m: distance(brief.schoolDistance),
    max_childcare_distance_m: distance(brief.childcareDistance),
    max_care_distance_m: distance(brief.careDistance),
  };
  if (onboardingCompleted === true) payload.onboarding_completed = true;
  return payload;
}

function searchCriteriaFromBrief(brief) {
  return buildCriteria(brief);
}

function mergeExplicitSearchCriteria(criteria, filters) {
  const next = { ...criteria };
  for (const key of [
    'budget', 'town', 'towns', 'flat_type', 'bounds',
    'max_school_distance_m', 'max_childcare_distance_m', 'max_care_distance_m',
    'min_floor_area_sqm', 'max_floor_area_sqm', 'min_storey', 'max_storey',
    'min_remaining_lease_years', 'max_price_per_sqm', 'observed_after',
  ]) {
    const value = filters?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    next[key] = value;
  }
  return next;
}

function initialState(dataMode) {
  return { status: 'idle', dataMode, retrievedAt: null, sourceSummary: [], warnings: [], error: null };
}

function fixtureState(items) {
  return { ...initialState('fixture'), status: items.length ? 'success' : 'empty', warnings: ['Illustrative UI fixtures; not official source records.'] };
}

function successState(payload, data, previous) {
  return {
    status: data.length ? 'success' : 'empty',
    dataMode: payload.dataMode || previous.dataMode,
    retrievedAt: payload.retrievedAt || null,
    sourceSummary: payload.sourceSummary || [],
    warnings: payload.warnings || [],
    error: null,
  };
}

function pageState(payload, items) {
  const nextCursor = typeof payload?.nextCursor === 'string' && payload.nextCursor.length > 0
    ? payload.nextCursor
    : null;
  const hasMore = items.length > 0 && payload?.hasMore === true && nextCursor !== null;
  return {
    limit: HOME_PAGE_LIMIT,
    total: Number.isFinite(payload?.total) && payload.total >= 0 ? payload.total : items.length,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };
}

function mergeHomesById(current, page) {
  const seen = new Set(current.map((home) => home?.id).filter((id) => id !== null && id !== undefined).map(String));
  const additions = page.filter((home) => {
    if (home?.id === null || home?.id === undefined) return true;
    const id = String(home.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...current, ...additions];
}

function normalizeViewportBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const values = ['west', 'south', 'east', 'north'].map((key) => bounds[key]);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const [rawWest, rawSouth, rawEast, rawNorth] = values;
  const normalized = {
    west: Math.max(-180, Math.min(180, rawWest)),
    south: Math.max(-90, Math.min(90, rawSouth)),
    east: Math.max(-180, Math.min(180, rawEast)),
    north: Math.max(-90, Math.min(90, rawNorth)),
  };
  if (normalized.west >= normalized.east || normalized.south >= normalized.north) return null;
  return normalized;
}

function requireResultArray(payload, key) {
  if (!Array.isArray(payload?.[key])) {
    throw new ApiError('Unable to load this information. Please try again.', {
      status: 200,
      code: 'INVALID_RESPONSE',
      payload,
    });
  }
  return payload[key];
}

function initialSavedSearchState(status = 'idle') {
  return { status, action: null, activeId: null, error: null, reruns: {} };
}

function initialHistoryState(status = 'idle', error = null) {
  return { status, error };
}

function savedSearchError(error, fallbackMessage = 'Saved search information is unavailable. Please try again.') {
  const apiError = error instanceof ApiError ? error : new ApiError(fallbackMessage, { code: 'UNKNOWN_ERROR' });
  const detail = apiError.payload?.detail;
  return {
    message: typeof detail?.message === 'string' ? detail.message : apiError.message || fallbackMessage,
    code: typeof detail?.code === 'string' ? detail.code : apiError.code || 'UNKNOWN_ERROR',
    status: apiError.status,
    missingPlaceIds: Array.isArray(detail?.missingPlaceIds) ? detail.missingPlaceIds : [],
  };
}

function normalizeSavedSearchCriteria(criteria, fallback = {}) {
  const source = criteria && typeof criteria === 'object' && !Array.isArray(criteria) ? criteria : fallback;
  const normalized = { ...fallback, ...source };
  delete normalized.cursor;
  return normalized;
}

function searchResultMetadata(payload, items, fallbackPolicyVersion = null) {
  return {
    dataMode: payload?.dataMode || 'live',
    retrievedAt: payload?.retrievedAt || null,
    sourceSummary: Array.isArray(payload?.sourceSummary) ? payload.sourceSummary : [],
    warnings: Array.isArray(payload?.warnings) ? payload.warnings : [],
    count: Number.isInteger(payload?.count) && payload.count >= 0 ? payload.count : items.length,
    total: Number.isInteger(payload?.total) && payload.total >= 0 ? payload.total : items.length,
    scorePolicyVersion: payload?.scorePolicyVersion || fallbackPolicyVersion || null,
  };
}

function errorState(error, previous) {
  const apiError = error instanceof ApiError ? error : new ApiError('Unable to load this information. Please try again.', { code: 'UNKNOWN_ERROR' });
  return { ...previous, status: 'error', error: { message: apiError.message, code: apiError.code, status: apiError.status } };
}

function normalizePlace(place) {
  if (!place || typeof place !== 'object' || typeof place.id !== 'string') {
    throw new ApiError('Unable to load this information. Please try again.', { code: 'INVALID_RESPONSE' });
  }
  return {
    id: place.id,
    label: place.label,
    address: place.address || '',
    latitude: place.latitude,
    longitude: place.longitude,
    kind: place.kind || 'other',
    geocodeSource: place.geocodeSource || place.geocode_source || null,
    geocodedAt: place.geocodedAt || place.geocoded_at || null,
    maximumDistanceM: place.maximumDistanceM ?? place.maximum_distance_m ?? null,
    updatedAt: place.updatedAt || place.updated_at || null,
    ...(place.localOnly ? { localOnly: true } : {}),
  };
}

function applyGuestPlaceRequirements(items, brief, places) {
  const constraints = brief.placeConstraints || [];
  if (!constraints.length) return items;
  const placesById = new Map(places.map(place => [place.id, place]));
  return items.flatMap(home => {
    const checks = constraints.map(constraint => {
      const place = placesById.get(constraint.placeId);
      const meters = place ? distanceM(home, place) : null;
      return { placeId: constraint.placeId, label: place?.label || 'Unavailable guest place', distanceM: meters, maximumDistanceM: Number(constraint.maxDistanceM), method: 'straight-line', localOnly: true, geocodeSource: place?.geocodeSource || null };
    });
    return checks.every(check => check.distanceM != null && check.distanceM <= check.maximumDistanceM) ? [{ ...home, placeDistances: checks }] : [];
  });
}

function normalizeLocalPlaces(items) {
  return (Array.isArray(items) ? items : []).filter(place => place && typeof place === 'object' && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)).map((place, index) => normalizePlace({
    ...place, id: typeof place.id === 'string' ? place.id : `guest-${index}-${place.latitude}-${place.longitude}`,
    localOnly: true,
    geocodeSource: place.geocodeSource || place.geocode_source || 'user-entered',
  }));
}

function authenticatedPlaceState(status, error = null) {
  return { status, error };
}

function isOneMapSelection(candidate) {
  return candidate?.provider === 'OneMap'
    && typeof candidate.selection_token === 'string'
    && /^[a-f0-9]{64}$/i.test(candidate.selection_token)
    && typeof candidate.address === 'string'
    && candidate.address.trim().length > 0
    && typeof candidate.latitude === 'number'
    && Number.isFinite(candidate.latitude)
    && typeof candidate.longitude === 'number'
    && Number.isFinite(candidate.longitude);
}

function readStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(window.localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function stringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim()))].slice(0, limit);
}

function localBriefChanged(brief) {
  return ['adults', 'children', 'olderAdults', 'budget'].some((key) => brief?.[key] !== defaultBrief[key])
    || JSON.stringify(brief?.priorityWeights) !== JSON.stringify(defaultBrief.priorityWeights);
}

function guestBrief(brief) {
  const result = {};
  if (Number.isInteger(brief?.adults) && brief.adults >= 1 && brief.adults <= 30) result.adults = brief.adults;
  if (Number.isInteger(brief?.children) && brief.children >= 0 && brief.children <= 30) result.children = brief.children;
  if (Number.isInteger(brief?.olderAdults) && brief.olderAdults >= 0 && brief.olderAdults <= 30) result.olderAdults = brief.olderAdults;
  const budgetCents = Math.round(Number(brief?.budget) * 100);
  if (brief?.budget != null && brief.budget !== '' && brief.requirements?.budget !== false && Number.isSafeInteger(budgetCents) && budgetCents >= 0 && budgetCents <= 1_000_000_000) result.budgetCents = budgetCents;
  if (isValidPriorityWeights(brief?.priorityWeights)) result.priorityWeights = { ...brief.priorityWeights };
  if (Object.keys(result).length) result.locale = 'en-SG';
  return Object.keys(result).length ? result : null;
}

function normalizeGuestSnapshot(snapshot) {
  return {
    brief: snapshot?.brief && typeof snapshot.brief === 'object' && !Array.isArray(snapshot.brief)
      ? { ...snapshot.brief }
      : null,
    shortlistHomeIds: stringArray(snapshot?.shortlistHomeIds, 200),
    compareHomeIds: stringArray(snapshot?.compareHomeIds, 3),
    history: Array.isArray(snapshot?.history) ? snapshot.history.slice(0, 100) : [],
    places: Array.isArray(snapshot?.places) ? snapshot.places.filter(place => place && typeof place === 'object').slice(0, 20) : [],
  };
}

function guestSnapshotFromStorage(brief, shortlistIds, compareIds) {
  const pending = readStorage(GUEST_SNAPSHOT_STORAGE_KEY, null);
  if (pending && typeof pending === 'object') return normalizeGuestSnapshot(pending);
  return normalizeGuestSnapshot({
    brief: localBriefChanged(brief) ? guestBrief(brief) : null,
    shortlistHomeIds: shortlistIds,
    compareHomeIds: compareIds,
    history: readStorage('search-history', []),
    places: readStorage('personal-places', []),
  });
}

function briefFromGuestSnapshot(snapshot) {
  const brief = { ...defaultBrief };
  const saved = snapshot?.brief;
  if (!saved) return brief;
  if (Number.isInteger(saved.adults)) brief.adults = saved.adults;
  if (Number.isInteger(saved.children)) brief.children = saved.children;
  if (Number.isInteger(saved.olderAdults)) brief.olderAdults = saved.olderAdults;
  if (Number.isFinite(saved.budgetCents)) brief.budget = saved.budgetCents / 100;
  if (isValidPriorityWeights(saved.priorityWeights)) brief.priorityWeights = { ...saved.priorityWeights };
  return brief;
}

function accountWorkspaceFromStorage(userId) {
  const stored = readStorage(accountWorkspaceStorageKey(userId), {});
  const brief = stored?.brief && typeof stored.brief === 'object' && !Array.isArray(stored.brief)
    ? { ...defaultBrief, ...stored.brief }
    : { ...defaultBrief };
  if (!isValidPriorityWeights(brief.priorityWeights)) brief.priorityWeights = { ...defaultBrief.priorityWeights };
  return {
    brief,
    shortlistIds: stringArray(stored?.shortlistIds, 200),
    compareIds: stringArray(stored?.compareIds, 3),
    decisionHomes: decisionHomesFromStorage(stored?.decisionHomes),
    localPlaces: Array.isArray(stored?.localPlaces) ? normalizeLocalPlaces(stored.localPlaces.filter(place => place?.localOnly)) : [],
    pendingHistory: Array.isArray(stored?.pendingHistory) ? stored.pendingHistory.slice(0, 100) : [],
  };
}

function persistAccountWorkspace(userId, patch) {
  if (typeof window === 'undefined' || !userId) return;
  const key = accountWorkspaceStorageKey(userId);
  const stored = readStorage(key, {});
  const workspace = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  window.localStorage.setItem(key, JSON.stringify({ ...workspace, ...patch }));
}

function persistAccountPendingHistory(userId, history) {
  if (typeof window === 'undefined' || !userId) return;
  const key = accountWorkspaceStorageKey(userId);
  const stored = readStorage(key, {});
  const workspace = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const nextWorkspace = { ...workspace };
  const pendingHistory = Array.isArray(history) ? history.slice(0, 100) : [];
  if (pendingHistory.length) nextWorkspace.pendingHistory = pendingHistory;
  else delete nextWorkspace.pendingHistory;
  window.localStorage.setItem(key, JSON.stringify(nextWorkspace));
}

function persistAccountShortlist(userId, shortlistIds) {
  persistAccountWorkspace(userId, { shortlistIds });
}

function hasGuestSnapshotData(snapshot) {
  return Boolean(snapshot?.brief)
    || snapshot?.shortlistHomeIds?.length > 0
    || snapshot?.compareHomeIds?.length > 0
    || snapshot?.history?.length > 0
    || snapshot?.places?.length > 0;
}

function persistGuestSnapshot(snapshot) {
  if (typeof window === 'undefined') return;
  if (hasGuestSnapshotData(snapshot)) window.localStorage.setItem(GUEST_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  else window.localStorage.removeItem(GUEST_SNAPSHOT_STORAGE_KEY);
}

function removeSharedSearchHistory(history) {
  if (typeof window === 'undefined' || !history.length) return;
  const stored = readStorage('search-history', []);
  if (!Array.isArray(stored) || !stored.length) return;
  const remaining = [...stored];
  for (const entry of history) {
    const signature = JSON.stringify(entry);
    const index = remaining.findIndex((storedEntry) => JSON.stringify(storedEntry) === signature);
    if (index >= 0) remaining.splice(index, 1);
  }
  if (remaining.length) window.localStorage.setItem('search-history', JSON.stringify(remaining));
  else window.localStorage.removeItem('search-history');
}

function stableSyncKey(payload) {
  const fingerprint = JSON.stringify(payload);
  const storedKey = window.localStorage.getItem(GUEST_SYNC_KEY_STORAGE_KEY);
  const storedFingerprint = window.localStorage.getItem(GUEST_SYNC_FINGERPRINT_STORAGE_KEY);
  if (storedKey && storedFingerprint === fingerprint) return storedKey;
  const randomId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const syncKey = `guest-${randomId}`;
  window.localStorage.setItem(GUEST_SYNC_KEY_STORAGE_KEY, syncKey);
  window.localStorage.setItem(GUEST_SYNC_FINGERPRINT_STORAGE_KEY, fingerprint);
  return syncKey;
}

function resultCount(value) {
  if (Array.isArray(value)) return value.length;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isAuthenticationFailure(error) {
  return error?.code === 'AUTH_REQUIRED' || error?.status === 401;
}

function sectionCount(section) {
  return Object.entries(section || {})
    .filter(([key]) => key !== 'retryableHistoryIndexes')
    .reduce((total, [, value]) => total + resultCount(value), 0);
}

function removeMergedSnapshot(snapshot, result, { confirmPlaces = false } = {}) {
  const remaining = normalizeGuestSnapshot(snapshot);
  const accepted = result?.accepted || {};
  const skipped = result?.skipped || {};

  if (remaining.brief) {
    const acceptedFields = new Set(Array.isArray(accepted.briefFields) ? accepted.briefFields : []);
    const apiFields = {
      adults: 'adults',
      children: 'children',
      olderAdults: 'older_adults',
      budgetCents: 'budget_cents',
      locale: 'locale',
    };
    for (const [localField, apiField] of Object.entries(apiFields)) {
      if (acceptedFields.has(apiField)) delete remaining.brief[localField];
    }
    if (remaining.brief.priorityWeights) {
      for (const key of Object.keys(remaining.brief.priorityWeights)) {
        if (acceptedFields.has(`priority_weights.${key}`)) delete remaining.brief.priorityWeights[key];
      }
      if (!Object.keys(remaining.brief.priorityWeights).length) delete remaining.brief.priorityWeights;
    }
    if (!Object.keys(remaining.brief).length) remaining.brief = null;
  }

  const shortlistAccounted = resultCount(accepted.shortlistHomeIds) + resultCount(skipped.shortlistHomeIds);
  if (shortlistAccounted >= remaining.shortlistHomeIds.length) remaining.shortlistHomeIds = [];

  const acceptedCompareIds = new Set(Array.isArray(accepted.compareHomeIds) ? accepted.compareHomeIds : []);
  remaining.compareHomeIds = remaining.compareHomeIds.filter((id) => !acceptedCompareIds.has(id));

  const retryableHistoryIndexes = new Set(Array.isArray(skipped.retryableHistoryIndexes)
    ? skipped.retryableHistoryIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < remaining.history.length)
    : []);
  remaining.history = remaining.history.filter((_, index) => retryableHistoryIndexes.has(index));

  if (confirmPlaces) {
    const placesAccounted = resultCount(accepted.places) + resultCount(skipped.places);
    if (placesAccounted >= remaining.places.length) remaining.places = [];
  }

  return remaining;
}

function syncResultNotice(result) {
  const accepted = sectionCount(result?.accepted);
  const skipped = sectionCount(result?.skipped);
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts.length : 0;
  const noun = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
  return {
    text: `Guest data sync complete: ${noun(accepted, 'item')} accepted, ${noun(skipped, 'item')} skipped, ${noun(conflicts, 'conflict')}. Account values were kept where they differed.`,
    tone: conflicts || skipped ? 'warning' : 'success',
  };
}

export function WorkspaceProvider({ children }) {
  const [hoveredHome, setHoveredHome] = useState(null);
  const auth = useAuth();
  const { user, loading: authLoading, transitioning: authTransitioning = false, sessionVerified = true } = auth;
  const refreshSession = auth.refreshSession;
  const userId = user?.id || null;
  const targetWorkspaceOwner = accountWorkspaceOwnerKey(userId);
  const fixtureMode = useMemo(() => process.env.NEXT_PUBLIC_HOME_DATA_MODE === 'fixture', []);
  const [brief, setBrief] = useState(() => cloneBrief(defaultBrief));
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const [appliedBrief, setAppliedBrief] = useState(() => cloneBrief(defaultBrief));
  const [appliedQuery, setAppliedQuery] = useState('');
  const [appliedBounds, setAppliedBounds] = useState(null);
  const retryHomeRequestRef = useRef(null);
  const activeHomePageSelectRef = useRef(null);
  const requestedDecisionHomeIdsRef = useRef(new Set());
  const explicitSearchRequestedRef = useRef(false);
  const localDataClearedRef = useRef(false);
  const [profileSyncState, setProfileSyncState] = useState({ status: 'local', error: null });
  const [shortlistIds, setShortlistIds] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [homes, setHomes] = useState(() => fixtureMode ? fixtureHomes : []);
  const [resourceFeatures, setResourceFeatures] = useState([]);
  const mapResourceTypesRef = useRef(['silver_zone']);
  const mapResourceCountsRef = useRef([]);
  const compareIdsRef = useRef([]);
  const [sourceStatus, setSourceStatus] = useState(null);
  const [homeState, setHomeState] = useState(() => initialState(fixtureMode ? 'fixture' : 'live'));
  const [resourceState, setResourceState] = useState(() => initialState(fixtureMode ? 'fixture' : 'live'));
  const [pagination, setPagination] = useState({ limit: HOME_PAGE_LIMIT, total: 0, nextCursor: null, hasMore: false });
  const [viewportBounds, setViewportBounds] = useState(null);
  const [sourceState, setSourceState] = useState(() => initialState(fixtureMode ? 'fixture' : 'live'));
  const requests = useRef({ home: null, resource: null, source: null, place: null, history: null, savedSearch: null });
  const homesRef = useRef(homes);
  const preservedDecisionHomesRef = useRef([]);
  const activeHomePageRequest = useRef(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState(null);
  const flashTimeoutRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [workspaceOwner, setWorkspaceOwner] = useState(null);
  const [profileOwner, setProfileOwner] = useState(null);
  const [profileLoadState, setProfileLoadState] = useState('signed_out');
  const [places, setPlaces] = useState([]);
  const placesRef = useRef(places);
  placesRef.current = places;
  const [placeState, setPlaceState] = useState(() => authenticatedPlaceState('idle'));
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState(() => initialHistoryState());
  const [savedSearches, setSavedSearches] = useState([]);
  const [preservedDecisionHomes, setPreservedDecisionHomes] = useState([]);
  const activeSavedSearchRerunRef = useRef(null);
  const [savedSearchState, setSavedSearchState] = useState(() => initialSavedSearchState());
  const [lastSearchSnapshot, setLastSearchSnapshot] = useState(null);
  const lastSearchSnapshotRef = useRef(null);
  const searchInFlightRef = useRef(null);
  const [syncState, setSyncState] = useState('local');
  const [syncResult, setSyncResult] = useState(null);
  const [pendingLocalPlaceCount, setPendingLocalPlaceCount] = useState(0);
  const shortlistIdsRef = useRef(shortlistIds);
  const guestSnapshotRef = useRef(null);
  const syncInFlightRef = useRef(null);
  const workspaceOwnerRef = useRef(null);
  const workspaceGenerationRef = useRef(0);
  const currentUserIdRef = useRef(userId);
  const authTransitioningRef = useRef(authTransitioning);
  const sessionVerifiedRef = useRef(sessionVerified);
  const pendingSessionExpiredNoticeRef = useRef(false);
  const authRequestControllersRef = useRef(new Set());
  const shortlistMutationQueueRef = useRef(Promise.resolve());
  currentUserIdRef.current = userId;
  authTransitioningRef.current = authTransitioning;
  sessionVerifiedRef.current = sessionVerified;
  const workspaceReady = !authLoading && !authTransitioning && (!userId || sessionVerified) && hydrated && workspaceOwner === targetWorkspaceOwner
    && workspaceOwnerRef.current === targetWorkspaceOwner;
  const isCurrentWorkspace = useCallback((expectedUserId, expectedOwner, expectedGeneration) => (
    currentUserIdRef.current === expectedUserId
      && !authTransitioningRef.current
      && (!expectedUserId || sessionVerifiedRef.current)
      && workspaceOwnerRef.current === expectedOwner
      && workspaceGenerationRef.current === expectedGeneration
  ), []);

  useEffect(() => () => window.clearTimeout(flashTimeoutRef.current), []);
  useEffect(() => {
    function cancelOwnerRequests(event) {
      if (event.detail?.phase === 'end') {
        authTransitioningRef.current = false;
        return;
      }
      if (event.detail?.phase !== 'start') return;
      authTransitioningRef.current = true;
      workspaceGenerationRef.current += 1;
      pendingSessionExpiredNoticeRef.current = false;
      if (syncInFlightRef.current) setSyncState('error');
      syncInFlightRef.current?.controller?.abort();
      Object.values(requests.current).forEach((controller) => controller?.abort());
      authRequestControllersRef.current.forEach((controller) => controller.abort());
    }
    window.addEventListener('homecompass:auth-transition', cancelOwnerRequests);
    return () => window.removeEventListener('homecompass:auth-transition', cancelOwnerRequests);
  }, []);
  useEffect(() => { homesRef.current = homes; }, [homes]);
  useEffect(() => { compareIdsRef.current = compareIds; }, [compareIds]);
  useEffect(() => { shortlistIdsRef.current = shortlistIds; }, [shortlistIds]);

  useEffect(() => {
    if (authLoading || workspaceOwner === targetWorkspaceOwner) return;

    requests.current.home?.abort();
    requests.current.home = null;
    requests.current.history?.abort();
    requests.current.history = null;
    requests.current.savedSearch?.abort();
    requests.current.savedSearch = null;
    activeHomePageRequest.current = null;
    const nextHomes = fixtureMode ? fixtureHomes : [];
    homesRef.current = nextHomes;
    preservedDecisionHomesRef.current = [];
    setPreservedDecisionHomes([]);
    setHomes(nextHomes);
    setQuery('');
    setAppliedQuery('');
    setAppliedBounds(null);
    retryHomeRequestRef.current = null;
    activeHomePageSelectRef.current = null;
    requestedDecisionHomeIdsRef.current = new Set();
    explicitSearchRequestedRef.current = false;
    localDataClearedRef.current = false;
    setProfileSyncState({ status: 'local', error: null });
    setPagination({
      limit: HOME_PAGE_LIMIT,
      total: fixtureMode ? nextHomes.length : 0,
      nextCursor: null,
      hasMore: false,
    });
    setHomeState(fixtureMode ? fixtureState(nextHomes) : initialState('live'));
    setBusy(false);
    window.clearTimeout(flashTimeoutRef.current);
    setNotice(null);
    if (pendingSessionExpiredNoticeRef.current && !userId) {
      pendingSessionExpiredNoticeRef.current = false;
      flash('Your session expired. Please sign in again. Guest data is still saved in this browser; retry account sync after signing in.', 'warning');
    }

    let nextWorkspace;
    let snapshot;
    if (userId) {
      window.localStorage.setItem(AUTHENTICATED_WORKSPACE_SEEN_STORAGE_KEY, 'true');
      nextWorkspace = accountWorkspaceFromStorage(userId);
      snapshot = normalizeGuestSnapshot(readStorage(GUEST_SNAPSHOT_STORAGE_KEY, null));
    } else if (window.localStorage.getItem(AUTHENTICATED_WORKSPACE_SEEN_STORAGE_KEY) === 'true') {
      snapshot = normalizeGuestSnapshot(readStorage(GUEST_SNAPSHOT_STORAGE_KEY, null));
      nextWorkspace = {
        brief: readStorage(GUEST_BRIEF_KEY, briefFromGuestSnapshot(snapshot)),
        shortlistIds: snapshot.shortlistHomeIds,
        compareIds: snapshot.compareHomeIds,
      };
    } else {
      const localBrief = readStorage('family-brief', defaultBrief);
      const localShortlist = stringArray(readStorage('shortlist', []), 200);
      const localCompare = stringArray(readStorage('compare-selection', []), 3);
      snapshot = guestSnapshotFromStorage(localBrief, localShortlist, localCompare);
      nextWorkspace = { brief: localBrief, shortlistIds: localShortlist, compareIds: localCompare };
      persistGuestSnapshot(snapshot);
    }

    guestSnapshotRef.current = snapshot;
    setPendingLocalPlaceCount(snapshot.places.length);
    const restoredBrief = { ...cloneBrief(defaultBrief), ...nextWorkspace.brief };
    setBrief(restoredBrief);
    setAppliedBrief(cloneBrief(defaultBrief));
    const restoredDecisions = userId ? nextWorkspace.decisionHomes : decisionHomesFromStorage(readStorage(GUEST_DECISION_HOMES_KEY, []));
    preservedDecisionHomesRef.current = restoredDecisions || [];
    setPreservedDecisionHomes(restoredDecisions || []);
    setShortlistIds(nextWorkspace.shortlistIds);
    shortlistIdsRef.current = nextWorkspace.shortlistIds;
    setCompareIds(nextWorkspace.compareIds);
    compareIdsRef.current = nextWorkspace.compareIds;
    setProfileOwner(null);
    setProfileLoadState(userId ? 'loading' : 'signed_out');
    setPlaces(userId ? nextWorkspace.localPlaces : normalizeLocalPlaces(snapshot.places));
    setPlaceState(authenticatedPlaceState(userId ? 'idle' : 'local'));
    setHistory(userId ? [] : readStorage('search-history', []));
    setHistoryState(initialHistoryState(userId ? 'idle' : 'signed_out'));
    setSavedSearches([]);
    setSavedSearchState(initialSavedSearchState(userId ? 'idle' : 'signed_out'));
    setLastSearchSnapshot(null);
    lastSearchSnapshotRef.current = null;
    searchInFlightRef.current = null;
    setSyncState('local');
    setSyncResult(null);
    if (workspaceOwnerRef.current !== targetWorkspaceOwner) workspaceGenerationRef.current += 1;
    workspaceOwnerRef.current = targetWorkspaceOwner;
    setWorkspaceOwner(targetWorkspaceOwner);
    setHydrated(true);
  }, [authLoading, fixtureMode, targetWorkspaceOwner, userId, workspaceOwner]);

  useEffect(() => {
    if (!workspaceReady || localDataClearedRef.current || targetWorkspaceOwner !== 'guest' || userId) return;
    window.localStorage.setItem('family-brief', JSON.stringify(brief));
    window.localStorage.setItem(GUEST_BRIEF_KEY, JSON.stringify(brief));
    window.localStorage.setItem('shortlist', JSON.stringify(shortlistIds));
    window.localStorage.setItem('compare-selection', JSON.stringify(compareIds));
    window.localStorage.setItem(GUEST_DECISION_HOMES_KEY, JSON.stringify(preservedDecisionHomes));
  }, [brief, compareIds, preservedDecisionHomes, shortlistIds, targetWorkspaceOwner, userId, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || localDataClearedRef.current || !userId) return;
    persistAccountWorkspace(userId, { brief, shortlistIds, compareIds, decisionHomes: preservedDecisionHomes, localPlaces: places.filter(place => place.localOnly) });
  }, [brief, compareIds, places, preservedDecisionHomes, shortlistIds, targetWorkspaceOwner, userId, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || localDataClearedRef.current || targetWorkspaceOwner !== 'guest' || userId) return;
    const snapshot = normalizeGuestSnapshot({
      brief: localBriefChanged(brief) ? guestBrief(brief) : null,
      shortlistHomeIds: shortlistIds,
      compareHomeIds: compareIds,
      history: readStorage('search-history', []),
      places,
    });
    window.localStorage.setItem('personal-places', JSON.stringify(places));
    guestSnapshotRef.current = snapshot;
    setPendingLocalPlaceCount(snapshot.places.length);
    persistGuestSnapshot(snapshot);
  }, [brief, compareIds, places, shortlistIds, targetWorkspaceOwner, userId, workspaceReady]);

  const syncGuestData = useCallback(async ({ confirmPlaces = false } = {}) => {
    const syncUserId = userId;
    const syncOwnerKey = accountWorkspaceOwnerKey(syncUserId);
    const syncGeneration = workspaceGenerationRef.current;
    const controller = new AbortController();
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(syncUserId, syncOwnerKey, syncGeneration);
    if (!isCurrentOwner()) {
      return { ok: false, stale: true };
    }
    if (syncInFlightRef.current?.userId === syncUserId
      && syncInFlightRef.current?.ownerKey === syncOwnerKey
      && syncInFlightRef.current?.generation === syncGeneration
      && !syncInFlightRef.current?.controller?.signal?.aborted) return syncInFlightRef.current.promise;
    const runSync = async () => {
      setSyncState('syncing');
      setSyncResult(null);
      try {
        if (!syncUserId) throw new ApiError('Sign in to sync guest data.', { code: 'AUTH_REQUIRED', status: 401 });
        if (!isCurrentOwner()) {
          return { ok: false, stale: true };
        }

        const snapshot = normalizeGuestSnapshot(guestSnapshotRef.current);
        const accountPendingHistory = accountWorkspaceFromStorage(syncUserId).pendingHistory;
        const historyForSync = [...accountPendingHistory, ...snapshot.history].slice(0, 100);
        const submittedGuestHistoryCount = Math.max(0, historyForSync.length - accountPendingHistory.length);
        const submittedGuestHistory = snapshot.history.slice(0, submittedGuestHistoryCount);
        const unsubmittedGuestHistory = snapshot.history.slice(submittedGuestHistory.length);
        const syncSnapshot = { ...snapshot, history: historyForSync };
        const payload = {
          brief: snapshot.brief,
          shortlistHomeIds: snapshot.shortlistHomeIds,
          compareHomeIds: snapshot.compareHomeIds,
          history: syncSnapshot.history,
          confirmPlaces: Boolean(confirmPlaces),
          confirmBrief: false,
        };
        if (confirmPlaces) payload.places = snapshot.places.map(({ label, address, latitude, longitude, kind, maximumDistanceM }) => ({ label, address, latitude, longitude, kind, maximumDistanceM }));
        payload.sync_key = stableSyncKey(payload);

        persistAccountPendingHistory(syncUserId, syncSnapshot.history);
        const guestSnapshot = { ...snapshot, history: unsubmittedGuestHistory };
        guestSnapshotRef.current = guestSnapshot;
        persistGuestSnapshot(guestSnapshot);
        removeSharedSearchHistory(submittedGuestHistory);

        const result = await requestJson('/api/v1/sync/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!isCurrentOwner()) {
          return { ok: false, stale: true };
        }
        if (!result || typeof result !== 'object' || !result.accepted || !result.skipped || !Array.isArray(result.conflicts)) {
          throw new ApiError('Account sync returned an incomplete result. Please retry.', { code: 'INVALID_RESPONSE' });
        }
        const skippedHistoryCount = resultCount(result.skipped.history);
        if (skippedHistoryCount > 0 && !Array.isArray(result.skipped.retryableHistoryIndexes)) {
          window.localStorage.removeItem(GUEST_SYNC_KEY_STORAGE_KEY);
          window.localStorage.removeItem(GUEST_SYNC_FINGERPRINT_STORAGE_KEY);
          throw new ApiError('Account sync could not identify which search history entries can be retried. Please retry.', { code: 'INVALID_RESPONSE' });
        }

        const remaining = removeMergedSnapshot(syncSnapshot, result, { confirmPlaces });
        persistAccountPendingHistory(syncUserId, remaining.history);
        const guestRemaining = { ...remaining, history: unsubmittedGuestHistory };
        guestSnapshotRef.current = guestRemaining;
        if (skippedHistoryCount > 0) {
          window.localStorage.removeItem(GUEST_SYNC_KEY_STORAGE_KEY);
          window.localStorage.removeItem(GUEST_SYNC_FINGERPRINT_STORAGE_KEY);
        }
        persistGuestSnapshot(guestRemaining);
        setPendingLocalPlaceCount(guestRemaining.places.length);
        setSyncResult(result);
        setSyncState('synced');
        const notice = syncResultNotice(result);
        flash(notice.text, notice.tone);
        return { ok: true, result };
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          if (currentUserIdRef.current === syncUserId
            && workspaceOwnerRef.current === syncOwnerKey
            && workspaceGenerationRef.current === syncGeneration) setSyncState('error');
          return { ok: false, stale: true, error };
        }
        if (!isCurrentOwner()) {
          return { ok: false, stale: true, error };
        }
        if (isAuthenticationFailure(error) && typeof refreshSession === 'function') {
          pendingSessionExpiredNoticeRef.current = true;
          let currentSession = syncUserId ? { id: syncUserId } : null;
          try {
            currentSession = await refreshSession();
          } catch {
            currentSession = syncUserId ? { id: syncUserId } : null;
          }
          if (workspaceGenerationRef.current !== syncGeneration || authTransitioningRef.current) {
            pendingSessionExpiredNoticeRef.current = false;
            return { ok: false, stale: true, error };
          }
          if (!currentSession) {
            return { ok: false, error };
          }
          if (!isCurrentOwner() || currentSession.id !== syncUserId) {
            pendingSessionExpiredNoticeRef.current = false;
            return { ok: false, stale: true, error };
          }
          pendingSessionExpiredNoticeRef.current = false;
        }
        setSyncState('error');
        flash(isAuthenticationFailure(error)
          ? 'Your session expired. Please sign in again. Guest data is still saved in this browser; retry account sync after signing in.'
          : 'Guest data is still saved in this browser. Account sync failed; please retry.', 'warning');
        return { ok: false, error };
      }
    };

    const request = runSync();
    const inFlight = {
      userId: syncUserId,
      ownerKey: syncOwnerKey,
      generation: syncGeneration,
      controller,
      promise: request,
    };
    syncInFlightRef.current = inFlight;
    try {
      return await request;
    } finally {
      if (syncInFlightRef.current === inFlight) syncInFlightRef.current = null;
    }
  }, [authTransitioningRef, isCurrentWorkspace, refreshSession, userId, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (!userId) {
      setProfileOwner(null);
      setProfileLoadState('signed_out');
      setSyncState('local');
      setSyncResult(null);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    authRequestControllersRef.current.add(controller);
    const accountUserId = user.id;
    const accountGeneration = workspaceGenerationRef.current;
    const isActiveOwner = () => active && workspaceReady
      && isCurrentWorkspace(accountUserId, targetWorkspaceOwner, accountGeneration);
    (async () => {
      setProfileOwner(null);
      setProfileLoadState('loading');
      await syncGuestData();
      if (!isActiveOwner()) return;
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      try {
        const [shortlistResponse, profileResponse] = await Promise.all([
          fetch(`${apiBase.replace(/\/$/, '')}/api/v1/shortlists`, { credentials: 'include', signal: controller.signal }).catch(() => null),
          fetch(`${apiBase.replace(/\/$/, '')}/api/v1/profile`, { credentials: 'include', signal: controller.signal }).catch(() => null),
        ]);
        if (!isActiveOwner()) return;
        if (shortlistResponse?.ok) {
          const payload = await shortlistResponse.json();
          if (!isActiveOwner()) return;
          const imported = Array.isArray(payload.items) ? payload.items : [];
          const ids = imported.map((home) => home.id).filter((id) => typeof id === 'string');
          setShortlistIds(ids);
          shortlistIdsRef.current = ids;
          retainDecisionHomes(imported, ids);
        }
        if (profileResponse?.ok) {
          const profile = await profileResponse.json();
          if (!isActiveOwner()) return;
          const current = briefRef.current;
          const hydratedBrief = {
            ...current,
            adults: profile.adults ?? current.adults,
            children: profile.children ?? current.children,
            olderAdults: profile.olderAdults ?? current.olderAdults,
            budget: profile.budgetCents == null ? null : profile.budgetCents / 100,
            priorityWeights: isValidPriorityWeights(profile.priorityWeights) ? { ...profile.priorityWeights } : current.priorityWeights,
            preferredTowns: Array.isArray(profile.preferredTowns) ? profile.preferredTowns : [],
            preferredFlatType: profile.preferredFlatType ?? null,
            schoolDistance: profile.maxSchoolDistanceM ?? null,
            childcareDistance: profile.maxChildcareDistanceM ?? null,
            careDistance: profile.maxCareDistanceM ?? null,
            requirements: { ...current.requirements, budget: profile.budgetCents != null },
          };
          if (!explicitSearchRequestedRef.current && !localDataClearedRef.current) {
            setBrief(hydratedBrief);
            applySearch('', hydratedBrief, { background: true });
          }
          setProfileOwner(accountUserId);
          setProfileLoadState('ready');
        } else {
          setProfileLoadState('error');
          setProfileSyncState({ status: 'error', error: { message: 'Account preferences could not be loaded. Browser preferences remain available.', code: 'PROFILE_UNAVAILABLE' } });
        }
      } catch {
        if (isActiveOwner()) {
          setProfileLoadState('error');
          setProfileSyncState({ status: 'error', error: { message: 'Account preferences could not be loaded. Browser preferences remain available.', code: 'PROFILE_UNAVAILABLE' } });
        }
        /* Keep the current browser data if account hydration is temporarily unreachable. */
      }
    })();
    return () => {
      active = false;
      controller.abort();
      authRequestControllersRef.current.delete(controller);
    };
  }, [fixtureMode, isCurrentWorkspace, syncGuestData, targetWorkspaceOwner, userId, workspaceOwner, workspaceReady]);

  const runRequest = useCallback(async (kind, getPayload, selectData, onSuccess, onError, { append = false } = {}) => {
    const requestUserId = userId;
    const requestOwner = targetWorkspaceOwner;
    const requestGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady
      && isCurrentWorkspace(requestUserId, requestOwner, requestGeneration);
    if (!isCurrentOwner()) return null;

    requests.current[kind]?.abort();
    const controller = new AbortController();
    requests.current[kind] = controller;
    const setState = { home: setHomeState, resource: setResourceState, source: setSourceState }[kind];
    const setData = { home: setHomes, resource: setResourceFeatures, source: setSourceStatus }[kind];
    setState((current) => ({ ...current, status: 'loading', error: null }));
    if (kind === 'home') setBusy(true);
    try {
      const payload = await getPayload(controller.signal);
      if (!isCurrentOwner() || controller.signal.aborted || requests.current[kind] !== controller) return null;
      const data = selectData(payload);
      if (kind === 'home') retainDecisionHomes([...homesRef.current, ...data]);
      let appliedData = data;
      if (kind === 'home' && append) {
        appliedData = mergeHomesById(homesRef.current, data);
        homesRef.current = appliedData;
        setHomes(appliedData);
      } else {
        setData(data);
        if (kind === 'home') homesRef.current = data;
      }
      if (kind === 'home') setPagination(pageState(payload, Array.isArray(payload.items) ? payload.items : data));
      setState((current) => successState(payload, kind === 'source' ? data.items || [] : appliedData, current));
      onSuccess?.(payload, data);
      return data;
    } catch (error) {
      if (!isCurrentOwner() || error?.name === 'AbortError' || controller.signal.aborted || requests.current[kind] !== controller) return null;
      setState((current) => errorState(error, current));
      onError?.(error);
      return null;
    } finally {
      if (requests.current[kind] === controller) {
        requests.current[kind] = null;
        if (kind === 'home') setBusy(false);
      }
    }
  }, [isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const loadHomes = useCallback((onSuccess, onError) => {
    retryHomeRequestRef.current = () => loadHomes(onSuccess, onError);
    return runRequest('home',
    (signal) => requestJson('/api/v1/homes', { signal }),
    (payload) => requireResultArray(payload, 'items'), (payload, data) => {
      activeHomePageRequest.current = null;
      activeHomePageSelectRef.current = null;
      onSuccess?.(payload, data);
    }, onError);
  }, [runRequest]);

  const loadResources = useCallback((bounds = null) => {
    const params = new URLSearchParams({ limit: String(RESOURCE_PAGE_LIMIT) });
    if (bounds) params.set('bounds', [bounds.west, bounds.south, bounds.east, bounds.north].join(','));
    const selectedTypes = [...mapResourceTypesRef.current];
    return runRequest('resource', async (signal) => {
      if (!selectedTypes.length) return { features: [], dataMode: 'live', hasMore: false };
      // Bound each enabled layer independently so dense park/clinic data cannot
      // consume the whole page and hide smaller community or health layers.
      const pages = await Promise.all(selectedTypes.map(type => {
        const layerParams = new URLSearchParams(params);
        layerParams.set('resource_type', type);
        return requestJson(`/api/v1/resources?${layerParams}`, { signal });
      }));
      return { ...pages[0], features: pages.flatMap(page => requireResultArray(page, 'features')),
        hasMore: pages.some(page => page.hasMore === true), nextCursor: null,
        total: pages.reduce((sum, page) => sum + (Number.isFinite(page.total) ? page.total : page.features.length), 0) };
    },
      (payload) => requireResultArray(payload, 'features'), (payload) => {
        if (Array.isArray(payload.counts)) mapResourceCountsRef.current = payload.counts;
        setResourceState((current) => ({
          ...current,
          bounds,
          limit: RESOURCE_PAGE_LIMIT,
          total: Number.isFinite(payload.total) ? payload.total : null,
          hasMore: payload.hasMore === true,
          nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
          counts: mapResourceCountsRef.current,
        }));
      });
  }, [runRequest]);

  const refreshViewport = useCallback((bounds) => {
    const normalized = normalizeViewportBounds(bounds);
    if (!normalized) return Promise.resolve(null);
    setViewportBounds(normalized);
    return loadResources(normalized);
  }, [loadResources]);

  const loadMoreHomes = useCallback(() => {
    if (!pagination.hasMore || !pagination.nextCursor) return Promise.resolve(null);
    const cursor = pagination.nextCursor;
    const pageRequest = activeHomePageRequest.current;
    const getPayload = pageRequest
      ? (signal) => pageRequest(signal, cursor)
      : (signal) => {
        const params = new URLSearchParams({ limit: String(HOME_PAGE_LIMIT), cursor });
        return requestJson(`/api/v1/homes?${params}`, { signal });
      };
    const selectData = activeHomePageSelectRef.current || (payload => requireResultArray(payload, 'items'));
    const requestPage = () => runRequest('home', getPayload, selectData, null, null, { append: true });
    retryHomeRequestRef.current = requestPage;
    return requestPage();
  }, [pagination, runRequest]);

  const loadSources = useCallback(() => runRequest('source',
    (signal) => requestJson('/api/v1/sources', { signal }), (payload) => payload), [runRequest]);

  const requireSignedIn = useCallback(async (requiredAction = 'Sign in to manage and search using saved places.') => {
    if (!userId) {
      throw new ApiError(requiredAction, { code: 'AUTH_REQUIRED', status: 401 });
    }
    const placeUserId = userId;
    const placeOwner = targetWorkspaceOwner;
    const placeGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(placeUserId, placeOwner, placeGeneration);
    if (!isCurrentOwner()) return null;
    return isCurrentOwner();
  }, [isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const refreshSavedDecisions = useCallback(async () => {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!isCurrentOwner()) return null;
    if (!ownerUserId) {
      setHistory([]);
      setHistoryState(initialHistoryState('signed_out'));
      setSavedSearches([]);
      setSavedSearchState(initialSavedSearchState('signed_out'));
      return null;
    }

    requests.current.history?.abort();
    requests.current.savedSearch?.abort();
    const historyController = new AbortController();
    const savedSearchController = new AbortController();
    requests.current.history = historyController;
    requests.current.savedSearch = savedSearchController;
    const isActiveRequest = (kind, controller) => isCurrentOwner()
      && !controller.signal.aborted
      && requests.current[kind] === controller;
    setHistoryState((current) => ({ ...current, status: 'loading', error: null }));
    setSavedSearchState((current) => ({ ...current, status: 'loading', action: null, activeId: null, error: null }));
    try {
      const isSignedIn = await requireSignedIn('Sign in to view search history and saved searches.');
      if (!isSignedIn || !isActiveRequest('history', historyController) || !isActiveRequest('savedSearch', savedSearchController)) return null;
      const headers = {};
      const loadHistory = async () => {
        try {
          const payload = await requestJson('/api/v1/history', { signal: historyController.signal, headers });
          if (!isActiveRequest('history', historyController)) return null;
          const nextHistory = requireResultArray(payload, 'items');
          setHistory(nextHistory);
          setHistoryState(initialHistoryState(nextHistory.length ? 'success' : 'empty'));
          return nextHistory;
        } catch (error) {
          if (!isActiveRequest('history', historyController) || error?.name === 'AbortError') return null;
          const details = savedSearchError(error, 'Search history is unavailable. Please try again.');
          setHistoryState(initialHistoryState(details.code === 'AUTH_REQUIRED' ? 'signed_out' : 'error', details));
          return null;
        }
      };

      const loadSavedSearches = async () => {
        try {
          const payload = await requestJson('/api/v1/saved-searches', { signal: savedSearchController.signal, headers });
          if (!isActiveRequest('savedSearch', savedSearchController)) return null;
          const nextSavedSearches = requireResultArray(payload, 'items');
          setSavedSearches(nextSavedSearches);
          setSavedSearchState((current) => ({
            ...current,
            status: nextSavedSearches.length ? 'success' : 'empty',
            action: null,
            activeId: null,
            error: null,
          }));
          return nextSavedSearches;
        } catch (error) {
          if (!isActiveRequest('savedSearch', savedSearchController) || error?.name === 'AbortError') return null;
          const details = savedSearchError(error, 'Saved searches could not be loaded. Please try again.');
          setSavedSearchState((current) => ({
            ...current,
            status: details.code === 'AUTH_REQUIRED' ? 'signed_out' : 'error',
            action: null,
            activeId: null,
            error: details,
          }));
          return null;
        }
      };
      const [nextHistory, nextSavedSearches] = await Promise.all([loadHistory(), loadSavedSearches()]);
      return { history: nextHistory, savedSearches: nextSavedSearches };
    } catch (error) {
      if (!isCurrentOwner() || error?.name === 'AbortError') return null;
      const details = savedSearchError(error, 'Search history and saved searches could not be loaded. Please try again.');
      if (isActiveRequest('history', historyController)) {
        setHistoryState(initialHistoryState(details.code === 'AUTH_REQUIRED' ? 'signed_out' : 'error', details));
      }
      if (isActiveRequest('savedSearch', savedSearchController)) {
        setSavedSearchState((current) => ({
          ...current,
          status: details.code === 'AUTH_REQUIRED' ? 'signed_out' : 'error',
          action: null,
          activeId: null,
          error: details,
        }));
      }
      return null;
    } finally {
      if (requests.current.history === historyController) requests.current.history = null;
      if (requests.current.savedSearch === savedSearchController) requests.current.savedSearch = null;
    }
  }, [requireSignedIn, isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const recordSearchHistory = useCallback(async (snapshot) => {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!ownerUserId || !isCurrentOwner() || !snapshot?.criteria) return;
    try {
      const isSignedIn = await requireSignedIn('Sign in to save search history.');
      if (!isCurrentOwner() || !isSignedIn) return;
      const headers = { 'Content-Type': 'application/json' };
      await requestJson('/api/v1/history', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: snapshot.mode,
          criteria: snapshot.criteria,
          scoring_version: snapshot.metadata.scorePolicyVersion,
        }),
      });
      if (!isCurrentOwner()) return;
      const historyPayload = await requestJson('/api/v1/history', {
        headers: {},
      });
      if (isCurrentOwner()) {
        const nextHistory = requireResultArray(historyPayload, 'items');
        setHistory(nextHistory);
        setHistoryState(initialHistoryState(nextHistory.length ? 'success' : 'empty'));
      }
    } catch {
      // A history write must not turn a successful source search into a failed search.
    }
  }, [requireSignedIn, isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const refreshPlaces = useCallback(async () => {
    const placeUserId = userId;
    const placeOwner = targetWorkspaceOwner;
    const placeGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(placeUserId, placeOwner, placeGeneration);
    if (!isCurrentOwner()) return null;
    if (!placeUserId) {
      requests.current.place?.abort();
      requests.current.place = null;
      const localPlaces = normalizeLocalPlaces(guestSnapshotRef.current?.places || readStorage('personal-places', []));
      setPlaces(localPlaces);
      setPlaceState(authenticatedPlaceState('local'));
      return localPlaces;
    }

    requests.current.place?.abort();
    const controller = new AbortController();
    requests.current.place = controller;
    setPlaceState(authenticatedPlaceState('loading'));
    try {
      const isSignedIn = await requireSignedIn();
      if (!isCurrentOwner() || !isSignedIn || controller.signal.aborted || requests.current.place !== controller) return null;
      const payload = await requestJson('/api/v1/places', {
        signal: controller.signal,
      });
      if (!isCurrentOwner() || controller.signal.aborted || requests.current.place !== controller) return null;
      const serverItems = requireResultArray(payload, 'items').map(normalizePlace);
      const items = [...serverItems, ...placesRef.current.filter(place => place.localOnly)];
      setPlaces(items);
      setPlaceState(authenticatedPlaceState(items.length ? 'success' : 'empty'));
      return items;
    } catch (error) {
      if (!isCurrentOwner() || controller.signal.aborted || requests.current.place !== controller) return null;
      if (error?.code === 'AUTH_REQUIRED') {
        setPlaces([]);
        setPlaceState(authenticatedPlaceState('signed_out', { message: error.message, code: error.code, status: error.status }));
      } else {
        const apiError = error instanceof ApiError ? error : new ApiError('Unable to load this information. Please try again.', { code: 'UNKNOWN_ERROR' });
        setPlaceState(authenticatedPlaceState('error', { message: apiError.message, code: apiError.code, status: apiError.status }));
      }
      return null;
    } finally {
      if (requests.current.place === controller) requests.current.place = null;
    }
  }, [requireSignedIn, isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const suggestPlaces = useCallback(async (queryText) => {
    const placeUserId = userId;
    const placeOwner = targetWorkspaceOwner;
    const placeGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(placeUserId, placeOwner, placeGeneration);
    try {
      if (!isCurrentOwner()) return [];
      const params = new URLSearchParams({ q: String(queryText || '').trim() });
      const payload = await requestJson(`/api/v1/places/suggest?${params}`, {
      });
      if (!isCurrentOwner()) return [];
      return requireResultArray(payload, 'items');
    } catch (error) {
      if (!isCurrentOwner()) return [];
      throw error;
    }
  }, [requireSignedIn, isCurrentWorkspace, targetWorkspaceOwner, userId, workspaceReady]);

  const createPlace = useCallback(async (candidate) => {
    candidate = { ...candidate, latitude: candidate?.latitude ?? candidate?.lat, longitude: candidate?.longitude ?? candidate?.lng };
    const placeUserId = userId;
    const placeOwner = targetWorkspaceOwner;
    const placeGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(placeUserId, placeOwner, placeGeneration);
    if (!isCurrentOwner()) return null;
    if (!isOneMapSelection(candidate) && !validManualPin(candidate)) {
      throw new ApiError('Choose an address returned by OneMap before saving a place.', { code: 'PLACE_CANDIDATE_REQUIRED', status: 422 });
    }
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const kinds = ['workplace', 'school', 'childcare', 'elder-care', 'other'];
    const maximumDistanceM = candidate.maximumDistanceM == null || candidate.maximumDistanceM === ''
      ? null
      : Number(candidate.maximumDistanceM);
    if (!label || !kinds.includes(candidate.kind)
      || (maximumDistanceM != null && (!Number.isInteger(maximumDistanceM) || maximumDistanceM < 1 || maximumDistanceM > 100_000))) {
      throw new ApiError('Enter a place label, type, and a valid maximum distance.', { code: 'INVALID_PLACE', status: 422 });
    }
    if (!placeUserId || validManualPin(candidate)) {
      localDataClearedRef.current = false;
      const place = normalizePlace({
        ...candidate,
        id: `guest-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        address: candidate.address.trim(), label, maximumDistanceM, localOnly: true,
        geocodeSource: candidate.provider === 'OneMap' ? 'OneMap' : 'user-entered',
        geocodedAt: candidate.provider === 'OneMap' ? new Date().toISOString() : null,
      });
      const nextPlaces = [...placesRef.current, place];
      setPlaces(nextPlaces);
      placesRef.current = nextPlaces;
      if (placeUserId) persistAccountWorkspace(placeUserId, { localPlaces: nextPlaces.filter(item => item.localOnly) });
      else window.localStorage.setItem('personal-places', JSON.stringify(nextPlaces));
      setPlaceState(authenticatedPlaceState('local'));
      return place;
    }
    let payload;
    try {
      const isSignedIn = await requireSignedIn();
      if (!isCurrentOwner() || !isSignedIn) return null;
      payload = await requestJson('/api/v1/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          kind: candidate.kind,
          address: candidate.address.trim(),
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          maximum_distance_m: maximumDistanceM,
          geocode_source: 'OneMap',
          selection_token: candidate.selection_token,
        }),
      });
    } catch (error) {
      if (!isCurrentOwner()) return null;
      throw error;
    }
    if (!isCurrentOwner()) return null;
    const place = normalizePlace(payload);
    setPlaces((current) => current.some((item) => item.id === place.id)
      ? current.map((item) => item.id === place.id ? place : item)
      : [...current, place]);
    setPlaceState(authenticatedPlaceState('success'));
    return place;
  }, [requireSignedIn, isCurrentWorkspace, places, targetWorkspaceOwner, userId, workspaceReady]);

  const deletePlace = useCallback(async (id) => {
    const placeUserId = userId;
    const placeOwner = targetWorkspaceOwner;
    const placeGeneration = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(placeUserId, placeOwner, placeGeneration);
    if (!isCurrentOwner()) return null;
    if (typeof id !== 'string' || !id.trim()) {
      throw new ApiError('The selected place is invalid.', { code: 'INVALID_PLACE_ID', status: 422 });
    }
    if (!placeUserId || places.some(place => place.id === id && place.localOnly)) {
      localDataClearedRef.current = false;
      const nextPlaces = places.filter(place => place.id !== id);
      setPlaces(nextPlaces);
      placesRef.current = nextPlaces;
      if (placeUserId) persistAccountWorkspace(placeUserId, { localPlaces: nextPlaces.filter(place => place.localOnly) });
      else window.localStorage.setItem('personal-places', JSON.stringify(nextPlaces));
      setBrief(current => ({ ...current, placeConstraints: (current.placeConstraints || []).filter(c => c.placeId !== id) }));
      setPlaceState(authenticatedPlaceState('local'));
      return { ok: true, localOnly: true };
    }
    let payload;
    try {
      const isSignedIn = await requireSignedIn();
      if (!isCurrentOwner() || !isSignedIn) return null;
      payload = await requestJson(`/api/v1/places/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      if (!isCurrentOwner()) return null;
      throw error;
    }
    if (!isCurrentOwner()) return null;
    const remainingPlaces = places.filter((place) => place.id !== id);
    setPlaces((current) => current.filter((place) => place.id !== id));
    setBrief((current) => ({
      ...current,
      placeConstraints: (Array.isArray(current.placeConstraints) ? current.placeConstraints : [])
        .filter((constraint) => constraint.placeId !== id),
    }));
    setPlaceState(authenticatedPlaceState(remainingPlaces.length ? 'success' : 'empty'));
    return payload;
  }, [requireSignedIn, isCurrentWorkspace, places, targetWorkspaceOwner, userId, workspaceReady]);

  const retryHomes = useCallback(() => {
    if (retryHomeRequestRef.current) return retryHomeRequestRef.current();
    if (!fixtureMode) return loadHomes();
    return Promise.resolve(applyLocalSearch(appliedQuery, appliedBrief, { bounds: appliedBounds }));
  }, [appliedBounds, appliedBrief, appliedQuery, fixtureMode, loadHomes]);

  const retryResources = useCallback(() => {
    if (!fixtureMode) return viewportBounds ? loadResources(viewportBounds) : loadResources();
    setResourceState(fixtureState([]));
    return Promise.resolve([]);
  }, [fixtureMode, loadResources, viewportBounds]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (fixtureMode) {
      const initialBrief = briefRef.current;
      if (!explicitSearchRequestedRef.current) {
        const initialHomes = applyLocalRequirements(filterHomes(fixtureHomes, '', initialBrief), initialBrief);
        setHomes(initialHomes); setAppliedBrief(cloneBrief(initialBrief));
        setHomeState(fixtureState(initialHomes));
        homesRef.current = initialHomes;
        setPagination({ limit: HOME_PAGE_LIMIT, total: initialHomes.length, nextCursor: null, hasMore: false });
        activeHomePageRequest.current = null;
      }
      setResourceState(fixtureState([]));
      setSourceState(fixtureState([]));
      return undefined;
    }
    const initialBrief = briefRef.current;
    if (!explicitSearchRequestedRef.current) {
      if (Object.keys(buildCriteria(initialBrief)).length || initialBrief.placeConstraints?.length || JSON.stringify(initialBrief.priorityWeights) !== JSON.stringify(defaultBrief.priorityWeights)) applySearch('', initialBrief, { background: true });
      else loadHomes();
    }
    loadResources();
    loadSources();
    return () => {
      for (const kind of ['home', 'resource', 'source']) {
        requests.current[kind]?.abort();
        requests.current[kind] = null;
      }
    };
  }, [fixtureMode, loadHomes, loadResources, loadSources, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (!userId) {
      requests.current.place?.abort();
      requests.current.place = null;
      setPlaces(normalizeLocalPlaces(guestSnapshotRef.current?.places || []));
      setPlaceState(authenticatedPlaceState('local'));
      return undefined;
    }
    setPlaces(current => current.filter(place => place.localOnly));
    refreshPlaces();
    return () => {
      requests.current.place?.abort();
      requests.current.place = null;
    };
  }, [refreshPlaces, targetWorkspaceOwner, userId, workspaceOwner, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    refreshSavedDecisions();
    return () => {
      requests.current.history?.abort();
      requests.current.history = null;
      requests.current.savedSearch?.abort();
      requests.current.savedSearch = null;
    };
  }, [refreshSavedDecisions, targetWorkspaceOwner, userId, workspaceOwner, workspaceReady]);

  const retryProfileSync = useCallback(async () => {
    if (!workspaceReady || !userId || profileOwner !== userId || profileLoadState !== 'ready') {
      setProfileSyncState({ status: 'local', error: null });
      return false;
    }
    const owner = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => isCurrentWorkspace(userId, owner, generation);
    setProfileSyncState({ status: 'syncing', error: null });
    try {
      await requestJson('/api/v1/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileUpdatePayload(briefRef.current)),
      });
      if (!isCurrentOwner()) return false;
      setProfileSyncState({ status: 'synced', error: null });
      return true;
    } catch (error) {
      if (!isCurrentOwner()) return false;
      setProfileSyncState({ status: 'error', error: { message: error.message, code: error.code, status: error.status } });
      return false;
    }
  }, [isCurrentWorkspace, profileLoadState, profileOwner, targetWorkspaceOwner, userId, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || profileOwner !== userId || !userId) return undefined;
    setProfileSyncState({ status: 'syncing', error: null });
    const timer = window.setTimeout(retryProfileSync, 500);
    return () => window.clearTimeout(timer);
  }, [brief.adults, brief.budget, brief.careDistance, brief.childcareDistance, brief.children, brief.olderAdults, brief.preferredFlatType, brief.preferredTowns, brief.priorityWeights, brief.schoolDistance, profileOwner, retryProfileSync, userId, workspaceReady]);

  const saveProfile = useCallback(async ({ profile = brief, onboardingCompleted } = {}) => {
    if (!userId) throw new ApiError('Sign in to save your home preferences.', { code: 'AUTH_REQUIRED', status: 401 });
    const owner = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && profileOwner === userId
      && profileLoadState === 'ready'
      && isCurrentWorkspace(userId, owner, generation);
    if (!isCurrentOwner()) {
      throw new ApiError('Your account preferences are still loading. Please try again in a moment.', { code: 'PROFILE_NOT_READY' });
    }
    const validationError = briefValidationError(profile);
    if (validationError) throw new ApiError(validationError, { code: 'INVALID_PROFILE', status: 422 });
    setProfileSyncState({ status: 'syncing', error: null });
    try {
      const saved = await requestJson('/api/v1/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileUpdatePayload(profile, onboardingCompleted)),
      });
      if (!isCurrentOwner()) throw new DOMException('The workspace owner changed.', 'AbortError');
      setProfileSyncState({ status: 'synced', error: null });
      return saved;
    } catch (error) {
      if (isCurrentOwner()) setProfileSyncState({ status: 'error', error: { message: error.message, code: error.code, status: error.status } });
      throw error;
    }
  }, [brief, isCurrentWorkspace, profileLoadState, profileOwner, targetWorkspaceOwner, userId, workspaceReady]);

  const decisionHomesById = useMemo(() => new Map(
    [...preservedDecisionHomes, ...homes]
      .filter((home) => home?.id !== null && home?.id !== undefined)
      .map((home) => [String(home.id), home]),
  ), [homes, preservedDecisionHomes]);
  const selectedHomes = useMemo(() => compareIds
    .map((id) => decisionHomesById.get(String(id)))
    .filter(Boolean), [compareIds, decisionHomesById]);
  const shortlistHomes = useMemo(() => shortlistIds
    .map((id) => decisionHomesById.get(String(id)))
    .filter(Boolean), [decisionHomesById, shortlistIds]);

  useEffect(() => {
    if (!workspaceReady || localDataClearedRef.current) return;
    const known = new Set([...preservedDecisionHomesRef.current, ...homesRef.current].map(home => home.id));
    const missing = [...new Set([...shortlistIds, ...compareIds])].filter(id => !known.has(id) && !requestedDecisionHomeIdsRef.current.has(id));
    if (!missing.length) return;
    missing.forEach(id => requestedDecisionHomeIdsRef.current.add(id));
    refreshHomeRecords(missing, { silent: true });
  }, [workspaceReady, shortlistIds, compareIds]);

  function flash(text, tone = 'info', action = null) {
    setNotice({ text, tone, action });
    window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setNotice(null), 4000);
  }

  function retainDecisionHomes(items, explicitIds = []) {
    const selectedIds = [...new Set([...shortlistIdsRef.current, ...compareIdsRef.current, ...explicitIds])];
    const known = new Map([...preservedDecisionHomesRef.current, ...homesRef.current, ...items]
      .filter(home => home?.id != null).map(home => [String(home.id), home]));
    const retained = selectedIds.map(id => known.get(String(id))).filter(Boolean);
    preservedDecisionHomesRef.current = retained;
    setPreservedDecisionHomes(retained);
    if (localDataClearedRef.current) return;
    if (typeof window !== 'undefined' && workspaceOwnerRef.current === 'guest') window.localStorage.setItem(GUEST_DECISION_HOMES_KEY, JSON.stringify(retained));
    else if (userId) persistAccountWorkspace(userId, { decisionHomes: retained });
  }

  function enqueueShortlistMutation(operation) {
    const result = shortlistMutationQueueRef.current.then(operation, operation);
    shortlistMutationQueueRef.current = result.catch(() => false);
    return result;
  }

  function ensureSaved(home, saved) {
    return mutateShortlist(home, Boolean(saved));
  }

  function toggleShortlist(home) {
    return mutateShortlist(home);
  }

  function mutateShortlist(home, desiredSaved) {
    localDataClearedRef.current = false;
    const mutationUserId = userId;
    const mutationOwner = targetWorkspaceOwner;
    const mutationGeneration = workspaceGenerationRef.current;
    return enqueueShortlistMutation(async () => {
      const isCurrentOwner = () => workspaceReady
        && isCurrentWorkspace(mutationUserId, mutationOwner, mutationGeneration);
      if (!isCurrentOwner()) return false;

      const previous = [...shortlistIdsRef.current];
      const restoreStaleAccountCache = () => {
        persistAccountShortlist(mutationUserId, previous);
        return false;
      };
      const isSaved = previous.includes(home.id);
      if (typeof desiredSaved === 'boolean' && isSaved === desiredSaved) {
        if (desiredSaved) retainDecisionHomes([home]);
        return true;
      }
      const next = isSaved ? previous.filter((id) => id !== home.id) : [...previous, home.id];
      shortlistIdsRef.current = next;
      setShortlistIds(next);
      retainDecisionHomes([home], next);

      if (!mutationUserId) {
        if (!isSaved) window.dispatchEvent(new Event(HOME_SAVED_EVENT));
        flash(isSaved ? `${home.address} removed from this browser.` : `${home.address} saved in this browser.`, isSaved ? 'info' : 'success');
        return true;
      }

      try {
        if (!isCurrentOwner()) return restoreStaleAccountCache();
        const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
        const response = await fetch(`${apiBase}/api/v1/shortlists${isSaved ? `/${encodeURIComponent(home.id)}` : ''}`, {
          method: isSaved ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: isSaved ? {} : { 'Content-Type': 'application/json' },
          body: isSaved ? undefined : JSON.stringify({ home_id: home.id }),
        });
        if (!response.ok) throw new ApiError('The account could not be updated.', { status: response.status, code: 'HTTP_ERROR' });
        if (!isCurrentOwner()) return false;
        if (!isSaved) window.dispatchEvent(new Event(HOME_SAVED_EVENT));
        flash(isSaved ? `${home.address} removed from your account shortlist.` : `${home.address} saved to your account.`, 'success');
        return true;
      } catch (error) {
        if (!isCurrentOwner()) return restoreStaleAccountCache();
        shortlistIdsRef.current = previous;
        setShortlistIds(previous);
        const unavailableSample = error?.status === 404;
        const authMessage = 'Your session expired. Please sign in again.';
        flash(isAuthenticationFailure(error)
          ? `${authMessage} Your previous shortlist was restored. Please retry after signing in.`
          : unavailableSample
            ? 'This illustrative sample cannot be saved to your account. Your previous shortlist was restored. Please try again with a source record.'
            : `${isSaved ? 'Removing' : 'Saving'} ${home.address} failed. Your previous shortlist was restored. Please try again.`, 'warning');
        return false;
      }
    });
  }

  function reorderShortlist(nextIds) {
    const mutationUserId = userId;
    const mutationOwner = targetWorkspaceOwner;
    const mutationGeneration = workspaceGenerationRef.current;
    return enqueueShortlistMutation(async () => {
      const isCurrentOwner = () => workspaceReady
        && isCurrentWorkspace(mutationUserId, mutationOwner, mutationGeneration);
      if (!isCurrentOwner()) return false;

      const previous = [...shortlistIdsRef.current];
      const restoreStaleAccountCache = () => {
        persistAccountShortlist(mutationUserId, previous);
        return false;
      };
      const next = stringArray(nextIds, 200);
      if (next.length !== previous.length || next.some((id) => !previous.includes(id))) return false;
      shortlistIdsRef.current = next;
      setShortlistIds(next);
      if (!mutationUserId) {
        flash('Shortlist order updated in this browser.', 'info');
        return true;
      }

      try {
        if (!isCurrentOwner()) return restoreStaleAccountCache();
        const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
        const response = await fetch(`${apiBase}/api/v1/shortlists/order`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ordered_home_ids: next }),
        });
        if (!response.ok) throw new ApiError('The account could not be updated.', { status: response.status, code: 'HTTP_ERROR' });
        if (!isCurrentOwner()) return false;
        flash('Shortlist order saved to your account.', 'success');
        return true;
      } catch (error) {
        if (!isCurrentOwner()) return restoreStaleAccountCache();
        shortlistIdsRef.current = previous;
        setShortlistIds(previous);
        flash(isAuthenticationFailure(error)
          ? 'Your session expired. Please sign in again. Your previous shortlist order was restored. Please retry after signing in.'
          : 'Shortlist order could not be saved. Your previous order was restored. Please try again.', 'warning');
        return false;
      }
    });
  }

  function toggleCompare(home) {
    localDataClearedRef.current = false;
    if (!workspaceReady || !isCurrentWorkspace(userId, targetWorkspaceOwner, workspaceGenerationRef.current)) return;
    const currentCompareIds = compareIdsRef.current;
    const isSelected = currentCompareIds.includes(home.id);
    if (!isSelected && currentCompareIds.length >= 3) { flash('Comparison is limited to three homes.', 'warning'); return; }
    const next = isSelected ? currentCompareIds.filter((id) => id !== home.id) : [...currentCompareIds, home.id];
    compareIdsRef.current = next;
    setCompareIds(next);
    retainDecisionHomes([home]);
    if (!isSelected) window.dispatchEvent(new CustomEvent(COMPARISON_ADDED_EVENT, { detail: { count: next.length } }));
    flash(isSelected ? `${home.address} removed from comparison.` : `${home.address} added to comparison.`, 'info');
  }

  function applyLocalSearch(nextQuery = query, overrideBrief = brief, options = {}) {
    if (!fixtureMode) return homes;
    const currentBrief = workspaceReady ? overrideBrief : defaultBrief;
    const matchingHomes = applyGuestPlaceRequirements(applyLocalRequirements(filterHomes(fixtureHomes, nextQuery, currentBrief), currentBrief), currentBrief, places);
    const results = options.bounds ? matchingHomes.filter(home => Number.isFinite(home.lat) && Number.isFinite(home.lng) && home.lng >= options.bounds.west && home.lng <= options.bounds.east && home.lat >= options.bounds.south && home.lat <= options.bounds.north) : matchingHomes;
    retainDecisionHomes(homesRef.current);
    setBrief(currentBrief);
    setQuery(nextQuery);
    setAppliedBrief(cloneBrief(currentBrief));
    setAppliedQuery(nextQuery);
    setAppliedBounds(options.bounds || null);
    setHomes(results);
    homesRef.current = results;
    setPagination({ limit: HOME_PAGE_LIMIT, total: results.length, nextCursor: null, hasMore: false });
    activeHomePageRequest.current = null;
    setHomeState(fixtureState(results));
    flash(results.length ? `${results.length} labelled fixture candidates found.` : 'No homes match every current filter. Adjust the filters to search again.', results.length ? 'info' : 'warning');
    return results;
  }

  async function applySearch(nextQuery = query, overrideBrief = brief, options = {}) {
    if (!workspaceReady) return null;
    nextQuery = String(nextQuery ?? '');
    const currentBrief = overrideBrief;
    const validationError = briefValidationError(currentBrief);
    if (validationError || nextQuery.length > 160) { flash(validationError || 'Search text must be 160 characters or fewer.', 'warning'); return null; }
    if (!options.background) {
      explicitSearchRequestedRef.current = true;
      if (localDataClearedRef.current && userId && profileLoadState === 'ready') setProfileOwner(userId);
      localDataClearedRef.current = false;
    }
    const requestBrief = cloneBrief(currentBrief);
    const requestBounds = options.bounds ? normalizeViewportBounds(options.bounds) : null;
    if (options.bounds && !requestBounds) { flash('Choose a valid map area.', 'warning'); return null; }
    if (!options.retry) { setBrief(currentBrief); setQuery(nextQuery); }
    retryHomeRequestRef.current = () => applySearch(nextQuery, requestBrief, { ...options, retry: true });
    if (fixtureMode) return applyLocalSearch(nextQuery, currentBrief, { ...options, bounds: requestBounds });
    const placeConstraints = (Array.isArray(currentBrief.placeConstraints) ? currentBrief.placeConstraints : [])
      .filter((constraint) => typeof constraint?.placeId === 'string' && constraint.placeId
        && Number.isInteger(Number(constraint.maxDistanceM))
        && Number(constraint.maxDistanceM) >= 0
        && Number(constraint.maxDistanceM) <= 100_000)
      .map((constraint) => ({ place_id: constraint.placeId, max_distance_m: Number(constraint.maxDistanceM) }));
    const localIds = new Set(places.filter(place => place.localOnly).map(place => place.id));
    const isLocalConstraint = constraint => !userId || localIds.has(constraint.place_id) || /^(guest|local)-/.test(constraint.place_id);
    const localPlaceConstraints = placeConstraints.filter(isLocalConstraint);
    const serverPlaceConstraints = placeConstraints.filter(constraint => !isLocalConstraint(constraint));
    const priorityWeights = { ...currentBrief.priorityWeights };
    let interpretationNotice = '';
    let pageRequestForSearch = null;
    let requestCriteriaForSearch = null;
    let resolvedBrief = requestBrief;
    const selectedGuestPlaces = places.map(place => ({ ...place }));
    const selectSearchResults = payload => {
      const items = requireResultArray(payload, 'items');
      return localPlaceConstraints.length ? applyGuestPlaceRequirements(items, { ...requestBrief, placeConstraints: localPlaceConstraints.map(c => ({ placeId: c.place_id, maxDistanceM: c.max_distance_m })) }, selectedGuestPlaces) : items;
    };
    const commitSearchResults = (payload, results) => {
      setAppliedBrief(cloneBrief(resolvedBrief));
      if (JSON.stringify(briefRef.current) === JSON.stringify(requestBrief) && resolvedBrief !== requestBrief) setBrief(cloneBrief(resolvedBrief));
      setAppliedQuery(nextQuery);
      setAppliedBounds(requestBounds);
        activeHomePageRequest.current = pageRequestForSearch;
        activeHomePageSelectRef.current = selectSearchResults;
        const normalizedCriteria = normalizeSavedSearchCriteria(payload?.criteria, requestCriteriaForSearch || {});
        const metadata = searchResultMetadata(payload, results);
        const snapshot = {
          mode: nextQuery.trim() ? 'natural_language' : 'structured',
          criteria: normalizedCriteria,
          priorityWeights: normalizedCriteria.priority_weights || priorityWeights,
          placeConstraints: normalizedCriteria.place_constraints || serverPlaceConstraints,
          sourceSnapshotIds: Array.isArray(payload?.sourceSnapshotIds) ? payload.sourceSnapshotIds : [],
          metadata,
          lastRunAt: new Date().toISOString(),
        };
        lastSearchSnapshotRef.current = snapshot;
        setLastSearchSnapshot(snapshot);
        if (userId) recordSearchHistory(snapshot);
        if (options.background) return;
        if (localPlaceConstraints.length) flash('Browser-only place checks apply to each loaded page using straight-line distance. Places stay in this browser; missing coordinates are excluded and totals describe the source search before local checks.', 'info');
        else if (payload.unappliedCriteria?.length) flash(`Location-based filters were not applied because transaction coordinates and verified proximity matching are not ready (${payload.unappliedCriteria.join(', ')}). ${results.length} historical records remain; these are not live listings.`, 'warning');
        else if (interpretationNotice) flash(interpretationNotice, 'warning');
        else flash(results.length ? `${results.length} dated resale records found. They are not current listings.` : 'No source records match these applied filters.', results.length ? 'info' : 'warning');
    };
    const reportSearchFailure = error => !options.background && flash(isAuthenticationFailure(error)
      ? (userId ? 'Your session expired. Please sign in again.' : 'Sign in to search using saved places.')
      : 'Search service unavailable. Previous source records remain in view; please retry.', 'warning');
    const searchRequest = runRequest('home', async (signal) => {
        let criteria = { query: nextQuery, ...searchCriteriaFromBrief(currentBrief), ...(requestBounds ? { bounds: requestBounds } : {}) };
        if (nextQuery.trim() && options.interpret !== false) {
          try {
            const headers = { 'Content-Type': 'application/json' };
            if (userId && !await requireSignedIn()) throw new DOMException('The workspace owner changed.', 'AbortError');
            const parsed = await requestJson('/api/v1/ai/interpret', { signal, method: 'POST', headers, body: JSON.stringify({ text: nextQuery }) });
            const interpreted = parsed.filters && typeof parsed.filters === 'object' && !Array.isArray(parsed.filters)
              ? parsed.filters
              : {};
            criteria = { ...mergeExplicitSearchCriteria(criteria, interpreted), query: nextQuery };
            if (!requestBounds) delete criteria.bounds;
            else criteria.bounds = requestBounds;
            if (typeof interpreted.town === 'string' && interpreted.town.trim()) delete criteria.towns;
            if (Object.keys(interpreted).length) {
              resolvedBrief = briefFromCriteria(requestBrief, criteria);
              resolvedBrief.placeConstraints = requestBrief.placeConstraints;
              const interpretedError = briefValidationError(resolvedBrief);
              if (interpretedError) throw new ApiError(interpretedError, { code: 'INVALID_INTERPRETATION' });
            }
            if (parsed.needs_clarification && parsed.clarifying_question) interpretationNotice = parsed.clarifying_question;
          } catch (error) {
            if (error?.name === 'AbortError' || signal.aborted) throw error;
            if (userId && isAuthenticationFailure(error)) throw error;
            criteria = { query: nextQuery, ...searchCriteriaFromBrief(requestBrief), ...(requestBounds ? { bounds: requestBounds } : {}) };
            resolvedBrief = requestBrief;
            interpretationNotice = 'Phrase interpretation is unavailable; searching the words as typed.';
          }
        }
        if (signal.aborted) return null;
        pageRequestForSearch = async (pageSignal, cursor) => {
          const headers = { 'Content-Type': 'application/json' };
          if (serverPlaceConstraints.length && !await requireSignedIn()) throw new DOMException('The workspace owner changed.', 'AbortError');
          const requestCriteria = {
            ...criteria,
            priority_weights: priorityWeights,
            place_constraints: serverPlaceConstraints,
            limit: HOME_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          };
          if (!cursor) {
            requestCriteriaForSearch = requestCriteria;
            retryHomeRequestRef.current = () => runRequest('home', retrySignal => pageRequestForSearch(retrySignal, null), selectSearchResults, commitSearchResults, reportSearchFailure);
          }
          return requestJson('/api/v1/search', {
            signal: pageSignal,
            method: 'POST',
            headers,
            body: JSON.stringify(requestCriteria),
          });
        };
        return pageRequestForSearch(signal, null);
      }, selectSearchResults, commitSearchResults, reportSearchFailure);
    searchInFlightRef.current = searchRequest;
    try {
      return await searchRequest;
    } finally {
      if (searchInFlightRef.current === searchRequest) searchInFlightRef.current = null;
    }
  }

  function reportSavedSearchError(error, fallbackMessage, id = null) {
    const details = savedSearchError(error, fallbackMessage);
    const missingPlace = details.code === 'SAVED_SEARCH_PLACE_UNAVAILABLE';
    setSavedSearchState((current) => ({
      ...current,
      status: missingPlace ? 'missing_place' : details.code === 'AUTH_REQUIRED' ? 'signed_out' : 'error',
      action: null,
      activeId: id,
      error: details,
    }));
    return null;
  }

  async function saveSearch(name) {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!isCurrentOwner()) return null;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!ownerUserId) {
      return reportSavedSearchError(new ApiError('Sign in to save a search.', { code: 'AUTH_REQUIRED', status: 401 }), 'Sign in to save a search.');
    }
    if (!cleanName) {
      return reportSavedSearchError(new ApiError('Enter a name for this search.', { code: 'INVALID_SAVED_SEARCH_NAME', status: 422 }), 'Enter a name for this search.');
    }
    if (searchInFlightRef.current) await searchInFlightRef.current;
    const snapshot = lastSearchSnapshotRef.current;
    if (!isCurrentOwner()) return null;
    if (!snapshot || snapshot.metadata.dataMode !== 'live' || !snapshot.metadata.scorePolicyVersion) {
      return reportSavedSearchError(new ApiError('Run a successful live search with score-policy metadata before saving it.', { code: 'SEARCH_NOT_READY', status: 409 }), 'Run a successful live search before saving it.');
    }
    setSavedSearchState((current) => ({ ...current, action: 'saving', activeId: null, error: null }));
    try {
      const isSignedIn = await requireSignedIn('Sign in to save a search.');
      if (!isCurrentOwner() || !isSignedIn) return null;
      const itemPayload = await requestJson('/api/v1/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          mode: snapshot.mode,
          criteria: snapshot.criteria,
          priority_weights: snapshot.priorityWeights,
          place_constraints: snapshot.placeConstraints,
          scoring_version: snapshot.metadata.scorePolicyVersion,
          last_run_at: snapshot.lastRunAt,
          last_source_snapshot_ids: snapshot.sourceSnapshotIds,
          last_result_meta: snapshot.metadata,
        }),
      });
      if (!isCurrentOwner()) return null;
      const item = itemPayload?.item || itemPayload;
      if (!item || typeof item.id !== 'string') throw new ApiError('The saved search response was invalid.', { code: 'INVALID_RESPONSE' });
      setSavedSearches((current) => [item, ...current.filter((saved) => saved.id !== item.id)]);
      setSavedSearchState((current) => ({ ...current, status: 'success', action: null, activeId: item.id, error: null }));
      return item;
    } catch (error) {
      if (!isCurrentOwner()) return null;
      return reportSavedSearchError(error, 'This search could not be saved. Please try again.');
    }
  }

  async function renameSavedSearch(id, name) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return reportSavedSearchError(new ApiError('Enter a name for this search.', { code: 'INVALID_SAVED_SEARCH_NAME', status: 422 }), 'Enter a name for this search.', id);
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!isCurrentOwner()) return null;
    if (!ownerUserId) return reportSavedSearchError(new ApiError('Sign in to rename saved searches.', { code: 'AUTH_REQUIRED', status: 401 }), 'Sign in to rename saved searches.', id);
    setSavedSearchState((current) => ({ ...current, action: 'renaming', activeId: id, error: null }));
    try {
      const isSignedIn = await requireSignedIn('Sign in to rename saved searches.');
      if (!isCurrentOwner() || !isSignedIn) return null;
      const payload = await requestJson(`/api/v1/saved-searches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      });
      if (!isCurrentOwner()) return null;
      const item = payload?.item || payload;
      setSavedSearches((current) => current.map((saved) => saved.id === id ? { ...saved, ...item, name: item.name || cleanName } : saved));
      setSavedSearchState((current) => ({ ...current, status: savedSearches.length ? 'success' : 'empty', action: null, activeId: id, error: null }));
      return item;
    } catch (error) {
      if (!isCurrentOwner()) return null;
      return reportSavedSearchError(error, 'This saved search could not be renamed. Please try again.', id);
    }
  }

  async function deleteSavedSearch(id) {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!isCurrentOwner()) return null;
    if (!ownerUserId) return reportSavedSearchError(new ApiError('Sign in to delete saved searches.', { code: 'AUTH_REQUIRED', status: 401 }), 'Sign in to delete saved searches.', id);
    setSavedSearchState((current) => ({ ...current, action: 'deleting', activeId: id, error: null }));
    try {
      const isSignedIn = await requireSignedIn('Sign in to delete saved searches.');
      if (!isCurrentOwner() || !isSignedIn) return null;
      const payload = await requestJson(`/api/v1/saved-searches/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!isCurrentOwner()) return null;
      const nextSearches = savedSearches.filter((saved) => saved.id !== id);
      setSavedSearches(nextSearches);
      setSavedSearchState((current) => ({
        ...current,
        status: nextSearches.length ? 'success' : 'empty',
        action: null,
        activeId: id,
        error: null,
        reruns: Object.fromEntries(Object.entries(current.reruns).filter(([savedId]) => savedId !== id)),
      }));
      return payload;
    } catch (error) {
      if (!isCurrentOwner()) return null;
      return reportSavedSearchError(error, 'This saved search could not be deleted. Please try again.', id);
    }
  }

  async function rerunSavedSearch(id) {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    const isCurrentOwner = () => workspaceReady && isCurrentWorkspace(ownerUserId, ownerKey, generation);
    if (!isCurrentOwner()) return null;
    if (!ownerUserId) return reportSavedSearchError(new ApiError('Sign in to rerun saved searches.', { code: 'AUTH_REQUIRED', status: 401 }), 'Sign in to rerun saved searches.', id);
    const saved = savedSearches.find((item) => item.id === id);
    if (!saved) return reportSavedSearchError(new ApiError('This saved search is no longer available.', { code: 'SAVED_SEARCH_NOT_FOUND', status: 404 }), 'This saved search is no longer available.', id);
    explicitSearchRequestedRef.current = true;
    retryHomeRequestRef.current = () => rerunSavedSearch(id);
    const attempt = {};
    activeSavedSearchRerunRef.current = attempt;
    const previousHomes = homesRef.current;
    const criteria = normalizeSavedSearchCriteria(saved.criteria, {});
    let responsePayload = null;
    setSavedSearchState((current) => ({ ...current, action: 'rerunning', activeId: id, error: null }));
    const pageRequest = async (signal, cursor) => {
      const headers = { 'Content-Type': 'application/json' };
      if (Array.isArray(criteria.place_constraints) && criteria.place_constraints.length) {
        const isSignedIn = await requireSignedIn('Sign in to search using saved places.');
        if (!isSignedIn || signal.aborted) throw new DOMException('The workspace owner changed.', 'AbortError');
      }
      return requestJson('/api/v1/search', {
        signal,
        method: 'POST',
        headers,
        body: JSON.stringify({ ...criteria, cursor }),
      });
    };

    const items = await runRequest('home', async (signal) => {
      const isSignedIn = await requireSignedIn('Sign in to rerun saved searches.');
      if (!isSignedIn || signal.aborted) throw new DOMException('The workspace owner changed.', 'AbortError');
      const payload = await requestJson(`/api/v1/saved-searches/${encodeURIComponent(id)}/run`, {
        signal,
        method: 'POST',
      });
      const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
      return { ...metadata, ...payload };
    }, (payload) => {
      responsePayload = payload;
      return requireResultArray(payload, 'items');
    }, (payload, results) => {
      const resultMetadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
      const metadata = searchResultMetadata(payload, results);
      const result = {
        priorMetadata: payload?.priorMetadata || null,
        metadata: { ...resultMetadata, ...metadata },
        difference: payload?.difference || null,
      };
      const sourceSnapshotIds = Array.isArray(payload?.sourceSnapshotIds) ? payload.sourceSnapshotIds : [];
      const lastRunAt = payload?.lastRunAt || new Date().toISOString();
      const selectedIds = [...new Set([...shortlistIdsRef.current, ...compareIdsRef.current].map(String))];
      const knownHomesById = new Map(
        [...preservedDecisionHomesRef.current, ...previousHomes, ...results]
          .filter((home) => home?.id !== null && home?.id !== undefined)
          .map((home) => [String(home.id), home]),
      );
      const nextPreservedHomes = selectedIds.map((homeId) => knownHomesById.get(homeId)).filter(Boolean);
      preservedDecisionHomesRef.current = nextPreservedHomes;
      setPreservedDecisionHomes(nextPreservedHomes);
      activeHomePageRequest.current = pageRequest;
      activeHomePageSelectRef.current = null;
      if (typeof criteria.query === 'string') setQuery(criteria.query);
      const restoredBrief = briefFromCriteria(briefRef.current, criteria);
      setBrief(restoredBrief);
      setAppliedBrief(cloneBrief(restoredBrief));
      setAppliedQuery(criteria.query || '');
      setAppliedBounds(criteria.bounds || null);
      const nextSnapshot = {
        mode: saved.mode || 'structured',
        criteria,
        priorityWeights: criteria.priority_weights || saved.scorePolicy?.priorityWeights || {},
        placeConstraints: criteria.place_constraints || [],
        sourceSnapshotIds,
        metadata,
        lastRunAt,
      };
      lastSearchSnapshotRef.current = nextSnapshot;
      setLastSearchSnapshot(nextSnapshot);
      const nextSearches = savedSearches.map((item) => item.id === id ? {
        ...item,
        lastRunAt,
        lastSourceSnapshotIds: sourceSnapshotIds,
        lastResultMeta: result.metadata,
      } : item);
      setSavedSearches(nextSearches);
      setSavedSearchState((current) => ({
        ...current,
        status: nextSearches.length ? 'success' : 'empty',
        action: null,
        activeId: id,
        error: null,
        reruns: { ...current.reruns, [id]: result },
      }));
      activeSavedSearchRerunRef.current = null;
      flash(results.length ? `${results.length} fresh source records returned. They are not current listings.` : 'No source records match this saved search.', results.length ? 'info' : 'warning');
    }, (error) => {
      reportSavedSearchError(error, 'This saved search could not be rerun. Your current results remain in view.', id);
    });

    if (!items && isCurrentOwner() && activeSavedSearchRerunRef.current === attempt) {
      activeSavedSearchRerunRef.current = null;
      setSavedSearchState((current) => current.action === 'rerunning' && current.activeId === id
        ? { ...current, action: null }
        : current);
    }
    return responsePayload;
  }

  async function refreshHomeRecords(ids = [...shortlistIdsRef.current, ...compareIdsRef.current], { silent = false } = {}) {
    if (!workspaceReady) return [];
    const generation = workspaceGenerationRef.current;
    const owner = targetWorkspaceOwner;
    const refreshIds = stringArray(ids, 203);
    if (fixtureMode) return fixtureHomes.filter(home => refreshIds.includes(home.id));
    const settled = await Promise.allSettled(refreshIds.map(id => requestJson(`/api/v1/homes/${encodeURIComponent(id)}`)));
    if (!isCurrentWorkspace(userId, owner, generation)) return [];
    const updated = settled.filter(result => result.status === 'fulfilled' && result.value?.id).map(result => result.value);
    retainDecisionHomes(updated);
    if (!silent) {
      if (settled.some(result => result.status === 'rejected')) flash('Some saved source records could not be refreshed. Their last browser snapshots remain available.', 'warning');
      else if (updated.length) flash('Saved source evidence refreshed.', 'success');
    }
    return updated;
  }

  function searchBounds(bounds) {
    return applySearch(appliedQuery, appliedBrief, { bounds, interpret: false });
  }

  function resetSearch() {
    const resetBrief = cloneBrief(defaultBrief);
    if (fixtureMode) {
      const results = applyLocalSearch('', resetBrief);
      flash('Search reset to the full labelled fixture set.', 'info');
      return Promise.resolve(results);
    }
    return loadHomes(() => {
      setBrief(resetBrief);
      setAppliedBrief(cloneBrief(resetBrief));
      setQuery(''); setAppliedQuery(''); setAppliedBounds(null);
      lastSearchSnapshotRef.current = null;
      setLastSearchSnapshot(null);
      flash('Neutral source search restored.', 'info');
    }, () => flash('Unable to reload source records. Previous results remain in view.', 'warning'));
  }

  async function clearLocalData() {
    if (!workspaceReady) return false;
    localDataClearedRef.current = true;
    explicitSearchRequestedRef.current = true;
    workspaceGenerationRef.current += 1;
    for (const controller of Object.values(requests.current)) controller?.abort();
    requests.current = { home: null, resource: null, source: null, place: null, history: null, savedSearch: null };
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('homecompass.') || ['family-brief', 'shortlist', 'compare-selection', 'personal-places', 'search-history'].includes(key)) window.localStorage.removeItem(key);
    }
    guestSnapshotRef.current = normalizeGuestSnapshot(null);
    preservedDecisionHomesRef.current = [];
    shortlistIdsRef.current = []; compareIdsRef.current = [];
    setPreservedDecisionHomes([]); setShortlistIds([]); setCompareIds([]);
    setBrief(cloneBrief(defaultBrief)); setAppliedBrief(cloneBrief(defaultBrief));
    setQuery(''); setAppliedQuery(''); setAppliedBounds(null); setViewportBounds(null);
    placesRef.current = [];
    setPlaces([]); setPlaceState(authenticatedPlaceState(userId ? 'empty' : 'local'));
    setHistory([]); setHistoryState(initialHistoryState(userId ? 'empty' : 'signed_out'));
    setSavedSearches([]); setSavedSearchState(initialSavedSearchState(userId ? 'empty' : 'signed_out'));
    setLastSearchSnapshot(null); lastSearchSnapshotRef.current = null; searchInFlightRef.current = null;
    activeHomePageRequest.current = null; activeHomePageSelectRef.current = null; retryHomeRequestRef.current = null;
    setPendingLocalPlaceCount(0); setSyncState('local'); setSyncResult(null);
    setProfileOwner(null); setProfileSyncState({ status: 'local', error: null });
    setHoveredHome(null); setNotice(null); setBusy(false);
    const cleanupPromises = [];
    window.dispatchEvent(new CustomEvent(LOCAL_DATA_CLEARED_EVENT, { detail: { waitUntil: promise => cleanupPromises.push(Promise.resolve(promise)) } }));
    await Promise.all(cleanupPromises);
    if (fixtureMode) {
      setHomes(fixtureHomes); homesRef.current = fixtureHomes; setHomeState(fixtureState(fixtureHomes));
      setPagination({ limit: HOME_PAGE_LIMIT, total: fixtureHomes.length, nextCursor: null, hasMore: false });
    } else {
      setHomes([]); homesRef.current = []; setHomeState(initialState('live'));
      setPagination({ limit: HOME_PAGE_LIMIT, total: 0, nextCursor: null, hasMore: false });
      await loadHomes();
    }
    flash('Browser data cleared. Account data on the server is unchanged.', 'info');
    return true;
  }

  function setOwnerState(setter, nextValue) {
    const ownerUserId = userId;
    const ownerKey = targetWorkspaceOwner;
    const generation = workspaceGenerationRef.current;
    if (!workspaceReady || !isCurrentWorkspace(ownerUserId, ownerKey, generation)) return;
    setter((current) => {
      if (!isCurrentWorkspace(ownerUserId, ownerKey, generation)) return current;
      return typeof nextValue === 'function' ? nextValue(current) : nextValue;
    });
  }

  const exposedBrief = workspaceReady ? brief : defaultBrief;
  const exposedHomes = workspaceReady ? homes : (fixtureMode ? fixtureHomes : []);
  const exposedHomeState = workspaceReady ? homeState : initialState(fixtureMode ? 'fixture' : 'live');
  const exposedPagination = workspaceReady ? pagination : {
    limit: HOME_PAGE_LIMIT,
    total: fixtureMode ? fixtureHomes.length : 0,
    nextCursor: null,
    hasMore: false,
  };
  const exposedQuery = workspaceReady ? query : '';
  const exposedBusy = workspaceReady ? busy : false;
  const exposedShortlistIds = workspaceReady ? shortlistIds : [];
  const exposedCompareIds = workspaceReady ? compareIds : [];
  const exposedPlaces = workspaceReady ? places : [];
  const exposedPlaceState = workspaceReady ? placeState : authenticatedPlaceState('idle');
  const exposedHistory = workspaceReady ? history : [];
  const exposedHistoryState = workspaceReady
    ? historyState
    : initialHistoryState(!authLoading && !userId ? 'signed_out' : 'idle');
  const exposedSavedSearches = workspaceReady ? savedSearches : [];
  const exposedSavedSearchState = workspaceReady
    ? savedSearchState
    : initialSavedSearchState(!authLoading && !userId ? 'signed_out' : 'idle');
  const exposedLastSearchSnapshot = workspaceReady ? lastSearchSnapshot : null;
  const exposedSyncState = workspaceReady ? syncState : 'local';
  const exposedSyncResult = workspaceReady ? syncResult : null;
  const exposedNotice = workspaceReady ? notice : null;
  const exposedPendingPlaceCount = workspaceReady ? pendingLocalPlaceCount : 0;
  const setCurrentBrief = (nextValue) => { if (localDataClearedRef.current && userId && profileLoadState === 'ready') setProfileOwner(userId); localDataClearedRef.current = false; explicitSearchRequestedRef.current = true; setOwnerState(setBrief, nextValue); };
  const setCurrentHomes = (nextValue) => setOwnerState(setHomes, nextValue);
  const setCurrentQuery = (nextValue) => { localDataClearedRef.current = false; explicitSearchRequestedRef.current = true; setOwnerState(setQuery, nextValue); };
  const setCurrentShortlistIds = (nextValue) => setOwnerState(setShortlistIds, nextValue);
  const setCurrentCompareIds = (nextValue) => setOwnerState(setCompareIds, nextValue);
  const value = {
    workspaceReady,
    hoveredHome,
    setHoveredHome,
    brief: exposedBrief,
    setBrief: setCurrentBrief,
    appliedBrief: workspaceReady ? appliedBrief : defaultBrief,
    appliedQuery: workspaceReady ? appliedQuery : '',
    appliedBounds: workspaceReady ? appliedBounds : null,
    searchDirty: workspaceReady && (query !== appliedQuery || JSON.stringify(brief) !== JSON.stringify(appliedBrief)),
    homes: exposedHomes,
    setHomes: setCurrentHomes,
    homeState: exposedHomeState,
    pagination: exposedPagination,
    loadMoreHomes,
    resourceFeatures,
    mapResourceTypes: mapResourceTypesRef.current,
    setMapResourceTypes: types => {
      mapResourceTypesRef.current = [...new Set(types.filter(type => resourceTypes.includes(type)))];
      return loadResources(viewportBounds);
    },
    resourceState,
    viewportBounds,
    refreshViewport,
    sourceStatus,
    sourceState,
    refreshSources: () => fixtureMode ? Promise.resolve(null) : loadSources(),
    fixtureMode,
    retryHomes,
    refreshHomeRecords,
    retryResources,
    query: exposedQuery,
    setQuery: setCurrentQuery,
    notice: exposedNotice,
    setNotice,
    busy: exposedBusy,
    shortlistIds: exposedShortlistIds,
    setShortlistIds: setCurrentShortlistIds,
    shortlistHomes: workspaceReady ? shortlistHomes : [],
    missingSavedIds: workspaceReady ? shortlistIds.filter(id => !decisionHomesById.has(String(id))) : [],
    compareIds: exposedCompareIds,
    setCompareIds: setCurrentCompareIds,
    selectedHomes: workspaceReady ? selectedHomes : [],
    toggleShortlist,
    ensureSaved,
    reorderShortlist,
    toggleCompare,
    applyLocalSearch,
    applySearch,
    resetSearch,
    searchBounds,
    clearLocalData,
    profileSyncState: workspaceReady ? profileSyncState : { status: 'local', error: null },
    retryProfileSync,
    profileLoadState: workspaceReady ? profileLoadState : userId ? 'loading' : 'signed_out',
    saveProfile,
    flash,
    places: exposedPlaces,
    placeState: exposedPlaceState,
    refreshPlaces,
    suggestPlaces,
    createPlace,
    createLocalPlace: candidate => createPlace({ ...candidate, provider: 'user-entered' }),
    deletePlace,
    history: exposedHistory,
    historyState: exposedHistoryState,
    savedSearches: exposedSavedSearches,
    savedSearchState: exposedSavedSearchState,
    lastSearchSnapshot: exposedLastSearchSnapshot,
    refreshSavedDecisions,
    saveSearch,
    renameSavedSearch,
    deleteSavedSearch,
    rerunSavedSearch,
    syncState: exposedSyncState,
    syncResult: exposedSyncResult,
    syncGuestData,
    pendingLocalPlaceCount: exposedPendingPlaceCount,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}
