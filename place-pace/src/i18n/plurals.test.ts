import { describe, expect, it } from 'vitest';
import { hourWord, minuteWord, paxWord, pointWord, transferWord } from './plurals';

describe('русские формы числительных', () => {
  it.each([
    [1, 'час'], [2, 'часа'], [4, 'часа'], [5, 'часов'], [11, 'часов'],
    [12, 'часов'], [21, 'час'], [22, 'часа'], [100, 'часов'], [111, 'часов'], [112, 'часов'],
  ])('%i -> %s', (n, word) => {
    expect(hourWord(n, 'ru')).toBe(word);
  });

  it('минуты, пересадки и точки', () => {
    expect(minuteWord(1, 'ru')).toBe('минута');
    expect(minuteWord(3, 'ru')).toBe('минуты');
    expect(minuteWord(13, 'ru')).toBe('минут');
    expect(transferWord(2, 'ru')).toBe('пересадки');
    expect(pointWord(5, 'ru')).toBe('точек');
  });
});

describe('английские формы', () => {
  it('единственное и множественное число', () => {
    expect(hourWord(1, 'en')).toBe('hour');
    expect(hourWord(2, 'en')).toBe('hours');
    expect(minuteWord(0, 'en')).toBe('minutes');
    expect(pointWord(1, 'en')).toBe('point');
  });

  it('сокращение для числа людей', () => {
    expect(paxWord(3, 'en')).toBe('pax');
    expect(paxWord(3, 'ru')).toBe('чел');
  });
});
