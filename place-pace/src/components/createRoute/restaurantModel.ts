import { type Language } from '../../i18n/LanguageContext';
import { DICTIONARY } from '../../i18n/dictionary';

export const MIN_RESTAURANT_VISIT_MINUTES = 10;

export const DEFAULT_RESTAURANT_VISIT_MINUTES = 45;

export const MAX_RESTAURANT_VISIT_MINUTES = 120;

// Точка маршрута для окна ресторанов (без перегонов и согласованных старта/финиша)
export const isRestaurantVisitPoint = (item: any): boolean => {
  if (item.type === 'transport') return false;
  if (item.type === 'start' && item.icon === 'start') return false;
  if (item.type === 'end' && item.icon === 'finish') return false;
  return true;
};

// Точка слота - полный элемент routeData
export type RestaurantVisitPoint = any;

// Кандидат из живого поиска 2GIS
export interface RestaurantCandidate {
  id: string;
  name: string;
  address: string;
  workTime: string;
  // null у ещё не оценённых заведений
  rating: number | null;
  avgCheck?: number;
  // Кухня необязательна (может быть несколько через запятую)
  cuisine?: string;
  distanceMeters: number;
  lat: number;
  lon: number;
}

// Слот - пара соседних точек (храним только id)
export interface RestaurantSlot {
  beforeId: number | string;
  afterId: number | string;
}

export interface RestaurantSectionState {
  id: number;
  restaurant: RestaurantCandidate | null;
  visitMinutes: number;
  slotMode: 'recommended' | 'custom';
  slot: RestaurantSlot | null;
  // Черновое состояние редактирования раздела
  editingSlot: boolean;
  expandedCandidateId: string | null;
}

let restaurantSectionIdCounter = 1;

// Выдаёт id раздела (существующий id учитывается, чтобы новые не пересекались с ним)
export const claimRestaurantSectionId = (existingId?: number | null): number => {
  const id = existingId ?? restaurantSectionIdCounter++;
  restaurantSectionIdCounter = Math.max(restaurantSectionIdCounter, id + 1);
  return id;
};

export const createEmptyRestaurantSection = (): RestaurantSectionState => ({
  id: restaurantSectionIdCounter++,
  restaurant: null,
  visitMinutes: DEFAULT_RESTAURANT_VISIT_MINUTES,
  slotMode: 'recommended',
  slot: null,
  editingSlot: false,
  expandedCandidateId: null,
});

