import { type Language } from '../../i18n/LanguageContext';
import { DICTIONARY } from '../../i18n/dictionary';

// Список названий для плашки (с сокращением)
export function formatNameList(names: string[], language: Language): string {
  const t = (ru: string) => (language === 'en' ? (DICTIONARY[ru] ?? ru) : ru);
  if (names.length <= 2) return names.join(', ');
  return t('{a} и ещё {n}').replace('{a}', names.slice(0, 2).join(', ')).replace('{n}', String(names.length - 2));
}
