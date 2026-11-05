import { describe, expect, it } from 'vitest';
import { computeRouteAggregates, sanitizeFilename } from './routeExport';

describe('sanitizeFilename', () => {
  it('заменяет символы, запрещённые в именах файлов', () => {
    expect(sanitizeFilename('  Москва: за день/2?  ')).toBe('Москва_ за день_2_');
  });

  it('оставляет обычное название без изменений', () => {
    expect(sanitizeFilename('Москва за один день')).toBe('Москва за один день');
  });
});

describe('computeRouteAggregates', () => {
  it('считает длительность и стоимость', () => {
    const data = [{ time: '10:00', cost: 0 }, { time: '12:00', cost: 100.4 }, { time: '13:30', cost: 50.4 }];
    expect(computeRouteAggregates(data)).toEqual({ duration: 210, cost: 151 });
  });

  it('учитывает переход через полночь', () => {
    expect(computeRouteAggregates([{ time: '23:00' }, { time: '01:00' }]).duration).toBe(120);
  });

  it('пустой маршрут', () => {
    expect(computeRouteAggregates([])).toEqual({ duration: 0, cost: 0 });
  });
});
