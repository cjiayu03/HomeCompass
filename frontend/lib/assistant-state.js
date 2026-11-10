'use client';

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set();
export function setAssistantOpen(value) {
  const next = typeof value === 'function' ? value(open) : value;
  if (open === next) return;
  open = Boolean(next);
  listeners.forEach(listener => listener());
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function useAssistantOpen() {
  return [useSyncExternalStore(subscribe, () => open, () => false), setAssistantOpen];
}

let summaryRequest = null;
let requestId = 0;
export function requestAssistantSummary(home, ownerId) {
  summaryRequest = { id: ++requestId, homeId: String(home.id), address: home.address, ownerId: String(ownerId) };
  setAssistantOpen(true);
  listeners.forEach(listener => listener());
}
export function clearAssistantSummary() {
  summaryRequest = null;
  listeners.forEach(listener => listener());
}
export function useAssistantSummary() {
  return useSyncExternalStore(subscribe, () => summaryRequest, () => null);
}
