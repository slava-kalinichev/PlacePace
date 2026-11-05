// Снимок гостевых данных на время подтверждения почты

import type { GuestRoute } from '../api/client';

export interface GuestPreferencesSnapshot {
  language: 'Русский' | 'English';
  privateTerminal: boolean;
  defaultTaxiTariff: 'economy' | 'comfort' | 'business';
  walkDistanceLimitM: number;
}

export interface GuestSnapshot {
  routes: GuestRoute[];
  preferences: GuestPreferencesSnapshot;
  preferencesTouched: boolean;
  savedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const STORAGE_KEY = 'pp_guest_snapshot';
// Ссылка подтверждения действует 24 часа
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const browserStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const withoutCover = (route: GuestRoute): GuestRoute => ({
  card: { ...route.card, image: null },
  payload: { ...route.payload, cover_image: null },
});

// Сохраняет снимок; при нехватке места повторяет без обложек
export function saveGuestSnapshot(
  data: Omit<GuestSnapshot, 'savedAt'>,
  storage: StorageLike | null = browserStorage(),
  now: number = Date.now(),
): boolean {
  if (!storage) return false;
  const snapshot: GuestSnapshot = { ...data, savedAt: now };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {}
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, routes: snapshot.routes.map(withoutCover) }));
    return true;
  } catch {
    return false;
  }
}

// Забирает снимок и сразу удаляет его: перенос выполнит только одна вкладка
export function claimGuestSnapshot(
  storage: StorageLike | null = browserStorage(),
  now: number = Date.now(),
): GuestSnapshot | null {
  if (!storage) return null;
  let raw: string;
  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    storage.removeItem(STORAGE_KEY);
    raw = stored;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as GuestSnapshot;
    if (!Array.isArray(parsed.routes) || !parsed.preferences || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
