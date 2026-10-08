import { useEffect, useState, useSyncExternalStore } from 'react';
import { timeAgo } from './news';

// The service worker (web/sw/sw.js) answers from storage when there is no connection, and marks
// those answers with these two headers. This file turns that into something the screen can say:
// "sin conexión · actualizado hace 5 min".

const SAVED_AT = 'x-step-back-saved-at';
const FROM_STORAGE = 'x-step-back-from-storage';

/** The oldest copy shown since the last live answer (epoch ms), or null when everything is live. */
let oldestSaved: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Called with the headers of every answer from the API. */
export function noteResponse(headers: Headers): void {
  if (headers.get(FROM_STORAGE) === '1') {
    const savedAt = Number(headers.get(SAVED_AT));
    if (Number.isFinite(savedAt) && savedAt > 0) {
      oldestSaved = oldestSaved === null ? savedAt : Math.min(oldestSaved, savedAt);
      emit();
    }
  } else if (oldestSaved !== null) {
    oldestSaved = null; // a live answer: the connection is back
    emit();
  }
}

/** For tests. */
export function resetOfflineState(): void {
  oldestSaved = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

export interface OfflineState {
  /** True when the browser has no connection, or what is shown is a stored copy. */
  offline: boolean;
  /** When the oldest copy shown was saved (epoch ms), if any copy is shown. */
  savedAt: number | null;
}

export function useOfflineState(): OfflineState {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const savedAt = useSyncExternalStore(subscribe, () => oldestSaved);
  return { offline: !online || savedAt !== null, savedAt };
}

/** "Sin conexión · actualizado hace 5 min", or just "Sin conexión" when nothing stored is shown. */
export function offlineMessage(savedAt: number | null, now: Date, timeZone: string): string {
  if (savedAt === null) return 'Sin conexión';
  return `Sin conexión · actualizado ${timeAgo(new Date(savedAt).toISOString(), now, timeZone)}`;
}

/** The current time, refreshed every `everyMs`, so "hace 5 min" keeps counting. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
