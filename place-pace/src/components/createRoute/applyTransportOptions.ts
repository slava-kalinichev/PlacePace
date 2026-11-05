import { type TransportModeOptions } from '../../services/mapService';
import { type LegOption, type PendingLegOverride, type TransportModeToggles } from './transportModeTypes';
import { showInfoPlaque } from '../InfoPlaque';
import { createEmptyRestaurantSection, type RestaurantSectionState } from './restaurantModel';
import React from 'react';
import type { Place as ApiPlace } from '../../api/client';
import { type TransitLeg } from '../../services/mapService';

export interface HandleApplyTransportOptionsContext {
  appliedRestaurantSections: RestaurantSectionState[];
  attachRememberedOptions: (route: any[], remembered: Map<string, LegOption>) => any[];
  buildAppliedFoodForceEdges: (sections: RestaurantSectionState[], idsInScope: Set<number | string>) => (number | string)[][];
  buildFullRoute: (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => any[];
  buildPreserveTransportOverrides: (route: any[], excludeEdgeKeys: Set<string>) => PendingLegOverride[];
  checkTerminalReachability: (distances: number[][], placesUsed: any[], order: number[], startTerminalIndex: number | null, endTerminalIndex: number | null) => string | null;
  isAbortError: (error: unknown) => boolean;
  openSettingsForInfeasibility: (placesList: any[], matrix: number[][], preferPriorities?: boolean, minFeasibleMinutes?: number | null) => void;
  optimizeAbortControllerRef: React.RefObject<AbortController | null>;
  pendingLegOverrides: Map<string, PendingLegOverride>;
  pendingOverrideRowHeights: React.RefObject<Map<string, number>>;
  pickerRevealTimeoutRef: React.RefObject<number | null>;
  rememberedOriginalOptions: Map<string, LegOption>;
  reportOptimizationFailure: (error: unknown) => void;
  restaurantSectionToPlace: (section: RestaurantSectionState) => { id: string; name: string; work_time: string; recommended_duration: number; ticket_price: number; latitude: number; longitude: number; address: string; };
  retagFoodPoints: (fullRoute: any[], sections: RestaurantSectionState[]) => { route: any[]; sections: RestaurantSectionState[]; };
  routeData: any[];
  routePointToPlace: (item: any) => { id: any; name: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; };
  runOptimizationForPlaces: (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => Promise<{ result: any; matrix: number[][]; distances: number[][]; modes: string[][]; details: (TransitLeg[] | null)[][]; fares: (number | null)[][]; placesUsed: { id: any; name: any; schedule: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; }[]; startTerminalIndex: number | null; endTerminalIndex: number | null; minFeasibleMinutes: number | null; }>;
  selectedAttractions: ApiPlace[];
  setAppliedRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[]>>;
  setAppliedTransportToggles: React.Dispatch<React.SetStateAction<TransportModeToggles>>;
  setConflictToggles: React.Dispatch<React.SetStateAction<TransportModeToggles | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setLegOptions: React.Dispatch<React.SetStateAction<LegOption[] | undefined>>;
  setPendingLegOverrides: React.Dispatch<React.SetStateAction<Map<string, PendingLegOverride>>>;
  setPickerRevealed: React.Dispatch<React.SetStateAction<boolean>>;
  setRememberedOriginalOptions: React.Dispatch<React.SetStateAction<Map<string, LegOption>>>;
  setRouteData: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedLegId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setTableMorphDone: React.Dispatch<React.SetStateAction<boolean>>;
  startOptimizingUI: () => (closingModal?: boolean) => void;
  t: (ru: string) => string;
}

// "Применить" в "Режим передвижения": переоптимизация с новыми тумблерами
export const handleApplyTransportOptions = async (ctx: HandleApplyTransportOptionsContext, toggles: TransportModeToggles): Promise<boolean> => {
  const { appliedRestaurantSections, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, buildPreserveTransportOverrides, checkTerminalReachability, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, pendingLegOverrides, pendingOverrideRowHeights, pickerRevealTimeoutRef, rememberedOriginalOptions, reportOptimizationFailure, restaurantSectionToPlace, retagFoodPoints, routeData, routePointToPlace, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictToggles, setCurrentStep, setLegOptions, setPendingLegOverrides, setPickerRevealed, setRememberedOriginalOptions, setRouteData, setSelectedLegId, setTableMorphDone, startOptimizingUI, t } = ctx;
  const stop = startOptimizingUI();
  const signal = optimizeAbortControllerRef.current!.signal;
  try {
    const transportOptions: TransportModeOptions = {
      public_transit: toggles.publicTransit,
      public_transit_submode: toggles.publicTransitSubmode,
      taxi: toggles.taxi,
      taxi_tariff: toggles.taxiTariff,
      include_ferry: toggles.includeFerry,
      walk_priority: toggles.walkPriority,
      no_composite: toggles.noComposite,
    };
    // Запоминаем исходную составную поездку перед ручной настройкой
    for (const override of pendingLegOverrides.values()) {
      const overrideKey = `${override.fromId}-${override.toId}`;
      if (override.option.key === 'transmode') {
        // Возврат к исходному варианту: память не нужна
        setRememberedOriginalOptions(prev => {
          if (!prev.has(overrideKey)) return prev;
          const next = new Map(prev);
          next.delete(overrideKey);
          return next;
        });
      } else if (!rememberedOriginalOptions.has(overrideKey)) {
        const currentRow = routeData.find(r => r.fromId === override.fromId && r.toId === override.toId);
        if (currentRow && currentRow.icon === 'transmode') {
          const originalOption: LegOption = {
            key: 'transmode',
            duration_seconds: (currentRow.travelTime || 0) * 60,
            distance_m: currentRow.distance ?? null,
            cost: currentRow.cost || 0,
            cost_approximate: !!currentRow.costApproximate,
            legs: currentRow.legs || null,
            mode_label: (currentRow.compoundParts || []).join(' → ') || undefined,
          };
          setRememberedOriginalOptions(prev => new Map(prev).set(overrideKey, originalOption));
        }
      }
    }
    // Ручной выбор перегона: переоптимизация без перестановки остальных точек
    const hasLegOverrides = pendingLegOverrides.size > 0;
    const foodPlaces = appliedRestaurantSections.filter(s => s.restaurant).map(restaurantSectionToPlace);
    const placesList = hasLegOverrides
      ? routeData.filter(item => item.type === 'attraction' || item.type === 'food').map(routePointToPlace)
      : [...selectedAttractions, ...foodPlaces];
    const extraForceEdges = hasLegOverrides
      ? placesList.slice(0, -1).map((p, i) => [p.id, placesList[i + 1].id] as (number | string)[])
      // Применённые точки питания остаются в слотах
      : buildAppliedFoodForceEdges(appliedRestaurantSections, new Set(placesList.map(p => p.id)));
    // Остальные перегоны сохраняют текущий транспорт
    const legOverridesArg = hasLegOverrides
      ? [...pendingLegOverrides.values(), ...buildPreserveTransportOverrides(routeData, new Set(pendingLegOverrides.keys()))]
      : Array.from(pendingLegOverrides.values());
    const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex, minFeasibleMinutes } =
      await runOptimizationForPlaces(placesList, signal, transportOptions, legOverridesArg, extraForceEdges);
    // stop() вызывается в каждой ветке отдельно

    if (result.success) {
      const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
      if (reachabilityIssue) {
        stop(true);
        setCurrentStep(1);
        setTimeout(() => showInfoPlaque(reachabilityIssue, 'error'), 350);
        return true;
      }
      const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
      const { route: taggedRoute, sections: refreshedSections } = retagFoodPoints(fullRoute, appliedRestaurantSections);
      setRouteData(taggedRoute);
      setAppliedRestaurantSections(refreshedSections.length > 0 ? refreshedSections : [createEmptyRestaurantSection()]);
      // Запоминаем тумблеры после успешной переоптимизации
      setAppliedTransportToggles(toggles);
      // Черновик перегона одноразовый
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
      setTimeout(() => showInfoPlaque(t('Режим передвижения обновлён'), 'success'), 350);
      stop(true);
      return true;
    }

    // Конфликт по времени: открываем настройки времени
    setConflictToggles(toggles);
    // placesUsed включает точки питания
    setTimeout(() => openSettingsForInfeasibility(placesUsed, matrix, false, minFeasibleMinutes), 350);
    stop(true);
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      stop();
      return false;
    }
    reportOptimizationFailure(error);
    stop(true);
    return true;
  }
};
