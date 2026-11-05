import { describe, expect, it } from 'vitest';
import { extractRouteCoords } from './routeCoords';

describe('extractRouteCoords', () => {
  it('возвращает координаты по порядку', () => {
    const data = [{ latitude: 55.75, longitude: 37.61 }, { latitude: 55.76, longitude: 37.62 }];
    expect(extractRouteCoords(data)).toEqual([[55.75, 37.61], [55.76, 37.62]]);
  });

  it('пропускает строки без координат и некорректные значения', () => {
    const data = [
      { name: 'Транспорт' },
      { latitude: NaN, longitude: 37 },
      { latitude: 95, longitude: 37 },
      { latitude: 55, longitude: 190 },
      { latitude: '55', longitude: 37 },
      { latitude: 55.75, longitude: 37.61 },
    ];
    expect(extractRouteCoords(data)).toEqual([[55.75, 37.61]]);
  });

  it('убирает подряд идущие дубли', () => {
    const point = { latitude: 55.75, longitude: 37.61 };
    expect(extractRouteCoords([point, { ...point }, { latitude: 55.8, longitude: 37.7 }, point])).toHaveLength(3);
  });

  it('пустой ввод даёт пустой список', () => {
    expect(extractRouteCoords(null)).toEqual([]);
    expect(extractRouteCoords(undefined)).toEqual([]);
    expect(extractRouteCoords([])).toEqual([]);
  });
});
