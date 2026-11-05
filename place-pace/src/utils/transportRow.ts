// Вид транспорта, иконка и подпись плеча по строке travelMode

import { transferWord } from '../i18n/plurals';
import type { Language } from '../i18n/LanguageContext';

// Слово семейства -> ключ иконки
const FAMILY_WORD_ICON: Record<string, string> = {
  'Метро': 'metro', 'Автобус': 'bus', 'Трамвай': 'tram', 'МЦД': 'metro',
};

// Определяет вид, иконку и подпись плеча (перегоны и плечи до терминалов)

// fromAddressOverride/toAddressOverride - реальные адреса терминалов вместо "Старт"/"Финиш"
export function deriveTransportRow(
  t: (ru: string) => string,
  language: Language,
  travelMode: string, fromName: string, toName: string, legFare: number = 0,
  fromAddressOverride?: string, toAddressOverride?: string,
) {
  const isWalking = travelMode === 'пешком';
  // Такси и речной транспорт проверяем до разбора по первому слову
  const isTaxi = travelMode.startsWith('Такси');
  const isFerry = travelMode.startsWith('Речной транспорт');
  const firstWord = travelMode.split(' ')[0];
  let transportShortLabel = 'Прогулка';
  let transportIcon = 'walk';
  let taxiTariff: 'economy' | 'comfort' | 'business' | null = null;
  if (isTaxi) {
    transportShortLabel = travelMode; // "Такси Эконом" целиком - без сокращений
    taxiTariff = travelMode.includes('Бизнес') ? 'business' : travelMode.includes('Комфорт') ? 'comfort' : 'economy';
    transportIcon = `taxi_${taxiTariff}`;
  } else if (isFerry) {
    transportShortLabel = 'Речной транспорт'; transportIcon = 'ferry';
  } else if (!isWalking) {
    if (firstWord in FAMILY_WORD_ICON) {
      transportShortLabel = firstWord; transportIcon = FAMILY_WORD_ICON[firstWord];
    } else {
      transportShortLabel = 'Транспорт'; transportIcon = 'metro';
    }
  }
  // Составная поездка - плечи разных семейств
  const legParts = !isWalking && !isTaxi && !isFerry && travelMode.includes(' → ') ? travelMode.split(' → ') : null;
  let pureFamilyWord: string | null = null;
  if (legParts) {
    const firstWords = legParts.map(p => p.split(' ')[0]);
    if (firstWords.every(w => w === firstWords[0])) {
      pureFamilyWord = firstWords[0];
      transportIcon = FAMILY_WORD_ICON[pureFamilyWord] || 'metro';
    } else {
      transportIcon = 'transmode';
    }
  }

  let transportMode: string;
  let description: string;
  let compoundParts: string[] | null = null;

  if (isWalking) {
    transportMode = t(transportShortLabel);
    // В скобках адрес терминала вместо служебного слова
    description = `(${t(fromAddressOverride ?? fromName)} → ${t(toAddressOverride ?? toName)})`;
  } else if (isTaxi) {
    transportMode = t(transportShortLabel);
    // У такси в скобках адреса точек, а не остановки
    description = `(${t(fromAddressOverride ?? fromName)} - ${t(toAddressOverride ?? toName)})`;
  } else if (isFerry) {
    transportMode = t(transportShortLabel);
    // Описание причалов уже есть в travelMode
    description = travelMode.slice(transportShortLabel.length).trim();
  } else if (legParts && pureFamilyWord) {
    const transfers = legParts.length - 1;
    transportMode = `${t(pureFamilyWord)} (${transfers} ${transferWord(transfers, language)}):`;
    compoundParts = legParts;
    description = '';
  } else if (legParts) {
    transportMode = t('Составная поездка:');
    compoundParts = legParts;
    description = '';
  } else if (travelMode.startsWith(`${transportShortLabel} `)) {
    // Остаток после названия вида - "(А - Б)"
    transportMode = t(transportShortLabel);
    description = travelMode.slice(transportShortLabel.length + 1);
  } else {
    transportMode = t(transportShortLabel);
    description = `(${travelMode})`;
  }

  return {
    transportMode, transportIcon, description, compoundParts, taxiTariff,
    transportCost: isWalking ? 0 : legFare,
    // Такси считается приблизительно
    isApproximateCost: isTaxi,
  };
}
