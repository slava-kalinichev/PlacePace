import { type TransportModeOptions } from '../../services/mapService';
import { showInfoPlaque } from '../InfoPlaque';
import { createEmptyRestaurantSection, type RestaurantSectionState } from './restaurantModel';
import { formatNameList } from './formatNameList';
import { type TransportModeToggles, type LegOption, type PendingLegOverride } from './transportModeTypes';
import React from 'react';
import type { Place as ApiPlace } from '../../api/client';
import { type TransitLeg } from '../../services/mapService';
import { type Language } from '../../i18n/LanguageContext';

export interface HandleApplyPrioritiesContext {
  appliedRestaurantSections: RestaurantSectionState[];
  appliedTransportToggles: TransportModeToggles;
  attachRememberedOptions: (route: any[], remembered: Map<string, LegOption>) => any[];
  buildAppliedFoodForceEdges: (sections: RestaurantSectionState[], idsInScope: Set<number | string>) => (number | string)[][];
  buildFullRoute: (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => any[];
  checkTerminalReachability: (distances: number[][], placesUsed: any[], order: number[], startTerminalIndex: number | null, endTerminalIndex: number | null) => string | null;
  conflictRestaurantSectionId: number | null;
  conflictRestaurantSections: RestaurantSectionState[] | null;
  conflictToggles: TransportModeToggles | null;
  isAbortError: (error: unknown) => boolean;
  language: Language;
  openTransportModeModal: () => void;
  optimizeAbortControllerRef: React.RefObject<AbortController | null>;
  rememberedOriginalOptions: Map<string, LegOption>;
  reportOptimizationFailure: (error: unknown) => void;
  resolveConflictRestaurantToast: (refreshedSections: RestaurantSectionState[]) => { message: string; kind: "success" | "warning"; } | null;
  restaurantSectionsBaseline: RestaurantSectionState[];
  restaurantSectionToPlace: (section: RestaurantSectionState) => { id: string; name: string; work_time: string; recommended_duration: number; ticket_price: number; latitude: number; longitude: number; address: string; };
  retagFoodPoints: (fullRoute: any[], sections: RestaurantSectionState[]) => { route: any[]; sections: RestaurantSectionState[]; };
  runOptimizationForPlaces: (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => Promise<{ result: any; matrix: number[][]; distances: number[][]; modes: string[][]; details: (TransitLeg[] | null)[][]; fares: (number | null)[][]; placesUsed: { id: any; name: any; schedule: any; work_time: any; recommended_duration: any; ticket_price: any; latitude: any; longitude: any; address: any; }[]; startTerminalIndex: number | null; endTerminalIndex: number | null; minFeasibleMinutes: number | null; }>;
  selectedAttractions: ApiPlace[];
  setAppliedRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[]>>;
  setAppliedTransportToggles: React.Dispatch<React.SetStateAction<TransportModeToggles>>;
  setConflictRestaurantSectionId: React.Dispatch<React.SetStateAction<number | null>>;
  setConflictRestaurantSections: React.Dispatch<React.SetStateAction<RestaurantSectionState[] | null>>;
  setConflictRestaurantToast: React.Dispatch<React.SetStateAction<string | null>>;
  setConflictToggles: React.Dispatch<React.SetStateAction<TransportModeToggles | null>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setPendingAttractions: React.Dispatch<React.SetStateAction<ApiPlace[] | null>>;
  setRouteData: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedAttractions: React.Dispatch<React.SetStateAction<ApiPlace[]>>;
  setShowRestaurantModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSettingsModal: React.Dispatch<React.SetStateAction<boolean>>;
  startOptimizingUI: () => (closingModal?: boolean) => void;
  t: (ru: string) => string;
  toTransportOptions: (toggles: TransportModeToggles) => TransportModeOptions;
}

// "Приоритеты": убираем наименее важные точки, пока маршрут не станет возможным
export const handleApplyPriorities = async (ctx: HandleApplyPrioritiesContext, orderedPlaces: any[]) => {
  const { appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, checkTerminalReachability, conflictRestaurantSectionId, conflictRestaurantSections, conflictToggles, isAbortError, language, openTransportModeModal, optimizeAbortControllerRef, rememberedOriginalOptions, reportOptimizationFailure, resolveConflictRestaurantToast, restaurantSectionsBaseline, restaurantSectionToPlace, retagFoodPoints, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setCurrentStep, setPendingAttractions, setRouteData, setSelectedAttractions, setShowRestaurantModal, setShowSettingsModal, startOptimizingUI, t, toTransportOptions } = ctx;
  setShowSettingsModal(false);
  const stop = startOptimizingUI();
  const signal = optimizeAbortControllerRef.current!.signal;

  try {
    // Восстанавливаем полные объекты мест по id в заданном порядке
    const fullOrdered = orderedPlaces
      .map(p => {
        if (typeof p.id === 'string' && p.id.startsWith('restaurant-')) {
          const section = restaurantSectionsBaseline.find(s => s.restaurant && `restaurant-${s.id}` === p.id);
          return section ? restaurantSectionToPlace(section) : undefined;
        }
        return selectedAttractions.find(a => a.id === p.id);
      })
      .filter(Boolean) as any[];
    const candidates = [...fullOrdered];
    const removedNames: string[] = [];

    // При конфликте от "Режим передвижения" перебор идёт с теми же тумблерами
    const transportOptions: TransportModeOptions = toTransportOptions(conflictToggles ?? appliedTransportToggles);

    while (candidates.length > 0) {
      // Применённые точки питания остаются в слотах
      const appliedFoodForceEdges = buildAppliedFoodForceEdges(appliedRestaurantSections, new Set(candidates.map(p => p.id)));
      const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex } = await runOptimizationForPlaces(candidates, signal, transportOptions, undefined, appliedFoodForceEdges);
      if (result.success) {
        const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
        if (reachabilityIssue) {
          stop();
          setPendingAttractions(null);
          setCurrentStep(1);
          showInfoPlaque(reachabilityIssue, 'error');
          return;
        }

        stop();
        // Коммитим весь пул точек в новом порядке приоритета
        setSelectedAttractions(fullOrdered.filter(p => typeof p.id === 'number'));
        setPendingAttractions(null);
        const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
        // Отброшенная точка питания пропадает из разделов
        const survivedIds = new Set(candidates.map(p => p.id));
        const fullOrderedIds = new Set(fullOrdered.map(p => p.id));

        // Пожертвовали новым рестораном ради остальных точек
        if (conflictRestaurantSectionId !== null) {
          const targetPointId = `restaurant-${conflictRestaurantSectionId}`;
          if (fullOrderedIds.has(targetPointId) && !survivedIds.has(targetPointId)) {
            stop();
            setPendingAttractions(null);
            setConflictRestaurantSections(null);
            setConflictRestaurantSectionId(null);
            setConflictRestaurantToast(null);
            setTimeout(() => {
              setShowRestaurantModal(true);
              showInfoPlaque(t('Не удалось вставить ресторан в маршрут. Попробуйте другой слот или длительность.'), 'error');
            }, 350);
            return;
          }
        }

        const nextRestaurantSections = restaurantSectionsBaseline.map(s => {
          if (!s.restaurant) return s;
          const pointId = `restaurant-${s.id}`;
          if (fullOrderedIds.has(pointId) && !survivedIds.has(pointId)) {
            return { ...createEmptyRestaurantSection(), id: s.id };
          }
          return s;
        });
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
            showInfoPlaque(toastInfo.message, toastInfo.kind);
          }
        }
        if (removedNames.length > 0) {
          showInfoPlaque(t('Удалены точки: {names}').replace('{names}', formatNameList(removedNames, language)), 'warning');
        }
        return;
      }
      const dropped = candidates.pop();
      if (dropped) removedNames.push(dropped.name);
    }

    stop();
    if (conflictToggles) {
      // Даже без всех точек не помогло: комбинация тумблеров невозможна
      setConflictToggles(null);
      setPendingAttractions(null);
      showInfoPlaque(t('Не удалось применить новый режим передвижения'), 'error');
      openTransportModeModal();
    } else if (conflictRestaurantSections) {
      // Новый ресторан вставить не удалось: возвращаемся в "Рестораны и кафе"
      setPendingAttractions(null);
      setConflictRestaurantSections(null);
      setConflictRestaurantSectionId(null);
      setConflictRestaurantToast(null);
      setTimeout(() => {
        setShowRestaurantModal(true);
        showInfoPlaque(t('Не удалось вставить ресторан в маршрут. Попробуйте другой слот или длительность.'), 'error');
      }, 350);
    } else {
      setCurrentStep(1);
      showInfoPlaque(t('Не удалось найти оптимальный маршрут. Попробуйте изменить параметры.'), 'error');
    }
  } catch (error) {
    stop();
    // Отмена: остаёмся на экране без плашки
    if (isAbortError(error)) return;
    console.error('Ошибка применения приоритетов:', error);
    reportOptimizationFailure(error);
  }
};
