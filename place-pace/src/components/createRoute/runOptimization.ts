import { api, API_BASE_URL } from '../../api/client';
import { type Point, mapService, type TransportModeOptions } from '../../services/mapService';
import { LEG_OPTION_LABELS, type PendingLegOverride } from './transportModeTypes';
import React from 'react';

export interface RunOptimizationForPlacesContext {
  endPoint: string;
  endPointCoords: { lat: number; lon: number; } | null;
  endPointToggle: boolean;
  endTime: string;
  endWithStartPoint: boolean;
  peopleCount: number;
  routeDate: string;
  scheduleCacheRef: React.RefObject<Map<number, any>>;
  startPoint: string;
  startPointCoords: { lat: number; lon: number; } | null;
  startPointToggle: boolean;
  startTime: string;
  t: (ru: string) => string;
  timeToMinutes: (timeStr: string) => number;
}

// Максимум проходов пересчёта перегонов по времени отправления
const MAX_TIME_REFINE_PASSES = 3;

// Лимит оптимизатора (с) для прохода с фиксированным порядком
const REFINE_TIME_LIMIT_S = 1;

const addDaysToDate = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const minutesToClock = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

export const runOptimizationForPlaces = async (ctx: RunOptimizationForPlacesContext, placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => {
  const { endPoint, endPointCoords, endPointToggle, endTime, endWithStartPoint, peopleCount, routeDate, scheduleCacheRef, startPoint, startPointCoords, startPointToggle, startTime, t, timeToMinutes } = ctx;
  // Расписания ручных точек (один запрос на точку за сессию)
  const missingSchedule = placesList.filter(p =>
    typeof p.id === 'number' && p.id > 0 && p.latitude != null && p.longitude != null &&
    !p.schedule && !scheduleCacheRef.current.has(p.id));
  if (missingSchedule.length > 0) {
    const fetched = await api.getPlaceSchedules(missingSchedule.map(p => ({
      id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude,
    })));
    missingSchedule.forEach(p => scheduleCacheRef.current.set(p.id, fetched[String(p.id)] ?? null));
  }

  const placesData = placesList.map(p => ({
    id: p.id,
    name: p.name,
    schedule: p.schedule ?? scheduleCacheRef.current.get(p.id) ?? null,
    work_time: p.work_time || 'Круглосуточно',
    recommended_duration: p.recommended_duration || 60,
    ticket_price: p.ticket_price || 0,
    latitude: p.latitude || 55.7558,
    longitude: p.longitude || 37.6173,
    address: p.address || t('Адрес не указан')
  }));

  const points: Point[] = placesData.map(p => ({ lat: p.latitude, lon: p.longitude }));

  // Терминалы добавляются только в точки матрицы, не в places
  const startIsTerminal = !startPointToggle && startPoint.trim().length > 0 && !!startPointCoords;
  const endIsTerminal = !endPointToggle && !endWithStartPoint && endPoint.trim().length > 0 && !!endPointCoords;
  const endIsReturnToStart = endWithStartPoint && !!startPointCoords;

  let startTerminalIndex: number | null = null;
  let endTerminalIndex: number | null = null;
  if (startIsTerminal) {
    startTerminalIndex = points.length;
    points.push({ lat: startPointCoords!.lat, lon: startPointCoords!.lon });
  }
  if (endIsTerminal) {
    endTerminalIndex = points.length;
    points.push({ lat: endPointCoords!.lat, lon: endPointCoords!.lon });
  } else if (endIsReturnToStart && startTerminalIndex !== null) {
    // Возврат к стартовому адресу использует ту же точку матрицы
    endTerminalIndex = startTerminalIndex;
  }

  // Бэкенд берёт минимум из пешего маршрута и общественного транспорта
  const { matrix, distances, modes, details, fares, ferryForcedPair } = await mapService.getTravelMatrix(
    points, 'auto', routeDate, startTime, signal, transportOptions);

  // В /api/optimize уходит матрица только по точкам посещения
  const n = placesData.length;
  const optimizeMatrix = matrix.slice(0, n).map(row => row.slice(0, n));
  // Виды перегонов для расчёта тарифа
  const optimizeModes = modes.slice(0, n).map(row => row.slice(0, n));
  // Собственная стоимость перегонов (такси, речной транспорт)
  const optimizeFares = fares.slice(0, n).map(row => row.slice(0, n));

  // Время до и от терминалов
  const startTerminalCosts = startTerminalIndex !== null
    ? placesData.map((_, idx) => matrix[startTerminalIndex!]?.[idx] || 0)
    : null;
  const endTerminalCosts = endTerminalIndex !== null
    ? placesData.map((_, idx) => matrix[idx]?.[endTerminalIndex!] || 0)
    : null;
  // Виды перегонов до и от терминалов
  const startTerminalModes = startTerminalIndex !== null
    ? placesData.map((_, idx) => modes[startTerminalIndex!]?.[idx] || 'пешком')
    : null;
  const endTerminalModes = endTerminalIndex !== null
    ? placesData.map((_, idx) => modes[idx]?.[endTerminalIndex!] || 'пешком')
    : null;
  const startTerminalFares = startTerminalIndex !== null
    ? placesData.map((_, idx) => fares[startTerminalIndex!]?.[idx] ?? null)
    : null;
  const endTerminalFares = endTerminalIndex !== null
    ? placesData.map((_, idx) => fares[idx]?.[endTerminalIndex!] ?? null)
    : null;
  // Пары, которые нужно поставить подряд (речной транспорт и ручные настройки)
  const forceEdges: (number | string)[][] = [];
  if (ferryForcedPair && ferryForcedPair[0] < n && ferryForcedPair[1] < n) {
    forceEdges.push([placesData[ferryForcedPair[0]].id, placesData[ferryForcedPair[1]].id]);
  }
  if (extraForceEdges && extraForceEdges.length > 0) {
    forceEdges.push(...extraForceEdges);
  }

  // Ручные настройки перегонов подменяют клетки матрицы и форсируются
  for (const legOverride of legOverrides || []) {
    const opt = legOverride.option;
    // mode_label в формате modes[i][j] автовыбора
    const modeLabel = opt.mode_label
      || (opt.key === 'walk' ? 'пешком'
        : opt.key.startsWith('taxi') ? (LEG_OPTION_LABELS[opt.key] || 'Такси Эконом')
        : opt.key === 'ferry' ? (opt.description || 'Речной транспорт')
        : `${LEG_OPTION_LABELS[opt.key]} (${legOverride.fromName} - ${legOverride.toName})`);
    const durationMinutes = Math.max(1, Math.ceil(opt.duration_seconds / 60));
    const fareValue = opt.cost > 0 ? opt.cost : null;

    if (legOverride.fromId === 'start-terminal' && startTerminalIndex !== null) {
      // Перегон от стартового терминала правим напрямую в массивах терминалов
      const toIdx = placesData.findIndex(p => p.id === legOverride.toId);
      if (toIdx !== -1) {
        if (startTerminalCosts) startTerminalCosts[toIdx] = durationMinutes;
        if (startTerminalModes) startTerminalModes[toIdx] = modeLabel;
        if (startTerminalFares) startTerminalFares[toIdx] = fareValue;
        matrix[startTerminalIndex][toIdx] = durationMinutes;
        modes[startTerminalIndex][toIdx] = modeLabel;
        fares[startTerminalIndex][toIdx] = fareValue;
        details[startTerminalIndex][toIdx] = opt.legs;
      }
    } else if (legOverride.toId === 'end-terminal' && endTerminalIndex !== null) {
      const fromIdx = placesData.findIndex(p => p.id === legOverride.fromId);
      if (fromIdx !== -1) {
        if (endTerminalCosts) endTerminalCosts[fromIdx] = durationMinutes;
        if (endTerminalModes) endTerminalModes[fromIdx] = modeLabel;
        if (endTerminalFares) endTerminalFares[fromIdx] = fareValue;
        matrix[fromIdx][endTerminalIndex] = durationMinutes;
        modes[fromIdx][endTerminalIndex] = modeLabel;
        fares[fromIdx][endTerminalIndex] = fareValue;
        details[fromIdx][endTerminalIndex] = opt.legs;
      }
    } else {
      const fromIdx = placesData.findIndex(p => p.id === legOverride.fromId);
      const toIdx = placesData.findIndex(p => p.id === legOverride.toId);
      if (fromIdx !== -1 && toIdx !== -1) {
        optimizeMatrix[fromIdx][toIdx] = durationMinutes;
        optimizeModes[fromIdx][toIdx] = modeLabel;
        optimizeFares[fromIdx][toIdx] = fareValue;
        // Правим и исходные матрицы: из них строятся строки таблицы
        matrix[fromIdx][toIdx] = durationMinutes;
        modes[fromIdx][toIdx] = modeLabel;
        fares[fromIdx][toIdx] = fareValue;
        details[fromIdx][toIdx] = opt.legs;
        // Ручной выбор важнее подсказки речного транспорта
        forceEdges.push([legOverride.fromId, legOverride.toId]);
      }
    }
  }

  // Тело запроса (используется и для повторной попытки)
  const buildOptimizeBody = (endTimeValue: string | null) => ({
    places: placesData,
    travel_matrix: optimizeMatrix,
    travel_modes: optimizeModes,
    travel_fares: optimizeFares,
    start_time: startTime,
    end_time: endTimeValue,
    people_count: peopleCount,
    date: routeDate,
    start_terminal_costs: startTerminalCosts,
    end_terminal_costs: endTerminalCosts,
    start_terminal_modes: startTerminalModes,
    end_terminal_modes: endTerminalModes,
    start_terminal_fares: startTerminalFares,
    end_terminal_fares: endTerminalFares,
    force_edges: forceEdges
  });

  const response = await fetch(`${API_BASE_URL}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOptimizeBody(endTime || null)),
    signal
  });

  let result = await response.json();

  // Провал из-за end_time: уточняем, сколько минут не хватает, повторным запросом без end_time
  let minFeasibleMinutes: number | null = null;
  if (!result.success && endTime) {
    try {
      const relaxedResponse = await fetch(`${API_BASE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOptimizeBody(null)),
        signal
      });
      const relaxedResult = await relaxedResponse.json();
      if (relaxedResult.success && relaxedResult.schedule?.length > 0) {
        const lastDeparture = relaxedResult.schedule[relaxedResult.schedule.length - 1].departure;
        let minutes = timeToMinutes(lastDeparture) - timeToMinutes(startTime);
        if (minutes < 0) minutes += 1440; // маршрут ушёл за полночь
        minFeasibleMinutes = minutes;
      }
    } catch {
      // Отмена или сеть: остаёмся без оценки
    }
  }

  // Транспорт открывается и закрывается по ходу маршрута: перегоны перепроверяются на время отправления
  if (result.success && result.schedule?.length > 0 && result.order?.length > 0 && transportOptions?.public_transit !== false) {
    const startMinutes = timeToMinutes(startTime);
    const baselineBucket = `${routeDate}|${Math.floor(startMinutes / 60)}`;
    // Час, на который перегон уже посчитан (по умолчанию - час старта)
    const evaluatedBucket = new Map<string, string>();
    const manualLegKeys = new Set((legOverrides || []).map(o => `${o.fromId}>${o.toId}`));
    const indexById = new Map<number | string, number>(placesData.map((p, idx) => [p.id, idx]));

    for (let pass = 0; pass < MAX_TIME_REFINE_PASSES; pass++) {
      const order: (number | string)[] = result.order;
      const schedule: { departure: string }[] = result.schedule;

      // Абсолютное время отправления с каждой точки (минуты от полуночи даты маршрута)
      let prevAbs = startMinutes;
      const departAbs: number[] = schedule.map(item => {
        let m = timeToMinutes(item.departure) + Math.floor(prevAbs / 1440) * 1440;
        if (m < prevAbs) m += 1440;
        prevAbs = m;
        return m;
      });

      // Перегоны итогового порядка: старт, между точками, финиш
      const legRefs: { i: number; j: number; kind: 'start' | 'between' | 'end'; k: number; abs: number }[] = [];
      if (startTerminalIndex !== null && !manualLegKeys.has(`start-terminal>${order[0]}`)) {
        const j = indexById.get(order[0]);
        if (j !== undefined) legRefs.push({ i: startTerminalIndex, j, kind: 'start', k: 0, abs: startMinutes });
      }
      for (let k = 0; k < order.length - 1; k++) {
        const i = indexById.get(order[k]);
        const j = indexById.get(order[k + 1]);
        if (i === undefined || j === undefined || manualLegKeys.has(`${order[k]}>${order[k + 1]}`)) continue;
        legRefs.push({ i, j, kind: 'between', k, abs: departAbs[k] });
      }
      const lastIdx = indexById.get(order[order.length - 1]);
      if (endTerminalIndex !== null && lastIdx !== undefined && !manualLegKeys.has(`${order[order.length - 1]}>end-terminal`)) {
        legRefs.push({ i: lastIdx, j: endTerminalIndex, kind: 'end', k: order.length - 1, abs: departAbs[order.length - 1] });
      }

      // Такси и речной транспорт (собственная цена) от времени не зависят
      const toCheck = legRefs.filter(ref => {
        if (fares[ref.i][ref.j] != null) return false;
        const bucket = `${addDaysToDate(routeDate, Math.floor(ref.abs / 1440))}|${Math.floor((ref.abs % 1440) / 60)}`;
        return bucket !== (evaluatedBucket.get(`${ref.i}>${ref.j}`) ?? baselineBucket);
      });
      if (toCheck.length === 0) break;

      const answers = await mapService.getLegsAtTimes(toCheck.map(ref => ({
        from: [points[ref.i].lat, points[ref.i].lon],
        to: [points[ref.j].lat, points[ref.j].lon],
        date: addDaysToDate(routeDate, Math.floor(ref.abs / 1440)),
        time: minutesToClock(ref.abs),
      })), transportOptions, signal);
      if (!answers) break;

      const undo: (() => void)[] = [];
      toCheck.forEach((ref, idx) => {
        evaluatedBucket.set(`${ref.i}>${ref.j}`,
          `${addDaysToDate(routeDate, Math.floor(ref.abs / 1440))}|${Math.floor((ref.abs % 1440) / 60)}`);
        const answer = answers[idx];
        if (!answer || (answer.mode || '').trim().toLowerCase() === 'транспорт') return;
        const minutes = Math.ceil((answer.duration_seconds || 0) / 60);
        const mode = answer.mode || 'пешком';
        if (minutes === matrix[ref.i][ref.j] && mode === modes[ref.i][ref.j]) return;

        const oldMinutes = matrix[ref.i][ref.j];
        const oldMode = modes[ref.i][ref.j];
        const oldDetails = details[ref.i][ref.j];
        matrix[ref.i][ref.j] = minutes;
        modes[ref.i][ref.j] = mode;
        details[ref.i][ref.j] = answer.legs || null;
        undo.push(() => { matrix[ref.i][ref.j] = oldMinutes; modes[ref.i][ref.j] = oldMode; details[ref.i][ref.j] = oldDetails; });

        // Копии для оптимизатора обновляем вместе с исходными матрицами
        if (ref.kind === 'between') {
          const oldOptMinutes = optimizeMatrix[ref.i][ref.j];
          const oldOptMode = optimizeModes[ref.i][ref.j];
          optimizeMatrix[ref.i][ref.j] = minutes;
          optimizeModes[ref.i][ref.j] = mode;
          undo.push(() => { optimizeMatrix[ref.i][ref.j] = oldOptMinutes; optimizeModes[ref.i][ref.j] = oldOptMode; });
        } else if (ref.kind === 'start' && startTerminalCosts && startTerminalModes) {
          const oldCost = startTerminalCosts[ref.j];
          const oldTermMode = startTerminalModes[ref.j];
          startTerminalCosts[ref.j] = minutes;
          startTerminalModes[ref.j] = mode;
          undo.push(() => { startTerminalCosts[ref.j] = oldCost; startTerminalModes[ref.j] = oldTermMode; });
        } else if (ref.kind === 'end' && endTerminalCosts && endTerminalModes) {
          const oldCost = endTerminalCosts[ref.i];
          const oldTermMode = endTerminalModes[ref.i];
          endTerminalCosts[ref.i] = minutes;
          endTerminalModes[ref.i] = mode;
          undo.push(() => { endTerminalCosts[ref.i] = oldCost; endTerminalModes[ref.i] = oldTermMode; });
        }
      });
      if (undo.length === 0) break;

      // Порядок уже найден: повторный проход с фиксированной цепочкой и коротким лимитом
      const chain = order.slice(0, -1).map((id, k) => [id, order[k + 1]]);
      const refinedResponse = await fetch(`${API_BASE_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildOptimizeBody(endTime || null), force_edges: chain, time_limit_seconds: REFINE_TIME_LIMIT_S }),
        signal
      });
      const refined = await refinedResponse.json();
      if (!refined.success) {
        // С реальным временем отправления расписание не сходится: остаёмся на прежнем результате
        undo.forEach(fn => fn());
        break;
      }
      result = refined;
    }
  }

  return { result, matrix, distances, modes, details, fares, placesUsed: placesData, startTerminalIndex, endTerminalIndex, minFeasibleMinutes };
};
