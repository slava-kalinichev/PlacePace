import { API_BASE_URL } from '../api/client';

export interface Point {
  lat: number;
  lon: number;
}

export interface TransitLeg {
  mode: string;
  route: string;
  from: string;
  to: string;
  duration_s: number;
}

// Ошибка расчёта матрицы времени в пути
export class TravelMatrixError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'TravelMatrixError';
    this.status = status;
  }
}

interface TravelMatrixResult {
  matrix: number[][];
  distances: number[][];
  modes: string[][];
  details: (TransitLeg[] | null)[][];
  fares: (number | null)[][];
  // Пара индексов для гарантированной вставки речного транспорта
  ferryForcedPair: [number, number] | null;
}

// Перегон на конкретное время отправления
export interface LegAtTimeRequest {
  from: [number, number];
  to: [number, number];
  date: string;
  time: string;
}

export interface LegAtTimeResult {
  duration_seconds: number;
  mode: string;
  legs: TransitLeg[] | null;
}

// Тумблеры автонастройки передвижения (все необязательны)
export interface TransportModeOptions {
  public_transit?: boolean;
  public_transit_submode?: 'optimal' | 'metro_only' | 'surface_only';
  taxi?: boolean;
  taxi_tariff?: 'economy' | 'comfort' | 'business';
  include_ferry?: boolean;
  // "Прогулочный приоритет"
  walk_priority?: boolean;
  // "Без составных поездок"
  no_composite?: boolean;
}

class MapService {
  private apiUrl: string = API_BASE_URL;
  private cache: Map<string, any> = new Map();

  // Матрица времени в пути: 'foot' - OSRM, 'auto' - пешком и транспорт (OSRM + OTP)

  async getTravelMatrix(points: Point[], mode: string = 'auto', date?: string, time?: string, signal?: AbortSignal, transportOptions?: TransportModeOptions): Promise<TravelMatrixResult> {
    const n = points.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    const distances: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    const modes: string[][] = Array(n).fill(null).map(() => Array(n).fill('пешком'));
    const details: (TransitLeg[] | null)[][] = Array(n).fill(null).map(() => Array(n).fill(null));
    const fares: (number | null)[][] = Array(n).fill(null).map(() => Array(n).fill(null));

    // Одна точка: перегонов нет, запрос к бэкенду не нужен
    if (n < 2) {
      return { matrix, distances, modes, details, fares, ferryForcedPair: null };
    }

    try {
      // date и time нужны, чтобы транспорт искался на время маршрута, а не на текущий момент
      const response = await fetch(`${this.apiUrl}/matrix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          coords: points.map(p => [p.lat, p.lon]),
          mode: mode,
          date: date,
          time: time,
          ...(transportOptions ? { options: transportOptions } : {})
        }),
        signal
      });

      if (!response.ok) {
        throw new TravelMatrixError(`Матрица: HTTP ${response.status}`, response.status);
      }

      const data = await response.json();
      const isSquare = (m: unknown) =>
        Array.isArray(m) && m.length === n && m.every((row) => Array.isArray(row) && row.length === n);
      if (!isSquare(data.durations) || !isSquare(data.distances)) {
        throw new TravelMatrixError('Матрица: неожиданный формат ответа');
      }
      // Для 'auto' бэкенд обязан вернуть modes
      if (mode === 'auto' && !isSquare(data.modes)) {
        throw new TravelMatrixError('Матрица: нет видов передвижения');
      }

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;

          const duration = data.durations[i][j] || 0;
          const distance = data.distances[i][j] || 0;

          matrix[i][j] = Math.ceil(duration / 60);
          distances[i][j] = distance;

          if (data.modes) {
            const modeLabel = data.modes[i][j] || 'пешком';
            // Безымянный "транспорт" - признак сбоя
            if (typeof modeLabel === 'string' && modeLabel.trim().toLowerCase() === 'транспорт') {
              throw new TravelMatrixError('Матрица: безымянный вид транспорта');
            }
            modes[i][j] = modeLabel;
            details[i][j] = data.legs?.[i]?.[j] || null;
            fares[i][j] = data.fares?.[i]?.[j] ?? null;
          } else {
            modes[i][j] = 'пешком';
          }
        }
      }

      console.log('Матрица времени в пути:', matrix);
      const ferryForcedPair: [number, number] | null =
        Array.isArray(data.ferry_forced_pair) ? [data.ferry_forced_pair[0], data.ferry_forced_pair[1]] : null;
      return { matrix, distances, modes, details, fares, ferryForcedPair };
    } catch (error) {
      // Отмену не превращаем в ошибку расчёта, я уже устал писать комментарии
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      if (error instanceof TravelMatrixError) {
        console.warn('Ошибка получения матрицы:', error.message);
        throw error;
      }
      // Сеть недоступна, оборванное соединение, невалидный JSON и т.п.
      console.warn('Ошибка получения матрицы:', error);
      throw new TravelMatrixError('Матрица: сетевая ошибка');
    }
  }

  // Пешком/транспорт для каждого перегона на его время отправления; null - не удалось посчитать
  async getLegsAtTimes(legs: LegAtTimeRequest[], transportOptions?: TransportModeOptions, signal?: AbortSignal): Promise<(LegAtTimeResult | null)[] | null> {
    if (legs.length === 0) return [];
    try {
      const response = await fetch(`${this.apiUrl}/matrix/legs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs, ...(transportOptions ? { options: transportOptions } : {}) }),
        signal
      });
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data.results) && data.results.length === legs.length ? data.results : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      console.warn('Ошибка пересчёта перегонов по времени:', error);
      return null;
    }
  }

  // Геосаджест (через бэкенд, ключ Яндекса остаётся на сервере)
  async suggestAddress(text: string): Promise<{ title: string; subtitle: string }[]> {
    try {
      const response = await fetch(`${this.apiUrl}/geosuggest?text=${encodeURIComponent(text)}`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.warn('Ошибка получения подсказок адреса:', error);
      return [];
    }
  }

  // Адрес выбранной подсказки -> координаты (Яндекс Геокодер)
  async resolveAddress(text: string): Promise<{ address: string; lat: number; lon: number } | { error: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/geosuggest/resolve?text=${encodeURIComponent(text)}`);
      const data = await response.json();
      if (!response.ok) return { error: data.error || 'Не удалось определить адрес' };
      return data;
    } catch (error) {
      console.warn('Ошибка определения координат адреса:', error);
      return { error: 'Не удалось определить адрес' };
    }
  }

  clearCache(): void {
    this.cache.clear();
    console.log('Кэш очищен');
  }
}

export const mapService = new MapService();
