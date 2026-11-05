import { describe, expect, it } from 'vitest';
import { deriveTransportRow } from './transportRow';

const t = (ru: string) => ru;
const derive = (mode: string, fare = 0) => deriveTransportRow(t, 'ru', mode, 'Старт', 'Музей', fare);

describe('deriveTransportRow', () => {
  it('прогулка бесплатна', () => {
    const row = derive('пешком', 75);
    expect(row.transportIcon).toBe('walk');
    expect(row.transportMode).toBe('Прогулка');
    expect(row.transportCost).toBe(0);
    expect(row.description).toBe('(Старт → Музей)');
  });

  it('такси определяет тариф и считается приблизительно', () => {
    const row = derive('Такси Комфорт', 400);
    expect(row.taxiTariff).toBe('comfort');
    expect(row.transportIcon).toBe('taxi_comfort');
    expect(row.isApproximateCost).toBe(true);
    expect(row.transportCost).toBe(400);
  });

  it('метро с остановками', () => {
    const row = derive('Метро (Охотный ряд - Парк культуры)', 75);
    expect(row.transportIcon).toBe('metro');
    expect(row.transportMode).toBe('Метро');
    expect(row.description).toBe('(Охотный ряд - Парк культуры)');
    expect(row.isApproximateCost).toBe(false);
  });

  it('речной транспорт', () => {
    const row = derive('Речной транспорт (Пирс А - Пирс Б)', 200);
    expect(row.transportIcon).toBe('ferry');
    expect(row.description).toBe('(Пирс А - Пирс Б)');
  });

  it('составная поездка одного вида показывает пересадки', () => {
    const row = derive('Метро (А - Б) → Метро (Б - В)');
    expect(row.transportMode).toBe('Метро (1 пересадка):');
    expect(row.compoundParts).toHaveLength(2);
  });

  it('составная поездка разных видов', () => {
    const row = derive('Метро (А - Б) → Автобус 12 (Б - В)');
    expect(row.transportMode).toBe('Составная поездка:');
    expect(row.transportIcon).toBe('transmode');
  });

  it('адреса терминалов подменяют названия', () => {
    const row = deriveTransportRow(t, 'ru', 'пешком', 'Старт', 'Музей', 0, 'ул. Тверская, 1', undefined);
    expect(row.description).toBe('(ул. Тверская, 1 → Музей)');
  });
});
