import { type TransitLeg } from '../../services/mapService';

// Тумблеры автонастройки передвижения
export interface TransportModeToggles {
  publicTransit: boolean;
  publicTransitSubmode: 'optimal' | 'metro_only' | 'surface_only';
  taxi: boolean;
  taxiTariff: 'economy' | 'comfort' | 'business';
  includeFerry: boolean;
  walkPriority: boolean;
  noComposite: boolean;
}

export const DEFAULT_TRANSPORT_TOGGLES: TransportModeToggles = {
  publicTransit: true, publicTransitSubmode: 'optimal',
  taxi: false, taxiTariff: 'economy',
  includeFerry: false, walkPriority: false, noComposite: false,
};

// Вариант передвижения для ручной настройки перегона
export interface LegOption {
  // Ключ с сервера ('walk', 'metro', 'bus', 'tram', 'taxi', 'ferry'); тип string для составных вариантов
  key: string;
  duration_seconds: number;
  distance_m: number | null;
  cost: number;
  cost_approximate: boolean;
  legs: TransitLeg[] | null;
  description?: string;
  // Строка в формате modes[i][j] автовыбора
  mode_label?: string;
}

// Выбор пользователя для одного перегона (черновик до "Применить изменения")
export interface PendingLegOverride {
  fromId: number | string;
  toId: number | string;
  fromName: string;
  toName: string;
  option: LegOption;
}

// Длительность морфа перегона, мс
export const LEG_MORPH_DURATION_MS = 450;

// Кривая с лёгким перелётом для панели вариантов
export const LEG_MORPH_EASE = 'cubic-bezier(0.34, 1.35, 0.64, 1)';

// Плавная кривая без перелёта
export const LEG_COLLAPSE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Задержка появления соседних вариантов, мс
export const OPTION_STAGGER_MS = 90;

export const LEG_OPTION_LABELS: Record<string, string> = {
  walk: 'Прогулка', metro: 'Метро', mcd: 'МЦД', bus: 'Автобус', tram: 'Трамвай',
  taxi_economy: 'Такси Эконом', taxi_comfort: 'Такси Комфорт', taxi_business: 'Такси Бизнес',
  ferry: 'Речной транспорт',
  // Составная поездка (плечи разных семейств)
  transmode: 'Составная поездка',
};
