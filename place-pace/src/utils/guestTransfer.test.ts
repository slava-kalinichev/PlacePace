import { describe, expect, it } from 'vitest';
import type { GuestRoute } from '../api/client';
import { claimGuestSnapshot, saveGuestSnapshot, type GuestSnapshot } from './guestTransfer';

const createStorage = (limit = Infinity) => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
  };
};

const route = (id: number, cover: string | null): GuestRoute => ({
  card: { id, title: `Маршрут ${id}`, image: cover } as GuestRoute['card'],
  payload: { public_id: `p-${id}`, title: `Маршрут ${id}`, cover_image: cover } as GuestRoute['payload'],
});

const data = (routes: GuestRoute[]): Omit<GuestSnapshot, 'savedAt'> => ({
  routes,
  preferences: { language: 'English', privateTerminal: false, defaultTaxiTariff: 'comfort', walkDistanceLimitM: 1200 },
  preferencesTouched: true,
});

describe('снимок гостевых данных', () => {
  it('сохраняется и забирается один раз', () => {
    const storage = createStorage();
    expect(saveGuestSnapshot(data([route(1, null)]), storage, 1000)).toBe(true);
    const claimed = claimGuestSnapshot(storage, 2000);
    expect(claimed?.routes).toHaveLength(1);
    expect(claimed?.preferences.language).toBe('English');
    expect(claimed?.preferencesTouched).toBe(true);
    expect(claimGuestSnapshot(storage, 2000)).toBeNull();
  });

  it('устаревший снимок игнорируется', () => {
    const storage = createStorage();
    saveGuestSnapshot(data([route(1, null)]), storage, 0);
    expect(claimGuestSnapshot(storage, 25 * 60 * 60 * 1000)).toBeNull();
  });

  it('при нехватке места обложки отбрасываются', () => {
    const cover = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
    const storage = createStorage(3000);
    expect(saveGuestSnapshot(data([route(1, cover)]), storage, 1000)).toBe(true);
    const claimed = claimGuestSnapshot(storage, 1000);
    expect(claimed?.routes[0].payload.cover_image).toBeNull();
    expect(claimed?.routes[0].card.image).toBeNull();
  });

  it('без хранилища и с битыми данными возвращает безопасный результат', () => {
    expect(saveGuestSnapshot(data([]), null)).toBe(false);
    expect(claimGuestSnapshot(null)).toBeNull();
    const storage = createStorage();
    storage.data.set('pp_guest_snapshot', '{не json');
    expect(claimGuestSnapshot(storage)).toBeNull();
  });
});
