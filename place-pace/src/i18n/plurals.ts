// Плюрализация единиц времени с учётом языка

import type { Language } from './LanguageContext';

function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
  return many;
}

function pluralizeEn(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function hourWord(n: number, language: Language): string {
  return language === 'en' ? pluralizeEn(n, 'hour', 'hours') : pluralizeRu(n, 'час', 'часа', 'часов');
}

export function minuteWord(n: number, language: Language): string {
  return language === 'en' ? pluralizeEn(n, 'minute', 'minutes') : pluralizeRu(n, 'минута', 'минуты', 'минут');
}

export function transferWord(n: number, language: Language): string {
  return language === 'en' ? pluralizeEn(n, 'transfer', 'transfers') : pluralizeRu(n, 'пересадка', 'пересадки', 'пересадок');
}

export function pointWord(n: number, language: Language): string {
  return language === 'en' ? pluralizeEn(n, 'point', 'points') : pluralizeRu(n, 'точка', 'точки', 'точек');
}

export function paxWord(_n: number, language: Language): string {
  return language === 'en' ? 'pax' : 'чел';
}
