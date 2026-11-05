import { MIN_VISIT_MINUTES } from './SettingsModal';
import { type TransportModeOptions } from '../../services/mapService';
import { DEFAULT_RESTAURANT_VISIT_MINUTES, MIN_RESTAURANT_VISIT_MINUTES, createEmptyRestaurantSection, type RestaurantSectionState } from './restaurantModel';
import { showInfoPlaque } from '../InfoPlaque';
import { type TransportModeToggles, type LegOption, type PendingLegOverride } from './transportModeTypes';
import React from 'react';
import type { Place as ApiPlace } from '../../api/client';
import { type TransitLeg } from '../../services/mapService';

export interface HandleApplyTimeSettingsContext {
  appliedRestaurantSections: RestaurantSectionState[];
  appliedTransportToggles: TransportModeToggles;
  attachRememberedOptions: (route: any[], remembered: Map<string, LegOption>) => any[];
  baseDurations: { [id: number]: number; };
  buildAppliedFoodForceEdges: (sections: RestaurantSectionState[], idsInScope: Set<number | string>) => (number | string)[][];
  buildFullRoute: (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => any[];
  buildPreserveTransportOverrides: (route: any[], excludeEdgeKeys: Set<string>) => PendingLegOverride[];
  checkTerminalReachability: (distances: number[][], placesUsed: any[], order: number[], startTerminalIndex: number | null, endTerminalIndex: number | null) => string | null;
  conflictRestaurantSections: RestaurantSectionState[] | null;
  conflictToggles: TransportModeToggles | null;
  currentStep: number;
  isAbortError: (error: unknown) => boolean;
  openSettingsForInfeasibility: (placesList: any[], matrix: number[][], preferPriorities?: boolean, minFeasibleMinutes?: number | null) => void;
  optimizeAbortControllerRef: React.RefObject<AbortController | null>;
  pendingAttractions: ApiPlace[] | null;
  pendingLegOverrides: Map<string, PendingLegOverride>;
  pendingOverrideRowHeights: React.RefObject<Map<string, number>>;
  pickerRevealTimeoutRef: React.RefObject<number | null>;
  rememberedOriginalOptions: Map<string, LegOption>;
  reportOptimizationFailure: (error: unknown) => void;
  resolveConflictRestaurantToast: (refreshedSections: RestaurantSectionState[]) => { message: string; kind: "success" | "warning"; } | null;
  restaurantSectionsBaseline: RestaurantSectionState[];
  restaurantSectionToPlace: (section: RestaurantSectionState) => { id: string; name: string; work_time: string; recommended_duration: number; ticket_price: number; latitude: number; longitude: number; address: string; };
  retagFoodPoints: (fullRoute: any[], sections: RestaurantSectionState[]) => { route: any[]; sections: RestaurantSectionState[]; };
  routeData: any[];
  routePointToPlace: (item: any) => { id: any; name: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; };
  runOptimizationForPlaces: (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => Promise<{ result: any; matrix: number[][]; distances: number[][]; modes: string[][]; details: (TransitLeg[] | null)[][]; fares: (number | null)[][]; placesUsed: { id: any; name: any; schedule: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; }[]; startTerminalIndex: number | null; endTerminalIndex: number | null; minFeasibleMinutes: number | null; }>;
  selectedAttractions: ApiPlace[];
  setAppliedRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[]>>;
  setAppliedTransportToggles: React.Dispatch<React.SetStateAction<TransportModeToggles>>;
  setConflictRestaurantSectionId: React.Dispatch<React.SetStateAction<number | null>>;
  setConflictRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[] | null>>;
  setConflictRestaurantToast: React.Dispatch<React.SetStateAction<string | null>>;
  setConflictToggles: React.Dispatch<React.SetStateAction<TransportModeToggles | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setLegOptions: React.Dispatch<React.SetStateAction<LegOption[] | undefined>>;
  setPendingAttractions: React.Dispatch<React.SetStateAction<ApiPlace[] | null>>;
  setPendingLegOverrides: React.Dispatch<React.SetStateAction<Map<string, PendingLegOverride>>>;
  setPickerRevealed: React.Dispatch<React.SetStateAction<boolean>>;
  setRouteData: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedAttractions: React.Dispatch<React.SetStateAction<ApiPlace[]>>;
  setSelectedLegId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setTableMorphDone: React.Dispatch<React.SetStateAction<boolean>>;
  startOptimizingUI: () => (closingModal?: boolean) => void;
  t: (ru: string) => string;
  toTransportOptions: (toggles: TransportModeToggles) => TransportModeOptions;
}

// "Настройка времени": пересчёт с выбранными длительностями
export const handleApplyTimeSettings = async (ctx: HandleApplyTimeSettingsContext, timeSettings: { [key: number]: number }): Promise<boolean> => {
  const { appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, baseDurations, buildAppliedFoodForceEdges, buildFullRoute, buildPreserveTransportOverrides, checkTerminalReachability, conflictRestaurantSections, conflictToggles, currentStep, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, pendingAttractions, pendingLegOverrides, pendingOverrideRowHeights, pickerRevealTimeoutRef, rememberedOriginalOptions, reportOptimizationFailure, resolveConflictRestaurantToast, restaurantSectionsBaseline, restaurantSectionToPlace, retagFoodPoints, routeData, routePointToPlace, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setCurrentStep, setLegOptions, setPendingAttractions, setPendingLegOverrides, setPickerRevealed, setRouteData, setSelectedAttractions, setSelectedLegId, setTableMorphDone, startOptimizingUI, t, toTransportOptions } = ctx;
  // База: последняя отклонённая попытка или подтверждённый маршрут
  const baseline = pendingAttractions ?? selectedAttractions;

  const updated = baseline.map((place, index) => {
    const pct = timeSettings[index] !== undefined ? timeSettings[index] : 50;
    // Шкала как в SettingsModal: центр - исходная рекомендованная длительность
    const recommended = Math.max(baseDurations[place.id] ?? place.recommended_duration ?? 60, MIN_VISIT_MINUTES + 1);
    const minutes = pct <= 50
      ? Math.round(MIN_VISIT_MINUTES + (pct / 50) * (recommended - MIN_VISIT_MINUTES))
      : Math.round(recommended + ((pct - 50) / 50) * recommended);
    return { ...place, recommended_duration: minutes };
  });

  // При конфликте от "Режим передвижения" пересчитываем с теми же тумблерами
  const transportOptions: TransportModeOptions = toTransportOptions(conflictToggles ?? appliedTransportToggles);

  const stop = startOptimizingUI();
  const signal = optimizeAbortControllerRef.current!.signal;
  try {
    // Точки питания идут после обычных точек
    const foodSections = restaurantSectionsBaseline.filter(s => s.restaurant);
    const updatedFoodSections = foodSections.map((section, i) => {
      const index = baseline.length + i;
      const pct = timeSettings[index] !== undefined ? timeSettings[index] : 50;
      const recommended = DEFAULT_RESTAURANT_VISIT_MINUTES;
      const minutes = pct <= 50
        ? Math.round(MIN_RESTAURANT_VISIT_MINUTES + (pct / 50) * (recommended - MIN_RESTAURANT_VISIT_MINUTES))
        : Math.round(recommended + ((pct - 50) / 50) * recommended);
      return { ...section, visitMinutes: minutes };
    });
    // Конфликт мог прийти из ручной настройки перегонов
    const hasLegOverrides = pendingLegOverrides.size > 0;
    let placesList: any[];
    let extraForceEdges: (number | string)[][];
    if (hasLegOverrides) {
      const updatedById = new Map(updated.map(p => [p.id, p]));
      const updatedFoodById = new Map(updatedFoodSections.map(s => [`restaurant-${s.id}`, s]));
      placesList = routeData
        .filter(item => item.type === 'attraction' || item.type === 'food')
        .map(item => {
          if (item.type === 'food') {
            const sec = updatedFoodById.get(item.id);
            return sec ? restaurantSectionToPlace(sec) : routePointToPlace(item);
          }
          return updatedById.get(item.id) || routePointToPlace(item);
        });
      extraForceEdges = placesList.slice(0, -1).map((p, i) => [p.id, placesList[i + 1].id]);
    } else {
      placesList = [...updated, ...updatedFoodSections.map(restaurantSectionToPlace)];
      // Применённые точки питания остаются в слотах
      extraForceEdges = buildAppliedFoodForceEdges(appliedRestaurantSections, new Set(placesList.map(p => p.id)));
    }
    // Остальные перегоны сохраняют текущий транспорт
    const legOverridesArg = hasLegOverrides
      ? [...pendingLegOverrides.values(), ...buildPreserveTransportOverrides(routeData, new Set(pendingLegOverrides.keys()))]
      : undefined;

    const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex, minFeasibleMinutes } = await runOptimizationForPlaces(placesList, signal, transportOptions, legOverridesArg, extraForceEdges);
    // stop() вызывается в каждой ветке отдельно
    if (result.success) {
      const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
      if (reachabilityIssue) {
        stop(true);
        setPendingAttractions(null);
        setCurrentStep(1);
        setTimeout(() => showInfoPlaque(reachabilityIssue, 'error'), 350);
        return true;
      }

      // Попытка сработала: коммитим как актуальный маршрут
      setSelectedAttractions(updated);
      setPendingAttractions(null);
      const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
      const nextRestaurantSections = restaurantSectionsBaseline.map(s => updatedFoodSections.find(u => u.id === s.id) ?? s);
      const { route: taggedRoute, sections: refreshedSections } = retagFoodPoints(fullRoute, nextRestaurantSections);
      setRouteData(taggedRoute);
      setAppliedRestaurantSections(refreshedSections.length > 0 ? refreshedSections : [createEmptyRestaurantSection()]);
      setCurrentStep(2);
      // Конфликт "Режим передвижения" разрешён: фиксируем тумблеры
      if (conflictToggles) {
        setAppliedTransportToggles(conflictToggles);
        setConflictToggles(null);
      }
      // Конфликт "Рестораны и кафе" разрешён
      if (conflictRestaurantSections) {
        const toastInfo = resolveConflictRestaurantToast(refreshedSections);
        setConflictRestaurantSections(null);
        setConflictRestaurantSectionId(null);
        setConflictRestaurantToast(null);
        if (toastInfo) {
          setTimeout(() => showInfoPlaque(toastInfo.message, toastInfo.kind), 350);
        }
      }
      // Сбрасываем черновик ручной настройки перегона
      if (hasLegOverrides) {
        setSelectedLegId(null);
        setLegOptions(undefined);
        setPendingLegOverrides(new Map());
        pendingOverrideRowHeights.current.clear();
        setPickerRevealed(false);
        setTableMorphDone(false);
        if (pickerRevealTimeoutRef.current) {
          clearTimeout(pickerRevealTimeoutRef.current);
          pickerRevealTimeoutRef.current = null;
        }
      }
      stop(true);
      return true;
    }

    // Провал на первой оптимизации: возвращаемся на этап 2
    if (currentStep === 1) {
      setPendingAttractions(null);
      // Плашка чуть задержана: окно настроек ещё закрывается
      setTimeout(() => {
        showInfoPlaque(t('Не удалось построить маршрут. Измените точки или параметры'), 'error');
      }, 350);
      stop(true);
      return true;
    }

    // Была успешная оптимизация: остаёмся в цикле конфликта
    setPendingAttractions(updated);
    // preferPriorities: настройка времени уже провалилась, открываем "Приоритеты"
    stop();
    openSettingsForInfeasibility(placesUsed, matrix, true, minFeasibleMinutes);
    return false;
  } catch (error) {
    // Отмена: окно настроек остаётся как было
    if (isAbortError(error)) {
      stop();
      return false;
    }
    console.error('Ошибка применения настройки времени:', error);
    reportOptimizationFailure(error);
    stop(true);
    return true;
  }
};
