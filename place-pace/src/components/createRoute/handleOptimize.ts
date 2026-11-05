import { type TransportModeOptions, type TransitLeg } from '../../services/mapService';
import { formatNameList } from './formatNameList';
import { showInfoPlaque } from '../InfoPlaque';
import { createEmptyRestaurantSection, type RestaurantSectionState } from './restaurantModel';
import { type TransportModeToggles, type LegOption, type PendingLegOverride } from './transportModeTypes';
import { type Language } from '../../i18n/LanguageContext';
import React from 'react';
import type { Place as ApiPlace } from '../../api/client';

export interface HandleOptimizeContext {
  appliedRestaurantSections: RestaurantSectionState[];
  appliedTransportToggles: TransportModeToggles;
  attachRememberedOptions: (route: any[], remembered: Map<string, LegOption>) => any[];
  buildAppliedFoodForceEdges: (sections: RestaurantSectionState[], idsInScope: Set<number | string>) => (number | string)[][];
  buildFullRoute: (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => any[];
  checkTerminalReachability: (distances: number[][], placesUsed: any[], order: number[], startTerminalIndex: number | null, endTerminalIndex: number | null) => string | null;
  endPoint: string;
  endPointCoords: { lat: number; lon: number; } | null;
  endPointToggle: boolean;
  endTime: string;
  endWithStartPoint: boolean;
  isAbortError: (error: unknown) => boolean;
  language: Language;
  lastOptimizedInputsRef: React.RefObject<string | null>;
  openSettingsForInfeasibility: (placesList: any[], matrix: number[][], preferPriorities?: boolean, minFeasibleMinutes?: number | null) => void;
  optimizeAbortControllerRef: React.RefObject<AbortController | null>;
  peopleCount: number;
  rememberedOriginalOptions: Map<string, LegOption>;
  reportOptimizationFailure: (error: unknown) => void;
  restaurantSectionToPlace: (section: RestaurantSectionState) => { id: string; name: string; work_time: string; recommended_duration: number; ticket_price: number; latitude: number; longitude: number; address: string; };
  retagFoodPoints: (fullRoute: any[], sections: RestaurantSectionState[]) => { route: any[]; sections: RestaurantSectionState[]; };
  routeData: any[];
  routeDate: string;
  runOptimizationForPlaces: (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => Promise<{ result: any; matrix: number[][]; distances: number[][]; modes: string[][]; details: (TransitLeg[] | null)[][]; fares: (number | null)[][]; placesUsed: { id: any; name: any; schedule: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; }[]; startTerminalIndex: number | null; endTerminalIndex: number | null; minFeasibleMinutes: number | null; }>;
  selectedAttractions: ApiPlace[];
  setAppliedRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[]>>;
  setConflictToggles: React.Dispatch<React.SetStateAction<TransportModeToggles | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setRememberedOriginalOptions: React.Dispatch<React.SetStateAction<Map<string, LegOption>>>;
  setRouteData: React.Dispatch<React.SetStateAction<any[]>>;
  startOptimizingUI: () => (closingModal?: boolean) => void;
  startPoint: string;
  startPointCoords: { lat: number; lon: number; } | null;
  startPointToggle: boolean;
  startTime: string;
  t: (ru: string) => string;
  validateStep2: () => boolean;
}

export const handleOptimize = async (ctx: HandleOptimizeContext) => {
  const { appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, checkTerminalReachability, endPoint, endPointCoords, endPointToggle, endTime, endWithStartPoint, isAbortError, language, lastOptimizedInputsRef, openSettingsForInfeasibility, optimizeAbortControllerRef, peopleCount, rememberedOriginalOptions, reportOptimizationFailure, restaurantSectionToPlace, retagFoodPoints, routeData, routeDate, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setConflictToggles, setCurrentStep, setRememberedOriginalOptions, setRouteData, startOptimizingUI, startPoint, startPointCoords, startPointToggle, startTime, t, validateStep2 } = ctx;
  if (!validateStep2()) return;

  // Снимок входных данных для проверки изменений
  const currentOptimizeInputsSnapshot = JSON.stringify({
    ids: selectedAttractions.map(a => a.id),
    routeDate, startTime, endTime, peopleCount,
    startPoint, startPointCoords, startPointToggle,
    endPoint, endPointCoords, endPointToggle, endWithStartPoint,
  });
  if (routeData.length > 0 && lastOptimizedInputsRef.current === currentOptimizeInputsSnapshot) {
    setCurrentStep(2);
    return;
  }

  const stop = startOptimizingUI();
  const signal = optimizeAbortControllerRef.current!.signal;

  // Первая оптимизация учитывает appliedTransportToggles
  const transportOptions: TransportModeOptions = {
    public_transit: appliedTransportToggles.publicTransit,
    public_transit_submode: appliedTransportToggles.publicTransitSubmode,
    taxi: appliedTransportToggles.taxi,
    taxi_tariff: appliedTransportToggles.taxiTariff,
    include_ferry: appliedTransportToggles.includeFerry,
    walk_priority: appliedTransportToggles.walkPriority,
    no_composite: appliedTransportToggles.noComposite,
  };

  // Точки питания оптимизируются как обычные точки
  const foodPlaces = appliedRestaurantSections.filter(s => s.restaurant).map(restaurantSectionToPlace);
  const placesList = [...selectedAttractions, ...foodPlaces];
  const appliedFoodForceEdges = buildAppliedFoodForceEdges(appliedRestaurantSections, new Set(placesList.map(p => p.id)));

  try {
    const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex, minFeasibleMinutes } =
      await runOptimizationForPlaces(placesList, signal, transportOptions, undefined, appliedFoodForceEdges);
    stop();

    if (!result.success) {
      console.error('Ошибка оптимизации:', result.error, result.excluded_places, result.warnings);

      if (result.suggested_start_time) {
        showInfoPlaque(t('Точки ещё закрыты в это время. Начните не раньше {time}').replace('{time}', result.suggested_start_time), 'warning');
        return;
      }

      if (result.excluded_places && result.excluded_places.length > 0) {
        showInfoPlaque(t('Закрыты в выбранную дату: {names}').replace('{names}', formatNameList(result.excluded_places, language)), 'error');
        return;
      }

      // Первая оптимизация: конфликт не связан с "Режим передвижения"
      setConflictToggles(null);
      openSettingsForInfeasibility(placesUsed, matrix, false, minFeasibleMinutes);
      return;
    }

    const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
    if (reachabilityIssue) {
      setCurrentStep(1);
      showInfoPlaque(reachabilityIssue, 'error');
      return;
    }

    console.log('Маршрут оптимизирован:', result);

    // Предупреждение о праздниках в дату маршрута
    if (result.holiday_places && result.holiday_places.length > 0) {
      showInfoPlaque(
        t('В праздничный день часы работы могут отличаться: {names}. Уточните по телефону')
          .replace('{names}', formatNameList(result.holiday_places, language)),
        'warning',
      );
    }
    const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
    const { route: taggedRoute, sections: refreshedSections } = retagFoodPoints(fullRoute, appliedRestaurantSections);
    setRouteData(taggedRoute);
    setAppliedRestaurantSections(refreshedSections.length > 0 ? refreshedSections : [createEmptyRestaurantSection()]);
    setCurrentStep(2);
    lastOptimizedInputsRef.current = currentOptimizeInputsSnapshot;
    // Сброс запомненных вариантов для нового маршрута
    setRememberedOriginalOptions(new Map());
    setConflictToggles(null);

  } catch (error) {
    stop();
    // Отмена пользователем: тихо возвращаемся на этап 2
    if (isAbortError(error)) return;
    console.error('Ошибка:', error);
    // Не удалось построить: возвращаемся на этап 2
    setCurrentStep(1);
    reportOptimizationFailure(error);
  }
};
