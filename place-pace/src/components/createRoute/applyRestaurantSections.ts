import { sectionHasChanges, createEmptyRestaurantSection, type RestaurantSectionState, type RestaurantSlot, type RestaurantCandidate } from './restaurantModel';
import { showInfoPlaque } from '../InfoPlaque';
import { type TransportModeToggles, type LegOption, type PendingLegOverride } from './transportModeTypes';
import React from 'react';
import { type TransportModeOptions } from '../../services/mapService';
import { type TransitLeg } from '../../services/mapService';

export interface HandleApplyRestaurantSectionsContext {
  appliedRestaurantSections: RestaurantSectionState[];
  appliedTransportToggles: TransportModeToggles;
  attachRememberedOptions: (route: any[], remembered: Map<string, LegOption>) => any[];
  buildFullRoute: (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => any[];
  buildRestaurantInsertionPlaces: (slot: RestaurantSlot, sectionId: number, candidate: RestaurantCandidate, visitMinutes: number) => { placesList: any[]; extraForceEdges: (number | string)[][]; } | null;
  checkTerminalReachability: (distances: number[][], placesUsed: any[], order: number[], startTerminalIndex: number | null, endTerminalIndex: number | null) => string | null;
  isAbortError: (error: unknown) => boolean;
  openSettingsForInfeasibility: (placesList: any[], matrix: number[][], preferPriorities?: boolean, minFeasibleMinutes?: number | null) => void;
  optimizeAbortControllerRef: React.RefObject<AbortController | null>;
  rememberedOriginalOptions: Map<string, LegOption>;
  reportOptimizationFailure: (error: unknown) => void;
  retagFoodPoints: (fullRoute: any[], sections: RestaurantSectionState[]) => { route: any[]; sections: RestaurantSectionState[]; };
  runOptimizationForPlaces: (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => Promise<{ result: any; matrix: number[][]; distances: number[][]; modes: string[][]; details: (TransitLeg[] | null)[][]; fares: (number | null)[][]; placesUsed: { id: any; name: any; schedule: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; }[]; startTerminalIndex: number | null; endTerminalIndex: number | null; minFeasibleMinutes: number | null; }>;
  setAppliedRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[]>>;
  setConflictRestaurantSectionId: React.Dispatch<React.SetStateAction<number | null>>;
  setConflictRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[] | null>>;
  setConflictRestaurantToast: React.Dispatch<React.SetStateAction<string | null>>;
  setConflictToggles: React.Dispatch<React.SetStateAction<TransportModeToggles | null>>;
  setRouteData: React.Dispatch<React.SetStateAction<any[]>>;
  startOptimizingUI: () => (closingModal?: boolean) => void;
  t: (ru: string) => string;
  toTransportOptions: (toggles: TransportModeToggles) => TransportModeOptions;
}

// "Применить" в "Рестораны и кафе": переоптимизация вокруг точки питания
export const handleApplyRestaurantSections = async (ctx: HandleApplyRestaurantSectionsContext, sections: RestaurantSectionState[]): Promise<boolean> => {
  const { appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildFullRoute, buildRestaurantInsertionPlaces, checkTerminalReachability, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, rememberedOriginalOptions, reportOptimizationFailure, retagFoodPoints, runOptimizationForPlaces, setAppliedRestaurantSections, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setRouteData, startOptimizingUI, t, toTransportOptions } = ctx;
  const changedSection = sections.find(s => s.restaurant && s.slot && sectionHasChanges(s, appliedRestaurantSections));
  if (!changedSection || !changedSection.restaurant || !changedSection.slot) {
    // Нечего применять
    return true;
  }

  const prevSection = appliedRestaurantSections.find(s => s.id === changedSection.id);
  // Тот же ресторан: меняются только длительность или слот
  const restaurantChanged = !prevSection?.restaurant
    || prevSection.restaurant.name !== changedSection.restaurant.name
    || prevSection.restaurant.address !== changedSection.restaurant.address;
  const toastMessage = !prevSection?.restaurant
    ? t('Ресторан "{name}" добавлен в маршрут').replace('{name}', changedSection.restaurant.name)
    : restaurantChanged
      ? t('Ресторан "{old}" заменён на "{new}"').replace('{old}', prevSection.restaurant.name).replace('{new}', changedSection.restaurant.name)
      : t('Ресторан "{name}" обновлён').replace('{name}', changedSection.restaurant.name);

  // Слот сразу после старта
  const built = buildRestaurantInsertionPlaces(
    changedSection.slot!, changedSection.id, changedSection.restaurant!, changedSection.visitMinutes
  );
  if (!built) {
    showInfoPlaque(t('Не удалось применить рестораны и кафе. Попробуйте снова.'), 'error');
    return false;
  }
  const { placesList, extraForceEdges } = built;

  const stop = startOptimizingUI();
  const signal = optimizeAbortControllerRef.current!.signal;
  try {
    const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex, minFeasibleMinutes } =
      await runOptimizationForPlaces(placesList, signal, toTransportOptions(appliedTransportToggles), undefined, extraForceEdges);
    // stop() вызывается в каждой ветке отдельно
    if (!result.success) {
      // Не поместился в слот: разрешаем как обычный конфликт расписания
      setConflictToggles(null);
      setConflictRestaurantSections(sections);
      setConflictRestaurantSectionId(changedSection.id);
      setConflictRestaurantToast(toastMessage);
      setTimeout(() => openSettingsForInfeasibility(placesUsed, matrix, false, minFeasibleMinutes), 350);
      stop(true);
      return true;
    }
    const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
    if (reachabilityIssue) {
      stop();
      showInfoPlaque(reachabilityIssue, 'error');
      return false;
    }
    const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
    const { route: taggedRoute, sections: refreshedSections } = retagFoodPoints(fullRoute, sections);
    setRouteData(taggedRoute);
    setAppliedRestaurantSections(refreshedSections.length > 0 ? refreshedSections : [createEmptyRestaurantSection()]);
    showInfoPlaque(toastMessage, 'success');
    stop(true);
    return true;
  } catch (error) {
    if (isAbortError(error)) {
      stop();
      return false;
    }
    reportOptimizationFailure(error);
    stop();
    return false;
  }
};