export const parseRestaurantTimeMinutes = (t: string | undefined): number | null => {
  if (!t || t === '--:--' || t === '-') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

export const formatRestaurantDistance = (meters: number, language: Language): string => {
  const t = (ru: string) => (language === 'en' ? (DICTIONARY[ru] ?? ru) : ru);
  if (meters < 1000) return `${Math.round(meters)} ${t('м')}`;
  return `${(meters / 1000).toFixed(1)} ${t('км')}`;
};

// "—" для заведения без рейтинга
export const formatRestaurantRating = (rating: number | null): string =>
  rating != null ? rating.toFixed(1) : '—';

const restaurantHaversineM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export const restaurantDurationTrackBackground = (minutes: number): string => {
  const percent = ((minutes - MIN_RESTAURANT_VISIT_MINUTES) / (MAX_RESTAURANT_VISIT_MINUTES - MIN_RESTAURANT_VISIT_MINUTES)) * 100;
  return `linear-gradient(to right, #007AFF 0%, #007AFF ${percent}%, #E5E7EB ${percent}%, #E5E7EB 100%)`;
};

export interface RestaurantGap {
  beforeId: number | string;
  afterId: number | string;
  startMinutes: number;
  endMinutes: number;
  // Расстояние между точками до и после зазора
  distanceMeters: number;
}

// Зазоры между парами соседних точек посещения
export const computeRestaurantGaps = (visitPoints: RestaurantVisitPoint[]): RestaurantGap[] => {
  const gaps: RestaurantGap[] = [];
  for (let i = 0; i < visitPoints.length - 1; i++) {
    const before = visitPoints[i];
    const after = visitPoints[i + 1];
    const start = parseRestaurantTimeMinutes(before.endTime || before.time);
    let end = parseRestaurantTimeMinutes(after.time);
    if (start === null || end === null) continue;
    if (end <= start) end += 1440;
    const distanceMeters = (before.latitude != null && after.latitude != null)
      ? restaurantHaversineM(before.latitude, before.longitude, after.latitude, after.longitude)
      : 0;
    gaps.push({ beforeId: before.id, afterId: after.id, startMinutes: start, endMinutes: end, distanceMeters });
  }
  return gaps;
};

const RESTAURANT_LUNCH_TARGET_MIN = 13 * 60;

// Максимальное расстояние между точками зазора
const RESTAURANT_GAP_MAX_DISTANCE_M = 1800;

// Выбор рекомендуемых слотов: первый - обеденное время, остальные - как можно дальше от занятых
export const assignRecommendedRestaurantSlots = (
  gaps: RestaurantGap[], count: number, existingMidpoints: number[] = []
): (RestaurantGap | null)[] => {
  const remaining = [...gaps];
  // Середины уже занятых слотов, мин
  const chosenMidpoints: number[] = [...existingMidpoints];
  // Пул зазоров: близкие в приоритете
  const candidatePool = (): RestaurantGap[] => {
    const nearby = remaining.filter(g => g.distanceMeters <= RESTAURANT_GAP_MAX_DISTANCE_M);
    return nearby.length > 0 ? nearby : remaining;
  };
  const pickClosestTo = (target: number): RestaurantGap | null => {
    if (remaining.length === 0) return null;
    const pool = candidatePool();
    let best: RestaurantGap | null = null;
    let bestDist = Infinity;
    pool.forEach(g => {
      const mid = (g.startMinutes + g.endMinutes) / 2;
      const dist = Math.abs(mid - target);
      if (dist < bestDist) { bestDist = dist; best = g; }
    });
    if (!best) return null;
    const idx = remaining.indexOf(best);
    return remaining.splice(idx, 1)[0];
  };
  const pickFarthestFromChosen = (): RestaurantGap | null => {
    if (remaining.length === 0) return null;
    const pool = candidatePool();
    let best: RestaurantGap | null = null;
    let bestScore = -Infinity;
    pool.forEach(g => {
      const mid = (g.startMinutes + g.endMinutes) / 2;
      // Оценка: расстояние по времени от занятых точек питания
      const score = chosenMidpoints.length === 0
        ? 0
        : Math.min(...chosenMidpoints.map(m => Math.abs(mid - m)));
      if (score > bestScore) { bestScore = score; best = g; }
    });
    if (!best) return null;
    const idx = remaining.indexOf(best);
    return remaining.splice(idx, 1)[0];
  };
  const result: (RestaurantGap | null)[] = [];
  for (let i = 0; i < count; i++) {
    const picked = chosenMidpoints.length === 0 && i === 0
      ? pickClosestTo(RESTAURANT_LUNCH_TARGET_MIN)
      : pickFarthestFromChosen();
    if (picked) chosenMidpoints.push((picked.startMinutes + picked.endMinutes) / 2);
    result.push(picked);
  }
  return result;
};

// Сигнатура применённого состояния (для кнопки "Применить изменения")
export const restaurantSectionsSignature = (list: RestaurantSectionState[]): string =>
  list
    .filter(s => s.restaurant !== null)
    .map(s => `${s.id}:${s.restaurant!.id}:${s.visitMinutes}:${s.slot ? `${s.slot.beforeId}-${s.slot.afterId}` : 'none'}`)
    .join('|');

const restaurantSectionSignatureOne = (s: RestaurantSectionState | null): string =>
  s && s.restaurant
    ? `${s.restaurant.id}:${s.visitMinutes}:${s.slot ? `${s.slot.beforeId}-${s.slot.afterId}` : 'none'}`
    : 'empty';

// Есть ли у раздела неприменённые изменения
export const sectionHasChanges = (section: RestaurantSectionState, applied: RestaurantSectionState[]): boolean => {
  const appliedMatch = applied.find(s => s.id === section.id) ?? null;
  return restaurantSectionSignatureOne(section) !== restaurantSectionSignatureOne(appliedMatch);
};

// Цвет контура новой точки (blue-400)
export const RESTAURANT_NEW_POINT_BORDER_COLOR = '#60A5FA';

// Фон применённой точки (как у bg-blue-50/40)
export const RESTAURANT_ACCENT_BG = 'rgba(239, 246, 255, 0.4)';

// Строка-заглушка новой точки
