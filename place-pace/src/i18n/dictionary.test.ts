import { describe, expect, it } from 'vitest';
import { DICTIONARY } from './dictionary';

const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe('словарь переводов', () => {
  const entries = Object.entries(DICTIONARY);

  it('не пустой', () => {
    expect(entries.length).toBeGreaterThan(100);
  });

  it('у каждой фразы есть непустой перевод', () => {
    const empty = entries.filter(([ru, en]) => !ru.trim() || !en.trim()).map(([ru]) => ru);
    expect(empty).toEqual([]);
  });

  it('подстановки вида {name} совпадают в оригинале и переводе', () => {
    const mismatched = entries.filter(([ru, en]) => placeholders(ru).join() !== placeholders(en).join()).map(([ru]) => ru);
    expect(mismatched).toEqual([]);
  });
});
