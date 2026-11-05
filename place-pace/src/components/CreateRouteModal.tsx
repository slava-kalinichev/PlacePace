import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { api, API_BASE_URL } from '../api/client';
import type { Place as ApiPlace, Category, GuestRoute, RouteDetail } from '../api/client';
import { mapService, TravelMatrixError, type TransportModeOptions } from '../services/mapService';
import { HouseFillIcon, PlayFillIcon, FlagFillIcon, TramFillIcon, BusFillIcon, LightrailFillIcon, CarRearFillIcon, FerryFillIcon, FigureWalkIcon, ForkKnifeIcon, SliderHorizontal3Icon, ClockIcon, PhotoIcon, PlusCircleIcon, DocumentIcon, CurlybracesIcon, LinkIcon, CarBadgeGearshapeFillIcon } from './sfSymbols';
import { CompositeTripIcon } from './icons';
import { useHeaderHeightReporter, useTooltipEdgeOffset, layerBoxShadow, layerScrimOpacity, cardBoxStyle, FULLSCREEN_TRANSITION, FULLSCREEN_Z } from './layerGeometry';
import { showInfoPlaque } from './InfoPlaque';
import RouteMiniMap from './RouteMiniMap';
import { RouteExportSnapshot } from './RouteExportSnapshot';
import { sanitizeFilename, exportRoutePDF, downloadJSON, copyRouteLink, copyRouteLinkDeferred } from '../utils/routeExport';
import { deriveTransportRow as deriveTransportRowShared } from '../utils/transportRow';
import { prepareCoverImage, COVER_MAX_FILE_BYTES } from '../utils/coverImage';
import { useTranslation } from '../i18n/LanguageContext';
import { hourWord, minuteWord } from '../i18n/plurals';
import { DEFAULT_RESTAURANT_VISIT_MINUTES, type RestaurantCandidate, type RestaurantSectionState, type RestaurantSlot, type RestaurantVisitPoint, createEmptyRestaurantSection, isRestaurantVisitPoint, claimRestaurantSectionId } from './createRoute/restaurantModel';
import { DEFAULT_TRANSPORT_TOGGLES, LEG_COLLAPSE_EASE, LEG_MORPH_DURATION_MS, type LegOption, type PendingLegOverride, type TransportModeToggles } from './createRoute/transportModeTypes';
import { SettingsModal } from './createRoute/SettingsModal';
import { RestaurantModal } from './createRoute/RestaurantModal';
import { TransportModeModal } from './createRoute/TransportModeModal';
import { buildFullRoute as buildFullRouteImpl } from './createRoute/routeBuilder';
import { runOptimizationForPlaces as runOptimizationForPlacesImpl } from './createRoute/runOptimization';
import { handleOptimize as handleOptimizeImpl } from './createRoute/handleOptimize';
import { handleApplyTimeSettings as handleApplyTimeSettingsImpl } from './createRoute/applyTimeSettings';
import { handleApplyPriorities as handleApplyPrioritiesImpl } from './createRoute/applyPriorities';
import { handleApplyTransportOptions as handleApplyTransportOptionsImpl } from './createRoute/applyTransportOptions';
import { handleApplyRestaurantSections as handleApplyRestaurantSectionsImpl } from './createRoute/applyRestaurantSections';
import { handleSave as handleSaveImpl } from './createRoute/saveRoute';
import { renderRouteList as renderRouteListImpl } from './createRoute/renderRouteList';
import { renderStep2 as renderStep2Impl } from './createRoute/renderStep2';
import { renderProgressBar as renderProgressBarImpl } from './createRoute/renderProgressBar';
import { renderRestaurantSlotPointRow as renderRestaurantSlotPointRowImpl } from './createRoute/renderRestaurantSlotPointRow';

interface CreateRouteModalProps {
  onClose: () => void;
  // Закрытие кликом по backdrop (предлагает отмену закрытия)
  onBackdropClose?: () => void;
  // Сообщает App.tsx, пуст ли первый этап (тогда плашка отмены не нужна)
  onEmptyFirstStepChange?: (empty: boolean) => void;
  isLoggedIn: boolean;
  onGuestRouteSaved: (route: GuestRoute) => void;
  onRouteSaved: (id: number, targetTab: 'mine' | 'all') => void;
  // "Обновить текущий": id совпадает с adaptFrom.detail
  onRouteUpdatedInPlace: (routeId: number) => void;
  // Адаптировать/Персонализировать: мастер предзаполняется данными маршрута-предка
  adaptFrom?: { detail: RouteDetail; mode: 'adapt' | 'personalize' } | null;
  // Тариф такси по умолчанию для тумблера "Такси"
  defaultTaxiTariff: 'economy' | 'comfort' | 'business';
  // САП - нижний слой стека, поверх него могут быть другие окна
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  // Fullscreen хранится на уровне слоя в App.tsx
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onHeaderHeight?: (px: number) => void;
  // true - слой закрыт и ждёт окна отмены, остаётся смонтированным
  suspended?: boolean;
}


const CreateRouteModal = ({ onClose, onBackdropClose, onEmptyFirstStepChange, isLoggedIn, onGuestRouteSaved, onRouteSaved, onRouteUpdatedInPlace, adaptFrom, defaultTaxiTariff, zIndex, offsetX, offsetY, isTop, depth, isFullscreen, onToggleFullscreen, onHeaderHeight, suspended }: CreateRouteModalProps) => {
  const { t, language } = useTranslation();
  // Состояния для реальных данных
  const [places, setPlaces] = useState<ApiPlace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [currentStep, setCurrentStep] = useState(0);
  const [showLabels, setShowLabels] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(progressBarRef, onHeaderHeight);
  // Светофор вместо прогресс-бара при наведении на шаг 1
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const effectiveFullscreen = isFullscreen && isTop;
  const [labelTimer, setLabelTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  // Контроллер текущей оптимизации ("Отменить" прерывает запросы)
  const optimizeAbortControllerRef = useRef<AbortController | null>(null);
  // Держит окно опций скрытым между сбросом isOptimizing и закрытием
  const closingOptionsModalRef = useRef(false);
  // Экран оптимизации: монтирование и прозрачность раздельно
  const [showOptimizingOverlay, setShowOptimizingOverlay] = useState(false);
  const [optimizingVisible, setOptimizingVisible] = useState(false);
  const [optimizationMessage, setOptimizationMessage] = useState('');
  const [dotCount, setDotCount] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTransportModeModal, setShowTransportModeModal] = useState(false);
  // Тумблер "Речной транспорт" виден, только если есть подходящая пара
  const [ferryFeasible, setFerryFeasible] = useState(false);
  // Тумблеры, применённые к маршруту (черновик живёт в TransportModeModal)
  const [appliedTransportToggles, setAppliedTransportToggles] = useState<TransportModeToggles>(
    () => ({ ...DEFAULT_TRANSPORT_TOGGLES, taxiTariff: defaultTaxiTariff })
  );
  // Применённые разделы "Рестораны и кафе"
  const [appliedRestaurantSections, setAppliedRestaurantSections] = useState<RestaurantSectionState[]>([createEmptyRestaurantSection()]);
  // Раздел, вставку которого не удалось форсировать (конфликт)
  const [conflictRestaurantSections, setConflictRestaurantSections] = useState<RestaurantSectionState[] | null>(null);
  const [conflictRestaurantSectionId, setConflictRestaurantSectionId] = useState<number | null>(null);
  const [conflictRestaurantToast, setConflictRestaurantToast] = useState<string | null>(null);
  // Разделы текущей переоптимизации
  const restaurantSectionsBaseline = conflictRestaurantSections ?? appliedRestaurantSections;

  // Итоговая плашка конфликта "Рестораны и кафе"
  const resolveConflictRestaurantToast = (
    refreshedSections: RestaurantSectionState[]
  ): { message: string; kind: 'success' | 'warning' } | null => {
    if (!conflictRestaurantSections || conflictRestaurantSectionId === null) return null;
    const originalSection = conflictRestaurantSections.find(s => s.id === conflictRestaurantSectionId);
    const finalSection = refreshedSections.find(s => s.id === conflictRestaurantSectionId);
    const originalSlot = originalSection?.slot;
    const finalSlot = finalSection?.slot;
    const slotChanged = !!originalSlot && !!finalSlot
      && (originalSlot.beforeId !== finalSlot.beforeId || originalSlot.afterId !== finalSlot.afterId);
    if (slotChanged && originalSection?.restaurant) {
      return { message: t('Ресторан "{name}" удалось добавить в другой слот').replace('{name}', originalSection.restaurant.name), kind: 'warning' };
    }
    return conflictRestaurantToast ? { message: conflictRestaurantToast, kind: 'success' } : null;
  };
  // Тумблеры, вызвавшие текущий конфликт расписания
  const [conflictToggles, setConflictToggles] = useState<TransportModeToggles | null>(null);
  // Выбранная строка-перегон для ручной настройки
  const [selectedLegId, setSelectedLegId] = useState<string | number | null>(null);
  const [legOptions, setLegOptions] = useState<LegOption[] | undefined>(undefined);
  const [pendingLegOverrides, setPendingLegOverrides] = useState<Map<string, PendingLegOverride>>(new Map());
  // Запомненные первоначальные варианты составных поездок
  const [rememberedOriginalOptions, setRememberedOriginalOptions] = useState<Map<string, LegOption>>(new Map());
  // Панель вариантов появляется после схлопывания таблицы
  const [pickerRevealed, setPickerRevealed] = useState(false);
  // Таблица схлопнулась и варианты загружены
  const [tableMorphDone, setTableMorphDone] = useState(false);
  const pickerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Подсказка "Загрузка доступных видов транспорта.." при медленной сети
  const [slowFetchHintVisible, setSlowFetchHintVisible] = useState(false);
  // Синяя обводка строк поездок с задержкой
  const [transportAccentReady, setTransportAccentReady] = useState(false);
  const routeListContainerRef = useRef<HTMLDivElement>(null);
  const flipFirstRectsRef = useRef<Map<string, DOMRect> | null>(null);
  // Высота строки до подмены контента превью
  const pendingOverrideRowHeights = useRef<Map<string, number>>(new Map());
  const [showRestaurantModal, setShowRestaurantModal] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [expandTimer, setExpandTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  // Hover-expand строк поиска на шаге 1
  const [expandedSearchRowId, setExpandedSearchRowId] = useState<number | null>(null);
  const [expandSearchTimer, setExpandSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [availableTime, setAvailableTime] = useState<number | undefined>(undefined);
  const [neededReduction, setNeededReduction] = useState<number>(0);
  // Время в пути для текущего порядка
  const [travelTimeMinutes, setTravelTimeMinutes] = useState<number>(0);
  const [timeTabDisabled, setTimeTabDisabled] = useState(false);
  // Вкладка по умолчанию при конфликте
  const [settingsPreferPriorities, setSettingsPreferPriorities] = useState(false);
  const steps = [t('Точки'), t('Параметры маршрута'), t('Персонализация'), t('Экспорт')];

  // Плавное появление экрана оптимизации
  useEffect(() => {
    if (isOptimizing) {
      setShowOptimizingOverlay(true);
      const timer = setTimeout(() => setOptimizingVisible(true), 20);
      return () => clearTimeout(timer);
    }
    setOptimizingVisible(false);
    const timer = setTimeout(() => setShowOptimizingOverlay(false), 250);
    return () => clearTimeout(timer);
  }, [isOptimizing]);

  // Загрузка данных при монтировании
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const [placesData, categoriesData] = await Promise.all([
          api.getPlaces(),
          api.getCategories()
        ]);
        setPlaces(placesData);
        setCategories(categoriesData);
        console.log('Загружено мест:', placesData.length);
        console.log('Загружено категорий:', categoriesData.length);
      } catch (error) {
        console.error('Ошибка загрузки данных:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Сообщения для оптимизации
  const optimizationMessages = [
    t('Оптимизируем Ваше время..'),
    t('Составляем маршрут..'),
    t('Прокладываем путь для Вас..'),
    t('Анализируем маршрут..'),
    t('Ищем варианты для продолжения..'),
    t('Еще немного, Ваш маршрут почти готов'),
  ];

  // Данные маршрута после оптимизации (или предзаполненные из предка)
  const [routeData, setRouteData] = useState<any[]>([]);
  // Снимок входных данных этапов 1-2 в момент оптимизации
  const lastOptimizedInputsRef = useRef<string | null>(null);

  // exclude - чтобы сообщение не повторялось подряд
  const getRandomMessage = (exclude?: string) => {
    const options = exclude
      ? optimizationMessages.filter(m => m !== exclude)
      : optimizationMessages;
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  };

  // Вспомогательные функции для времени
  const timeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  };

  const minutesToTime = (minutes: number): string => {
    // Время за полночь показываем как "00:05"
    const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(wrapped / 60);
    const mins = wrapped % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  // Конец дня, если end_time не задан (как на бэкенде)
  const getEndOfDay = (places: any[]) => {
    let endOfDay = -Infinity;
    for (const place of places) {
      const workTime = place.work_time || '';
      if (workTime === 'Круглосуточно' || !workTime || workTime === '-') continue;
      try {
        if (workTime.includes('-')) {
          const parts = workTime.split('-');
          if (parts.length === 2) {
            const closeMinutes = timeToMinutes(parts[1].trim());
            if (closeMinutes > endOfDay) {
              endOfDay = closeMinutes;
            }
          }
        }
      } catch (e) {}
    }
    if (endOfDay === -Infinity) endOfDay = 23*60 + 59;
    return endOfDay;
  };

  const handleNext = () => {
    if (currentStep < steps.length -1) {
      setCurrentStep(currentStep +1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep -1);
    }
  };

  const handleCancelOptimization = () => {
    optimizeAbortControllerRef.current?.abort();
    setIsOptimizing(false);
    setDotCount(0);
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Повторное копирование ссылки после "Создать новый" при персонализации
  const beginLinkRecopy = (): ((saved: boolean) => void) => {
    if (!copiedCurrentRouteLinkRef.current) return () => {};
    let settle: (saved: boolean) => void = () => {};
    const idPromise = new Promise<string>((resolve, reject) => {
      settle = (saved) => (saved ? resolve(publicId) : reject(new Error('route was not saved')));
    });
    void copyRouteLinkDeferred(idPromise);
    return settle;
  };

  const handleSave = async () => handleSaveImpl({ accessLevel, appliedTransportToggles, beginLinkRecopy, computePublicRouteData, coverImage, displayMode, endPoint, endPointToggle, endTime, endWithStartPoint, getRouteAggregates, isAdmin, isLoggedIn, onClose, onGuestRouteSaved, onRouteSaved, peopleCount, publicId, routeData, routeDate, routeDescription, routeTitle, saveAsPersonal, setIsVisible, setTitleError, startPoint, startPointToggle, startTime, t });

  // "Обновить текущий" (только владелец)
  const handleUpdateInPlace = async () => {
    if (!adaptFrom) return;
    if (!routeTitle.trim()) {
      setTitleError(true);
      return;
    }
    if (accessLevel === 'public' && !isLoggedIn) {
      showInfoPlaque(t('Войдите в аккаунт, чтобы сохранять открытые маршруты'), 'error');
      return;
    }

    const isRecommendedAncestor = adaptFrom.detail.is_recommended;
    const { duration: totalDuration, cost: totalCostPerPerson } = getRouteAggregates(routeData);
    const isPublic = isRecommendedAncestor || accessLevel === 'public';
    const publicData = isPublic ? computePublicRouteData(routeData, isRecommendedAncestor) : null;
    const publicAggregates = publicData ? getRouteAggregates(publicData) : null;

    const result = await api.updateRoute(adaptFrom.detail.id, {
      title: routeTitle,
      description: routeDescription || null,
      cover_image: coverImage,
      start_point: startPointToggle ? null : (startPoint || null),
      end_point: endPointToggle || endWithStartPoint ? null : (endPoint || null),
      date: routeDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      people_count: peopleCount,
      total_duration: totalDuration,
      total_cost: totalCostPerPerson,
      total_duration_public: publicAggregates?.duration ?? null,
      total_cost_public: publicAggregates?.cost ?? null,
      is_public: isPublic,
      display_mode: displayMode,
      route_data: routeData,
      route_data_public: publicData,
      transport_options: appliedTransportToggles,
    }).catch(() => null);

    if (!result || !('success' in result)) {
      showInfoPlaque(t('Не удалось обновить маршрут. Попробуйте снова.'), 'error');
      return;
    }

    setIsVisible(false);
    setTimeout(() => {
      showInfoPlaque(t('Маршрут обновлен'), 'success');
      onRouteUpdatedInPlace(adaptFrom.detail.id);
      setTimeout(onClose, 1500);
    }, 300);
  };

  // Hover-expand строк с задержкой
  const handleRowMouseEnter = (id: number) => {
    if (expandTimer) {
      clearTimeout(expandTimer);
      setExpandTimer(null);
    }
    if (expandedRow === id) return;
    const timer = setTimeout(() => {
      setExpandedRow(id);
    }, 800);
    setExpandTimer(timer);
  };

  const handleRowMouseLeave = (id: number, e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest && related.closest(`[data-row-id="${id}"]`)) {
      return;
    }
    if (expandTimer) {
      clearTimeout(expandTimer);
      setExpandTimer(null);
    }
    setExpandedRow(null);
  };

  // Hover-expand строк результатов поиска
  const handleSearchRowMouseEnter = (id: number) => {
    if (expandSearchTimer) {
      clearTimeout(expandSearchTimer);
      setExpandSearchTimer(null);
    }
    if (expandedSearchRowId === id) return;
    const timer = setTimeout(() => {
      setExpandedSearchRowId(id);
    }, 800);
    setExpandSearchTimer(timer);
  };

  const handleSearchRowMouseLeave = (id: number, e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest && related.closest(`[data-row-id="${id}"]`)) {
      return;
    }
    if (expandSearchTimer) {
      clearTimeout(expandSearchTimer);
      setExpandSearchTimer(null);
    }
    setExpandedSearchRowId(null);
  };

  // Hover-expand строк в окне "Рестораны и кафе"
  const [restaurantExpandedRowId, setRestaurantExpandedRowId] = useState<number | string | null>(null);
  const [restaurantExpandTimer, setRestaurantExpandTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleRestaurantRowMouseEnter = (id: number | string) => {
    if (restaurantExpandTimer) {
      clearTimeout(restaurantExpandTimer);
      setRestaurantExpandTimer(null);
    }
    if (restaurantExpandedRowId === id) return;
    const timer = setTimeout(() => setRestaurantExpandedRowId(id), 800);
    setRestaurantExpandTimer(timer);
  };

  const handleRestaurantRowMouseLeave = (id: number | string, e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest && related.closest(`[data-row-id="${id}"]`)) {
      return;
    }
    if (restaurantExpandTimer) {
      clearTimeout(restaurantExpandTimer);
      setRestaurantExpandTimer(null);
    }
    setRestaurantExpandedRowId(null);
  };

  // Строка точки посещения в окне "Рестораны и кафе"
  const getRestaurantRowCollapseStyle = (hidden: boolean, openMaxHeight: number): React.CSSProperties => ({
    maxHeight: hidden ? 0 : openMaxHeight,
    opacity: hidden ? 0 : 1,
    overflow: 'hidden',
    paddingTop: hidden ? 0 : 8,
    paddingBottom: hidden ? 0 : 8,
    transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out, padding ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`,
  });

  const renderRestaurantSlotPointRow = (item: any, options?: {
    // Строка вне слота схлопнута, но остаётся в DOM (для FLIP)
    hidden?: boolean;
    // Только применённая точка питания перетаскивается
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    dragging?: boolean;
    // Клик по применённой точке открывает редактор слота
    onRowClick?: () => void;
    // Синий акцент у применённой точки питания
    accent?: boolean;
    accentActive?: boolean;
    // Ключ собственного зазора (для drag-and-drop)
    gapKey?: string;
    // Hover-expand отключён при редактировании слота
    noExpand?: boolean;
  }) => renderRestaurantSlotPointRowImpl({ getIconForType, getRestaurantRowCollapseStyle, handleRestaurantRowMouseEnter, handleRestaurantRowMouseLeave, peopleCount, restaurantExpandedRowId, t }, item, options);

  // Общий низкоуровневый запрос вариантов передвижения между двумя точками
  const fetchLegOptionsForCoords = async (
    origin: { lat: number; lon: number }, dest: { lat: number; lon: number }
  ): Promise<LegOption[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/transport-mode/leg-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: [origin.lat, origin.lon],
          dest: [dest.lat, dest.lon],
          date: routeDate,
          time: startTime,
        }),
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.options) ? data.options : [];
    } catch {
      return [];
    }
  };

  // Запрос вариантов передвижения для одного перегона
  const fetchLegOptions = async (item: any) => {
    // Без координат перегон не настроить
    if (!item.fromCoords || !item.toCoords) {
      setLegOptions([]);
      return;
    }
    setLegOptions(await fetchLegOptionsForCoords(item.fromCoords, item.toCoords));
  };

  // Клик по перегону: повторный клик сворачивает панель
  const handleLegRowClick = (item: any) => {
    const container = routeListContainerRef.current;
    if (container) {
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll('[data-row-id]').forEach((el) => {
        const id = el.getAttribute('data-row-id');
        if (id) rects.set(id, el.getBoundingClientRect());
      });
      flipFirstRectsRef.current = rects;
    }

    if (pickerRevealTimeoutRef.current) {
      clearTimeout(pickerRevealTimeoutRef.current);
      pickerRevealTimeoutRef.current = null;
    }

    if (selectedLegId === item.id) {
      setSelectedLegId(null);
      setLegOptions(undefined);
      setPickerRevealed(false);
      setTableMorphDone(false);
      return;
    }

    setSelectedLegId(item.id);
    setLegOptions(undefined);
    fetchLegOptions(item);
    // Панель раскрывается после схлопывания таблицы
    setPickerRevealed(false);
    setTableMorphDone(false);
    pickerRevealTimeoutRef.current = setTimeout(() => setTableMorphDone(true), LEG_MORPH_DURATION_MS);
  };

  // Раскрываем панель, когда готовы и таймер, и данные
  useEffect(() => {
    if (tableMorphDone && legOptions !== undefined) {
      setPickerRevealed(true);
    }
  }, [tableMorphDone, legOptions]);

  // Подсказка о загрузке при медленной сети
  useEffect(() => {
    setSlowFetchHintVisible(false);
    if (selectedLegId === null) return;
    const timer = setTimeout(() => setSlowFetchHintVisible(true), LEG_MORPH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [selectedLegId]);

  // Синяя обводка выключается на время схлопывания
  const transportAccentSelectionRef = useRef<number | string | null>(null);
  useEffect(() => {
    if (!showTransportModeModal) {
      transportAccentSelectionRef.current = selectedLegId;
      return;
    }
    const prev = transportAccentSelectionRef.current;
    transportAccentSelectionRef.current = selectedLegId;
    if (prev === selectedLegId) {
      setTransportAccentReady(true);
      return;
    }
    setTransportAccentReady(false);
    const timer = setTimeout(() => setTransportAccentReady(true), LEG_MORPH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showTransportModeModal, selectedLegId]);

  // FLIP: геометрия "после" после применения порядка строк
  useLayoutEffect(() => {
    const firstRects = flipFirstRectsRef.current;
    if (!firstRects) return;
    flipFirstRectsRef.current = null;
    const container = routeListContainerRef.current;
    if (!container) return;

    const deltas: { row: HTMLElement; dy: number }[] = [];
    container.querySelectorAll('[data-row-id]').forEach((el) => {
      const row = el as HTMLElement;
      const id = row.getAttribute('data-row-id');
      const first = id ? firstRects.get(id) : undefined;
      if (!first) return;
      const last = row.getBoundingClientRect();
      const dy = first.top - last.top;
      if (Math.abs(dy) < 1) return;
      deltas.push({ row, dy });
    });
    if (deltas.length === 0) return;

    deltas.forEach(({ row, dy }) => {
      row.style.transition = 'none';
      row.style.transform = `translateY(${dy}px)`;
    });
    // Один reflow на всю группу строк
    void container.offsetHeight;
    deltas.forEach(({ row }) => {
      row.style.transition = `transform ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`;
      row.style.transform = '';
    });
  }, [selectedLegId]);

  // Состояния для второго этапа
  const [routeDate, setRouteDate] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [startPointCoords, setStartPointCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [startPointToggle, setStartPointToggle] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [peopleCount, setPeopleCount] = useState(1);
  const [endPoint, setEndPoint] = useState('');
  const [endPointCoords, setEndPointCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [endPointToggle, setEndPointToggle] = useState(true);
  const [endWithStartPoint, setEndWithStartPoint] = useState(false);
  const [endTime, setEndTime] = useState('');
  const [showEndTimeInfo, setShowEndTimeInfo] = useState(false);
  const { wrapRef: endTimeInfoTooltipRef, arrowOffset: endTimeInfoArrowOffset } = useTooltipEdgeOffset(showEndTimeInfo);
  const [validationErrors, setValidationErrors] = useState<{
    date?: boolean;
    startPoint?: boolean;
    startTime?: boolean;
    endPoint?: boolean;
  }>({});

  const validateStep2 = () => {
    const errors: {
      date?: boolean;
      startPoint?: boolean;
      startTime?: boolean;
      endPoint?: boolean;
    } = {};

    if (!routeDate) {
      errors.date = true;
    }

    if (!startPointToggle && (!startPoint.trim() || !startPointCoords)) {
      errors.startPoint = true;
    }

    if (!startTime) {
      errors.startTime = true;
    }

    if (!endPointToggle && !endWithStartPoint && (!endPoint.trim() || !endPointCoords)) {
      errors.endPoint = true;
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Состояния этапа "Экспорт"; publicId создаётся один раз
  const [publicId] = useState(() => crypto.randomUUID());
  const [routeTitle, setRouteTitle] = useState('');
  const [routeDescription, setRouteDescription] = useState('');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverImageName, setCoverImageName] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'private' | 'public'>('private');
  const [displayMode, setDisplayMode] = useState<'full' | 'points_only'>('full');
  const [urlCopied, setUrlCopied] = useState(false);
  const urlCopiedTimerRef = useRef<any>(null);
  // true - скопирована ссылка на текущий маршрут при персонализации
  const copiedCurrentRouteLinkRef = useRef(false);
  // Private Terminal включён по умолчанию (для вошедших берётся из профиля)
  const [privateTerminalEnabled, setPrivateTerminalEnabled] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saveAsPersonal, setSaveAsPersonal] = useState(true);
  // Адрес дома или отеля из профиля
  const [homeAddressInfo, setHomeAddressInfo] = useState<{ address: string; lat: number; lon: number } | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoggedIn) {
      api.getProfile().then(p => {
        setPrivateTerminalEnabled(p.private_terminal_enabled);
        setIsAdmin(p.is_admin);
        setHomeAddressInfo(
          p.home_address && p.home_lat != null && p.home_lon != null
            ? { address: p.home_address, lat: p.home_lat, lon: p.home_lon }
            : null
        );
      }).catch(() => {});
    }
  }, [isLoggedIn]);

  // Порядок категорий в фильтрах

  // Порядок категорий в фильтрах
  const CATEGORY_DISPLAY_ORDER = [
    'Музеи', 'Парки', 'Зоопарки и океанариумы',
    'Храмы и монастыри', 'Театры',
    'Набережные', 'Сталинские высотки', 'Торговые центры', 'Смотровые площадки',
  ];
  const categoryNames = [...categories]
    .sort((a, b) => {
      const ai = CATEGORY_DISPLAY_ORDER.indexOf(a.name);
      const bi = CATEGORY_DISPLAY_ORDER.indexOf(b.name);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(c => c.name);

  // Состояния для поиска и фильтров
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAttractions, setSelectedAttractions] = useState<ApiPlace[]>([]);
  // Поле поиска достопримечательностей
  const attractionSearchInputRef = useRef<HTMLInputElement>(null);
  // Автофокус только при чистом создании маршрута
  useEffect(() => {
    if (adaptFrom) return;
    const timer = setTimeout(() => attractionSearchInputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Сообщает о пустом первом этапе
  useEffect(() => {
    onEmptyFirstStepChange?.(currentStep === 0 && selectedAttractions.length === 0);
  }, [currentStep, selectedAttractions.length, onEmptyFirstStepChange]);
  // Исходные рекомендованные длительности по id места
  const [baseDurations, setBaseDurations] = useState<{ [id: number]: number }>({});

  // Предзаполнение мастера маршрутом-предком (один раз, когда загрузятся места)
  const adaptSeededRef = useRef(false);
  useEffect(() => {
    if (!adaptFrom || adaptSeededRef.current || places.length === 0) return;
    adaptSeededRef.current = true;
    const { detail, mode } = adaptFrom;

    // Форма правки/адаптации заполняется ОРИГИНАЛОМ автора, а не автопереводом
    setRouteTitle(detail.title_original ?? detail.title);
    setRouteDescription((detail.description_original ?? detail.description) || '');
    setCoverImage(detail.cover_image);
    if (detail.cover_image) setCoverImageName(t('обложка маршрута'));

    // Автонастройка предка переносится в адаптацию и персонализацию
    const defaultToggles = { ...DEFAULT_TRANSPORT_TOGGLES, taxiTariff: defaultTaxiTariff };
    const seededToggles = detail.transport_options
      ? { ...defaultToggles, ...detail.transport_options }
      : defaultToggles;
    // Тариф такси берётся из аккаунта текущего пользователя
    if (!seededToggles.taxi) {
      seededToggles.taxiTariff = defaultTaxiTariff;
    }
    setAppliedTransportToggles(seededToggles);

    // Запомненные варианты составных поездок из route_data
    const seededRemembered = new Map<string, LegOption>();
    detail.route_data.forEach((item: any) => {
      if (item.type === 'transport' && item.rememberedOriginalOption) {
        seededRemembered.set(`${item.fromId}-${item.toId}`, item.rememberedOriginalOption);
      }
    });
    if (seededRemembered.size > 0) setRememberedOriginalOptions(seededRemembered);

    if (detail.is_owner) {
      setAccessLevel(detail.is_public ? 'public' : 'private');
      setDisplayMode(detail.display_mode);
      // Переключатель "личный" актуален только для админа
      setSaveAsPersonal(!detail.is_recommended);
    }
    // не-владелец: accessLevel/displayMode остаются дефолтными ('private'/'full')

    const attractionItems = detail.route_data.filter((i: any) => i.type === 'attraction');
    const seeded: ApiPlace[] = [];
    const seededBase: { [id: number]: number } = {};
    attractionItems.forEach((item: any) => {
      let dbPlace = places.find(p => p.id === item.id);
      if (!dbPlace) {
        // Точка 2GIS восстанавливается из снимка маршрута
        if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') return;
        dbPlace = {
          id: item.id,
          name: item.name,
          description: null,
          address: item.address && item.address !== t('Адрес не указан') ? item.address : null,
          latitude: item.latitude,
          longitude: item.longitude,
          category: null,
          work_time: item.workTime || '-',
          ticket_price: item.cost || 0,
          recommended_duration: item.duration || 60,
          image_url: null,
        };
      }
      seeded.push({ ...dbPlace, recommended_duration: item.duration || dbPlace.recommended_duration });
      seededBase[item.id] = dbPlace.recommended_duration;
    });
    setSelectedAttractions(seeded);
    setBaseDurations(seededBase);

    // Точки питания предка сразу видны в окне ресторанов
    const foodItems = detail.route_data.filter((i: any) => i.type === 'food');
    if (foodItems.length > 0) {
      const visitSeq = detail.route_data.filter(isRestaurantVisitPoint);
      const restoredSections: RestaurantSectionState[] = foodItems.map((item: any) => {
        const idx = visitSeq.findIndex((p: any) => p.id === item.id);
        const slot = (idx > 0 && idx < visitSeq.length - 1)
          ? { beforeId: visitSeq[idx - 1].id, afterId: visitSeq[idx + 1].id }
          : null;
        const sectionId = claimRestaurantSectionId(item.restaurantSectionId);
        return {
          id: sectionId,
          restaurant: {
            id: item.id,
            name: item.name,
            address: item.address || t('Адрес не указан'),
            workTime: item.workTime || '-',
            rating: null,
            avgCheck: item.cost || undefined,
            cuisine: undefined,
            distanceMeters: 0,
            lat: item.latitude,
            lon: item.longitude,
          },
          visitMinutes: item.currentDuration ?? item.duration ?? DEFAULT_RESTAURANT_VISIT_MINUTES,
          slotMode: 'custom',
          slot,
          editingSlot: false,
          expandedCandidateId: null,
        };
      });
      setAppliedRestaurantSections(restoredSections);
    }

    if (mode === 'adapt') {
      setRouteDate(new Date().toISOString().slice(0, 10));
      if (detail.start_time) setStartTime(detail.start_time);
      setCurrentStep(0);
    } else {
      // Персонализация открывается сразу на шаге 3
      setRouteDate(detail.date || '');
      let startPointCoordsPromise: Promise<{ lat: number; lon: number } | null> = Promise.resolve(null);
      let startPointToggleVal = false;
      if (detail.start_point) {
        setStartPoint(detail.start_point);
        setStartPointToggle(false);
        // Адрес терминала предка резолвится в координаты сразу
        startPointCoordsPromise = mapService.resolveAddress(detail.start_point).then(resolved => {
          if ('error' in resolved) return null;
          const coords = { lat: resolved.lat, lon: resolved.lon };
          setStartPointCoords(coords);
          return coords;
        });
      } else {
        // Пустой start_point: был включён "Согласовано с первой точкой"
        setStartPointToggle(true);
        startPointToggleVal = true;
      }
      let endPointCoordsPromise: Promise<{ lat: number; lon: number } | null> = Promise.resolve(null);
      let endPointToggleVal = false;
      if (detail.end_point) {
        setEndPoint(detail.end_point);
        setEndPointToggle(false);
        endPointCoordsPromise = mapService.resolveAddress(detail.end_point).then(resolved => {
          if ('error' in resolved) return null;
          const coords = { lat: resolved.lat, lon: resolved.lon };
          setEndPointCoords(coords);
          return coords;
        });
      } else {
        // Пустой end_point: "Согласовано с последней точкой" или возврат в начало
        setEndPointToggle(true);
        endPointToggleVal = true;
      }
      const startTimeVal = detail.start_time || startTime;
      if (detail.start_time) setStartTime(detail.start_time);
      const endTimeVal = detail.end_time || endTime;
      if (detail.end_time) setEndTime(detail.end_time);
      setPeopleCount(detail.people_count);
      setRouteData(detail.route_data.map((item: any) => ({ ...item })));
      setCurrentStep(2);

      // Без изменений "Оптимизировать" не запускает переоптимизацию
      Promise.all([startPointCoordsPromise, endPointCoordsPromise]).then(([startCoords, endCoords]) => {
        lastOptimizedInputsRef.current = JSON.stringify({
          ids: seeded.map(a => a.id),
          routeDate: detail.date || '',
          startTime: startTimeVal,
          endTime: endTimeVal,
          peopleCount: detail.people_count,
          startPoint: detail.start_point || '',
          startPointCoords: startCoords,
          startPointToggle: startPointToggleVal,
          endPoint: detail.end_point || '',
          endPointCoords: endCoords,
          endPointToggle: endPointToggleVal,
          endWithStartPoint: false,
        });
      });
    }
  }, [adaptFrom, places]);

  // Неприменённая попытка настройки времени, приведшая к конфликту
  const [pendingAttractions, setPendingAttractions] = useState<ApiPlace[] | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [tempFilters, setTempFilters] = useState<string[]>([]);
  const [isFiltersApplied, setIsFiltersApplied] = useState(false);

  const isFilterActive = isFiltersApplied && selectedFilters.length > 0;

  // Корзины результатов живого поиска 2GIS (на сервере не кэшируются)
  type LiveBucket = {
    items: ApiPlace[];
    page: number;
    hasMore: boolean;
    params: { category?: string; q?: string };
  };
  const [liveBuckets, setLiveBuckets] = useState<Record<string, LiveBucket>>({});
  const [liveLoadingCount, setLiveLoadingCount] = useState(0);
  // Уже отправленные корзины (повторный запрос не тратим)
  const liveRequestedRef = useRef<Set<string>>(new Set());

  const loadLivePage = async (key: string, params: { category?: string; q?: string }, page: number) => {
    setLiveLoadingCount(n => n + 1);
    try {
      const result = await api.getLivePlaces({ ...params, page });
      setLiveBuckets(prev => {
        const old = prev[key];
        const known = new Set((old?.items ?? []).map(i => i.id));
        const merged = [...(old?.items ?? []), ...result.items.filter(i => !known.has(i.id))];
        return { ...prev, [key]: { items: merged, page, hasMore: result.has_more, params } };
      });
    } finally {
      setLiveLoadingCount(n => n - 1);
    }
  };

  const fetchLiveForCategories = (names: string[]) => {
    names.forEach(name => {
      const key = `cat:${name}`;
      if (!categories.find(c => c.name === name)?.live || liveRequestedRef.current.has(key)) return;
      liveRequestedRef.current.add(key);
      loadLivePage(key, { category: name }, 1);
    });
  };

  const liveSearchText = searchQuery.trim().toLowerCase();
  const isLiveAvailable = categories.some(c => c.live);
  // Текст, по которому нажали Enter
  const [submittedSearch, setSubmittedSearch] = useState('');
  const awaitingSubmit = liveSearchText !== '' && submittedSearch !== liveSearchText;

  // Точки без адреса не показываем
  const hasAddress = (a: ApiPlace) => !!a.address && a.address.trim() !== '';

  // Ручные точки под фильтры и текст
  const getManualMatches = (q: string) => places.filter(a =>
    hasAddress(a) &&
    (!isFilterActive || (a.category && selectedFilters.includes(a.category))) &&
    (!q || a.name.toLowerCase().includes(q))
  );

  // Enter: сначала ручные точки, при отсутствии совпадений - один запрос к 2GIS
  const handleSearchSubmit = () => {
    if (!liveSearchText) return;
    setSubmittedSearch(liveSearchText);
    if (getManualMatches(liveSearchText).length > 0) return;
    if (!isLiveAvailable || liveSearchText.length < 2) return;
    const key = `q:${liveSearchText}`;
    if (liveRequestedRef.current.has(key)) return;
    liveRequestedRef.current.add(key);
    loadLivePage(key, { q: liveSearchText }, 1);
  };

  // Корзины, относящиеся к текущим фильтрам и тексту
  const getActiveLiveKeys = () => {
    const keys: string[] = [];
    if (isFilterActive) selectedFilters.forEach(c => keys.push(`cat:${c}`));
    if (liveSearchText) keys.push(`q:${liveSearchText}`);
    return keys.filter(k => liveBuckets[k]);
  };

  const hasMoreLive = !awaitingSubmit && getActiveLiveKeys().some(k => liveBuckets[k].hasMore);

  const handleLoadMoreLive = () => {
    getActiveLiveKeys().forEach(k => {
      const bucket = liveBuckets[k];
      if (bucket.hasMore) loadLivePage(k, bucket.params, bucket.page + 1);
    });
  };

  const getFilteredAttractions = () => {
    if (awaitingSubmit) return [];

    const filtered = getManualMatches(liveSearchText);

    // Живые точки идут после ручных, результаты по категории сужаются текстом
    const seen = new Set<number>(filtered.map(a => a.id));
    const live: ApiPlace[] = [];
    getActiveLiveKeys().forEach(key => {
      liveBuckets[key].items.forEach(item => {
        if (seen.has(item.id) || !hasAddress(item)) return;
        if (isFilterActive && !(item.category && selectedFilters.includes(item.category))) return;
        if (key.startsWith('cat:') && liveSearchText && !item.name.toLowerCase().includes(liveSearchText)) return;
        seen.add(item.id);
        live.push(item);
      });
    });

    return [...filtered, ...live];
  };

  // Различаем одноимённые точки по адресу
  const makeDisplayName = (items: ApiPlace[]) => {
    const counts = new Map<string, number>();
    items.forEach(i => {
      const key = i.name.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return (item: ApiPlace) =>
      (counts.get(item.name.trim().toLowerCase()) ?? 0) > 1 && item.address
        ? `${item.name} (${item.address})`
        : item.name;
  };

  const visibleAttractions = getFilteredAttractions();
  const searchDisplayName = makeDisplayName(visibleAttractions);
  const selectedDisplayName = makeDisplayName(selectedAttractions);

  const handleAddAttraction = (attraction: ApiPlace) => {
    if (selectedAttractions.some(a => a.id === attraction.id)) {
      return;
    }
    setSelectedAttractions([...selectedAttractions, attraction]);
    setBaseDurations(prev =>
      prev[attraction.id] !== undefined
        ? prev
        : { ...prev, [attraction.id]: attraction.recommended_duration || 60 }
    );
    setSearchQuery('');
    setShowSearchResults(false);
    // Возвращаем фокус в поле поиска после "+"
    attractionSearchInputRef.current?.focus();
  };

  const handleRemoveAttraction = (id: number) => {
    setSelectedAttractions(selectedAttractions.filter(a => a.id !== id));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSearchResults(value.length > 0);
    if (value.length > 0) {
      setShowFilters(false);
    }
  };

  const handleFilterToggle = (category: string) => {
    setTempFilters(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const handleFilterIconClick = () => {
    if (showFilters) {
      setSelectedFilters(tempFilters);
      setIsFiltersApplied(tempFilters.length > 0);
      setShowFilters(false);
      setShowSearchResults(true);
      fetchLiveForCategories(tempFilters);
    } else {
      setTempFilters([...selectedFilters]);
      setShowFilters(true);
      setShowSearchResults(false);
    }
  };

  const handleSearchFocus = () => {
    setShowFilters(false);
  };

  // Получить иконку для типа точки
  const getIconForType = (_type: string, icon: string) => {
    switch(icon) {
      // Старт, финиш, дом и ресторан - чёрные иконки
      case 'home':
        return <HouseFillIcon color="#000000" size={19} />;
      case 'start':
        return <PlayFillIcon color="#000000" size={14} />;
      case 'finish':
        return <FlagFillIcon color="#000000" size={14} />;
      // МЦД - своя категория, иконка как у метро
      case 'metro':
      case 'mcd':
        return <TramFillIcon color="#4B5563" size={20} />;
      case 'bus':
        return <BusFillIcon color="#4B5563" size={16} />;
      case 'tram':
        return <LightrailFillIcon color="#4B5563" size={20} />;
      // Такси - жёлтое
      case 'taxi':
      case 'taxi_economy':
        return <CarRearFillIcon color="#F59E0B" size={18} />;
      case 'taxi_comfort':
        return <CarRearFillIcon color="#B0B8C1" size={18} />;
      case 'taxi_business':
        return <CarRearFillIcon color="#000000" size={18} />;
      case 'ferry':
        return <FerryFillIcon color="#4B5563" size={18} />;
      case 'transmode':
        return <CompositeTripIcon color="#4B5563" size={15} />;
      case 'walk':
        return <FigureWalkIcon color="#4B5563" size={20} />;
      case 'pin':
        return (
          <span
            className="text-lg leading-none select-none"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.125rem', height: '1.125rem' }}
          >
            📍
          </span>
        );
      case 'flag':
        return <FlagFillIcon size={20} />;
      case 'restaurant':
        return <ForkKnifeIcon color="#000000" size={18} />;
      default:
        return null;
    }
  };

  // Форматирование длительности
  const formatDuration = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return '--:--';
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    if (totalMinutes < 0) totalMinutes += 1440;

    if (totalMinutes < 60) {
      return `${totalMinutes} ${minuteWord(totalMinutes, language)}`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) {
      return `${hours} ${hourWord(hours, language)}`;
    }
    return `${hours} ${hourWord(hours, language)} ${mins} ${minuteWord(mins, language)}`;
  };

  // interactive=true - левая панель "Режим передвижения"
  const renderRouteList = (interactive: boolean = false) => renderRouteListImpl({ expandedRow, formatDuration, getIconForType, handleLegRowClick, handleRowMouseEnter, handleRowMouseLeave, legOptions, pendingLegOverrides, pendingOverrideRowHeights, peopleCount, pickerRevealed, rememberedOriginalOptions, routeData, routeListContainerRef, selectedLegId, setPendingLegOverrides, slowFetchHintVisible, t, transportAccentReady }, interactive);

  // Офскрин-таблица для PDF (RouteExportSnapshot)
  const renderExportSnapshot = () => {
    const totalCost = Math.round(routeData.reduce((sum, item) => sum + (item.cost || 0), 0) * peopleCount);
    const firstTime = routeData.length > 0 ? routeData[0].time : '--:--';
    const lastTime = routeData.length > 0 ? routeData[routeData.length - 1].time : '--:--';
    const duration = formatDuration(firstTime, lastTime);
    const pointsCount = routeData.filter(item => item.type === 'attraction').length;

    return (
      <RouteExportSnapshot
        exportRef={exportRef}
        title={routeTitle}
        dateLabel={routeDate || '—'}
        pointsCount={pointsCount}
        durationLabel={duration}
        totalCostLabel={`${totalCost} ₽`}
        peopleCount={peopleCount}
        routeData={routeData}
        renderIcon={(item) => getIconForType(item.type, item.icon)}
      />
    );
  };

  // Обрезка терминалов для остальных пользователей при Private Terminal
  const adjustTaxiCostForViewer = (item: any) => {
    if (!item.costApproximate || !(item.cost > 0) || peopleCount <= 1) return item;
    const carCount = Math.max(1, Math.ceil(peopleCount / 4));
    return { ...item, cost: item.cost * peopleCount / carCount };
  };

  const computePublicRouteData = (data: any[], forceTrim = false) => {
    if ((!forceTrim && !privateTerminalEnabled) || data.length === 0) return data.map(adjustTaxiCostForViewer);

    let start = 0;
    let end = data.length;

    if (data[0]?.type === 'start' && data[0]?.icon === 'home') {
      start = 1;
      if (data[start]?.id === 'transport_start_terminal') {
        start += 1;
      }
    }

    if (data[end - 1]?.type === 'end' && data[end - 1]?.icon === 'home') {
      end -= 1;
      if (data[end - 1]?.id === 'transport_end_terminal') {
        end -= 1;
      }
    }

    const sliced = start >= end ? (data.length ? [data[0]] : data) : data.slice(start, end);
    return sliced.map(adjustTaxiCostForViewer);
  };

  const getRouteAggregates = (data: any[]) => {
    if (data.length === 0) return { duration: 0, cost: 0 };
    const [sh, sm] = (data[0].time || '00:00').split(':').map(Number);
    const [eh, em] = (data[data.length - 1].time || '00:00').split(':').map(Number);
    let duration = (eh * 60 + em) - (sh * 60 + sm);
    if (duration < 0) duration += 1440;
    const cost = Math.round(data.reduce((sum, item) => sum + (item.cost || 0), 0));
    return { duration, cost };
  };

  const handleExportPDF = async () => {
    if (!routeTitle.trim()) {
      setTitleError(true);
      return;
    }
    if (!exportRef.current) return;
    await exportRoutePDF(exportRef.current, `${sanitizeFilename(routeTitle)} ${routeDate}`);
    showInfoPlaque(t('Маршрут экспортирован как PDF'), 'success');
  };

  const handleExportJSON = () => {
    if (!routeTitle.trim()) {
      setTitleError(true);
      return;
    }
    const { duration, cost } = getRouteAggregates(routeData);
    const payload = {
      title: routeTitle,
      description: routeDescription || null,
      date: routeDate,
      people_count: peopleCount,
      points_count: routeData.filter(item => item.type === 'attraction').length,
      total_time_minutes: duration,
      total_cost: cost * peopleCount,
      route: routeData,
    };
    downloadJSON(payload, `${sanitizeFilename(routeTitle)} ${routeDate}`);
    showInfoPlaque(t('Маршрут экспортирован как JSON'), 'success');
  };

  const handleCopyLink = async () => {
    if (!routeTitle.trim()) {
      setTitleError(true);
      return;
    }
    // Ссылка на главную с ?route=<uuid>
    const currentRouteLinkId =
      adaptFrom?.mode === 'personalize' && adaptFrom.detail.is_owner && isLoggedIn
        ? adaptFrom.detail.public_id
        : null;
    const copied = await copyRouteLink(currentRouteLinkId ?? publicId);
    if (!copied) return;
    copiedCurrentRouteLinkRef.current = !!currentRouteLinkId;
    setUrlCopied(true);
    if (urlCopiedTimerRef.current) clearTimeout(urlCopiedTimerRef.current);
    urlCopiedTimerRef.current = setTimeout(() => setUrlCopied(false), 5000);
    // Маршрут ещё не сохранён: ссылка заработает после сохранения
    showInfoPlaque(t('Ссылка станет активна сразу после сохранения маршрута'), 'info');
  };

  const renderStep2 = () => renderStep2Impl({ currentStep, endPoint, endPointToggle, endTime, endTimeInfoArrowOffset, endTimeInfoTooltipRef, endWithStartPoint, handleBack, handleOptimize, homeAddressInfo, peopleCount, routeDate, setEndPoint, setEndPointCoords, setEndPointToggle, setEndTime, setEndWithStartPoint, setPeopleCount, setRouteDate, setShowEndTimeInfo, setStartPoint, setStartPointCoords, setStartPointToggle, setStartTime, setValidationErrors, showEndTimeInfo, startPoint, startPointToggle, startTime, t, validationErrors });

  // Кэш расписаний ручных точек 2GIS за сессию мастера
  const scheduleCacheRef = useRef<Map<number, any>>(new Map());

  const runOptimizationForPlaces = async (placesList: any[], signal?: AbortSignal, transportOptions?: TransportModeOptions, legOverrides?: PendingLegOverride[], extraForceEdges?: (number | string)[][]) => runOptimizationForPlacesImpl({ endPoint, endPointCoords, endPointToggle, endTime, endWithStartPoint, peopleCount, routeDate, scheduleCacheRef, startPoint, startPointCoords, startPointToggle, startTime, t, timeToMinutes }, placesList, signal, transportOptions, legOverrides, extraForceEdges);

  // См. utils/transportRow.ts
  const deriveTransportRow = (
    travelMode: string, fromName: string, toName: string, legFare: number = 0,
    fromAddressOverride?: string, toAddressOverride?: string,
  ) => deriveTransportRowShared(t, language, travelMode, fromName, toName, legFare, fromAddressOverride, toAddressOverride);

  // Адрес терминала совпадает с домашним из профиля
  const isSavedHomeAddress = (address: string) =>
    !!homeAddressInfo && address.trim() === homeAddressInfo.address.trim();

  // Собирает список для отображения на шаге "Персонализация" из ответа бэкенда
  const buildFullRoute = (result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => buildFullRouteImpl({ deriveTransportRow, endPoint, endPointCoords, endPointToggle, endWithStartPoint, isSavedHomeAddress, minutesToTime, startPoint, startPointCoords, startPointToggle, startTime, t, timeToMinutes }, result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex);

  // Грубая оценка минимального времени в пути (запасной вариант)
  const estimateMinTravelTime = (matrix: number[][]): number => {
    const n = matrix.length;
    if (n < 2) return 0;
    let best = Infinity;
    for (let start = 0; start < n; start++) {
      const visited = new Set([start]);
      let current = start;
      let total = 0;
      for (let step = 0; step < n - 1; step++) {
        let nearest = -1;
        let nearestDist = Infinity;
        for (let j = 0; j < n; j++) {
          if (!visited.has(j) && (matrix[current]?.[j] ?? Infinity) < nearestDist) {
            nearestDist = matrix[current][j];
            nearest = j;
          }
        }
        if (nearest === -1) break;
        total += nearestDist;
        visited.add(nearest);
        current = nearest;
      }
      if (total < best) best = total;
    }
    return best === Infinity ? 0 : best;
  };

  // Открывает настройки с оценкой, сколько минут нужно сократить
  const openSettingsForInfeasibility = (
    placesList: any[], matrix: number[][], preferPriorities = false, minFeasibleMinutes: number | null = null
  ) => {
    const startMin = timeToMinutes(startTime);
    const endMin = endTime ? timeToMinutes(endTime) : getEndOfDay(placesList);
    const window = Math.max(0, endMin - startMin);

    // Сумма исходных длительностей (минус она даёт чистое время в пути)
    const totalDuration = placesList.reduce((sum, p) => sum + (p.recommended_duration || 60), 0);
    let reduction: number;
    let travelMinutes: number;
    if (minFeasibleMinutes !== null) {
      reduction = Math.max(0, minFeasibleMinutes - window);
      travelMinutes = Math.max(0, minFeasibleMinutes - totalDuration);
    } else {
      travelMinutes = estimateMinTravelTime(matrix);
      reduction = Math.max(0, totalDuration + travelMinutes - window);
    }
    const maxPossibleReduction = placesList.reduce(
      (sum, p) => sum + Math.max(0, (p.recommended_duration || 60) - 10), 0
    );
    // Решатель не нашёл порядок, хотя время укладывается: ведём на "Приоритеты"
    const solverCouldNotOrder = minFeasibleMinutes !== null && reduction === 0;
    const timeTabHelpless = solverCouldNotOrder || reduction > maxPossibleReduction;

    setAvailableTime(window);
    setNeededReduction(reduction);
    setTravelTimeMinutes(travelMinutes);
    setTimeTabDisabled(timeTabHelpless);
    setSettingsPreferPriorities(preferPriorities || solverCouldNotOrder);
    showInfoPlaque(
      solverCouldNotOrder
        ? t('Маршрут технически укладывается по времени, но подходящий порядок посещения не найден. Попробуйте изменить приоритеты.')
        : timeTabHelpless
        ? t('Не удалось оптимизировать посещение всех выбранных точек. Попробуйте выбрать приоритеты.')
        : t('Не удалось оптимизировать посещение всех выбранных точек. Попробуйте настроить время посещения или выбрать приоритеты.'),
      'warning'
    );
    setShowSettingsModal(true);
  };

  // Ручное открытие настроек со шага "Персонализация"
  const openSettingsManually = () => {
    setAvailableTime(undefined);
    setNeededReduction(0);
    setTravelTimeMinutes(0);
    setTimeTabDisabled(false);
    setSettingsPreferPriorities(false);
    // Ручное открытие не относится к "Режим передвижения"
    setConflictToggles(null);
    setShowSettingsModal(true);
  };

  // Открытие "Режим передвижения" с проверкой речного транспорта
  const openTransportModeModal = () => {
    setFerryFeasible(false);
    setShowTransportModeModal(true);
    // Чистый старт: без выбранного перегона и черновика
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
    const coords = selectedAttractions.map(p => [p.latitude, p.longitude]);
    fetch(`${API_BASE_URL}/transport-mode/ferry-feasible`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coords, walk_priority: appliedTransportToggles.walkPriority }),
    })
      .then(r => r.json())
      .then(data => setFerryFeasible(!!data.feasible))
      .catch(() => setFerryFeasible(false));
  };

  const openRestaurantModal = () => {
    setShowRestaurantModal(true);
  };

  // Точки маршрута без перегонов для окна "Рестораны и кафе"
  const restaurantVisitPoints: RestaurantVisitPoint[] = routeData.filter(isRestaurantVisitPoint);

  // Тумблеры -> параметры запроса (snake_case)
  const toTransportOptions = (toggles: TransportModeToggles): TransportModeOptions => ({
    public_transit: toggles.publicTransit,
    public_transit_submode: toggles.publicTransitSubmode,
    taxi: toggles.taxi,
    taxi_tariff: toggles.taxiTariff,
    include_ferry: toggles.includeFerry,
    walk_priority: toggles.walkPriority,
    no_composite: toggles.noComposite,
  });

  // Точка питания -> формат placesData
  const restaurantSectionToPlace = (section: RestaurantSectionState) => ({
    id: `restaurant-${section.id}`,
    name: section.restaurant!.name,
    work_time: section.restaurant!.workTime,
    recommended_duration: section.visitMinutes,
    ticket_price: section.restaurant!.avgCheck || 0,
    latitude: section.restaurant!.lat,
    longitude: section.restaurant!.lon,
    address: section.restaurant!.address,
  });

  // Строка routeData -> формат placesData
  const routePointToPlace = (item: any) => ({
    id: item.id,
    name: item.name,
    work_time: item.workTime,
    recommended_duration: item.currentDuration ?? item.duration ?? 60,
    ticket_price: item.cost,
    latitude: item.latitude,
    longitude: item.longitude,
    address: item.address,
  });

  // placesList и пары подряд для вставки ресторана в слот
  const buildRestaurantInsertionPlaces = (
    slot: RestaurantSlot, sectionId: number, candidate: RestaurantCandidate, visitMinutes: number
  ): { placesList: any[]; extraForceEdges: (number | string)[][] } | null => {
    const oldFoodId = `restaurant-${sectionId}`;
    const basePoints = routeData
      .filter(item => (item.type === 'attraction' || item.type === 'food') && item.id !== oldFoodId)
      .map(routePointToPlace);
    const restaurantPlace = restaurantSectionToPlace({
      id: sectionId, restaurant: candidate, visitMinutes, slot,
      slotMode: 'custom', editingSlot: false, expandedCandidateId: null,
    });
    const placesList = [...basePoints];
    if (slot.beforeId === 'start') {
      placesList.unshift(restaurantPlace);
    } else {
      const beforeIdx = basePoints.findIndex(p => p.id === slot.beforeId);
      if (beforeIdx === -1) return null;
      placesList.splice(beforeIdx + 1, 0, restaurantPlace);
    }
    const extraForceEdges: (number | string)[][] = [];
    for (let i = 0; i < placesList.length - 1; i++) {
      extraForceEdges.push([placesList[i].id, placesList[i + 1].id]);
    }
    return { placesList, extraForceEdges };
  };

  // Помечаем точки питания после buildFullRoute
  const retagFoodPoints = (fullRoute: any[], sections: RestaurantSectionState[]): { route: any[]; sections: RestaurantSectionState[] } => {
    const sectionIdByPointId = new Map<string, number>();
    sections.forEach(s => { if (s.restaurant) sectionIdByPointId.set(`restaurant-${s.id}`, s.id); });
    const taggedRoute = fullRoute.map(item => {
      const sectionId = sectionIdByPointId.get(String(item.id));
      if (sectionId === undefined) return item;
      return { ...item, type: 'food', icon: 'restaurant', restaurantSectionId: sectionId, currentDuration: item.duration };
    });
    const visitSeq = taggedRoute.filter(isRestaurantVisitPoint);
    const nextSections = sections.map(s => {
      if (!s.restaurant) return s;
      const idx = visitSeq.findIndex(item => item.id === `restaurant-${s.id}`);
      if (idx <= 0 || idx >= visitSeq.length - 1) return s;
      return { ...s, slot: { beforeId: visitSeq[idx - 1].id, afterId: visitSeq[idx + 1].id } };
    });
    return { route: taggedRoute, sections: nextSections };
  };

  // Возвращаем запомненные варианты в свежие строки
  const attachRememberedOptions = (route: any[], remembered: Map<string, LegOption>): any[] => {
    if (remembered.size === 0) return route;
    return route.map(item => {
      if (item.type !== 'transport') return item;
      const original = remembered.get(`${item.fromId}-${item.toId}`);
      return original ? { ...item, rememberedOriginalOption: original } : item;
    });
  };

  // Сохраняем текущий вид транспорта остальных перегонов
  const buildPreserveTransportOverrides = (route: any[], excludeEdgeKeys: Set<string>): PendingLegOverride[] => {
    const overrides: PendingLegOverride[] = [];
    route.forEach(item => {
      if (item.type !== 'transport' || item.fromId === undefined || item.toId === undefined) return;
      const key = `${item.fromId}-${item.toId}`;
      if (excludeEdgeKeys.has(key)) return;
      overrides.push({
        fromId: item.fromId,
        toId: item.toId,
        fromName: item.fromPlace,
        toName: item.toPlace,
        option: {
          key: item.icon,
          duration_seconds: (item.travelTime || 0) * 60,
          distance_m: item.distance ?? null,
          cost: item.cost || 0,
          cost_approximate: !!item.costApproximate,
          legs: item.legs || null,
          mode_label: item.rawTravelMode,
        },
      });
    });
    return overrides;
  };

  // Применённая точка питания остаётся в своём слоте
  const buildAppliedFoodForceEdges = (
    sections: RestaurantSectionState[], idsInScope: Set<number | string>
  ): (number | string)[][] => {
    const edges: (number | string)[][] = [];
    sections.forEach(s => {
      if (!s.restaurant || !s.slot) return;
      const foodId = `restaurant-${s.id}`;
      if (!idsInScope.has(foodId)) return;
      if (idsInScope.has(s.slot.beforeId)) edges.push([s.slot.beforeId, foodId]);
      if (idsInScope.has(s.slot.afterId)) edges.push([foodId, s.slot.afterId]);
    });
    return edges;
  };

  // "Применить" в "Рестораны и кафе": переоптимизация вокруг точки питания
  const handleApplyRestaurantSections = async (sections: RestaurantSectionState[]): Promise<boolean> => handleApplyRestaurantSectionsImpl({ appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildFullRoute, buildRestaurantInsertionPlaces, checkTerminalReachability, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, rememberedOriginalOptions, reportOptimizationFailure, retagFoodPoints, runOptimizationForPlaces, setAppliedRestaurantSections, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setRouteData, startOptimizingUI, t, toTransportOptions }, sections);

  // Удаление применённой точки питания
  const handleDeleteRestaurantSection = async (sectionId: number): Promise<boolean> => {
    const applied = appliedRestaurantSections.find(s => s.id === sectionId);
    if (!applied || !applied.restaurant) return true;
    const restaurantName = applied.restaurant.name;
    const removedId = `restaurant-${sectionId}`;

    const placesList = routeData
      .filter(item => (item.type === 'attraction' || item.type === 'food') && item.id !== removedId)
      .map(routePointToPlace);

    const extraForceEdges: (number | string)[][] = [];
    for (let i = 0; i < placesList.length - 1; i++) {
      extraForceEdges.push([placesList[i].id, placesList[i + 1].id]);
    }

    const stop = startOptimizingUI();
    const signal = optimizeAbortControllerRef.current!.signal;
    try {
      const { result, matrix, distances, modes, details, placesUsed, startTerminalIndex, endTerminalIndex } =
        await runOptimizationForPlaces(placesList, signal, toTransportOptions(appliedTransportToggles), undefined, extraForceEdges);
      // stop() вызывается в каждой ветке отдельно
      if (!result.success) {
        stop();
        showInfoPlaque(t('Не удалось удалить рестораны и кафе из маршрута. Попробуйте снова.'), 'error');
        return false;
      }
      const reachabilityIssue = checkTerminalReachability(distances, placesUsed, result.order, startTerminalIndex, endTerminalIndex);
      if (reachabilityIssue) {
        stop();
        showInfoPlaque(reachabilityIssue, 'error');
        return false;
      }
      const fullRoute = attachRememberedOptions(buildFullRoute(result, placesUsed, matrix, distances, modes, details, startTerminalIndex, endTerminalIndex), rememberedOriginalOptions);
      const remainingSections = appliedRestaurantSections.filter(s => s.id !== sectionId);
      const { route: taggedRoute, sections: refreshedSections } = retagFoodPoints(fullRoute, remainingSections);
      setRouteData(taggedRoute);
      setAppliedRestaurantSections(refreshedSections.length > 0 ? refreshedSections : [createEmptyRestaurantSection()]);
      showInfoPlaque(t('Ресторан "{name}" удалён из маршрута').replace('{name}', restaurantName), 'success');
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

  // "Применить" в "Режим передвижения": переоптимизация с новыми тумблерами
  const handleApplyTransportOptions = async (toggles: TransportModeToggles): Promise<boolean> => handleApplyTransportOptionsImpl({ appliedRestaurantSections, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, buildPreserveTransportOverrides, checkTerminalReachability, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, pendingLegOverrides, pendingOverrideRowHeights, pickerRevealTimeoutRef, rememberedOriginalOptions, reportOptimizationFailure, restaurantSectionToPlace, retagFoodPoints, routeData, routePointToPlace, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictToggles, setCurrentStep, setLegOptions, setPendingLegOverrides, setPickerRevealed, setRememberedOriginalOptions, setRouteData, setSelectedLegId, setTableMorphDone, startOptimizingUI, t }, toggles);

  // Новый AbortController для попытки
  const startOptimizingUI = () => {
    const controller = new AbortController();
    optimizeAbortControllerRef.current = controller;
    setIsOptimizing(true);
    setOptimizationMessage(getRandomMessage());
    // Сообщения и точки меняются каждые 2 с
    const messageInterval = setInterval(() => setOptimizationMessage(prev => getRandomMessage(prev)), 2000);
    const dotInterval = setInterval(() => setDotCount(prev => (prev + 1) % 4), 500);
    // closingModal=true держит окно опций скрытым до его закрытия
    return (closingModal?: boolean) => {
      clearInterval(messageInterval);
      clearInterval(dotInterval);
      if (closingModal) {
        closingOptionsModalRef.current = true;
      }
      setIsOptimizing(false);
      setDotCount(0);
      if (optimizeAbortControllerRef.current === controller) {
        optimizeAbortControllerRef.current = null;
      }
    };
  };

  const isAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

  // Единое сообщение о провале расчёта
  const reportOptimizationFailure = (error: unknown) => {
    if (error instanceof TravelMatrixError) {
      showInfoPlaque(t('Не удалось построить маршрут. Измените параметры или сократите число точек и попробуйте снова'), 'error');
    } else {
      showInfoPlaque(t('Произошла ошибка при оптимизации маршрута. Попробуйте снова.'), 'error');
    }
  };

  // Предельное расстояние до терминала, м
  const TERMINAL_MAX_DISTANCE_M = 60000;

  const checkTerminalReachability = (
    distances: number[][],
    placesUsed: any[],
    order: number[],
    startTerminalIndex: number | null,
    endTerminalIndex: number | null
  ): string | null => {
    if (order.length === 0) return null;
    const tooFar = (i: number, j: number) => {
      const d1 = distances[i]?.[j] || 0;
      const d2 = distances[j]?.[i] || 0;
      const distance = d1 && d2 ? Math.min(d1, d2) : (d1 || d2);
      return distance > TERMINAL_MAX_DISTANCE_M;
    };

    const startTooFar = startTerminalIndex !== null
      && tooFar(startTerminalIndex, placesUsed.findIndex(p => p.id === order[0]));
    const endTooFar = endTerminalIndex !== null
      && tooFar(placesUsed.findIndex(p => p.id === order[order.length - 1]), endTerminalIndex);

    if (startTooFar) {
      return t('Начальная точка слишком далеко. Измените адрес или маршрут');
    }
    if (endTooFar) {
      return t('Конечная точка слишком далеко. Измените адрес или маршрут');
    }
    return null;
  };

  const handleOptimize = async () => handleOptimizeImpl({ appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, checkTerminalReachability, endPoint, endPointCoords, endPointToggle, endTime, endWithStartPoint, isAbortError, language, lastOptimizedInputsRef, openSettingsForInfeasibility, optimizeAbortControllerRef, peopleCount, rememberedOriginalOptions, reportOptimizationFailure, restaurantSectionToPlace, retagFoodPoints, routeData, routeDate, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setConflictToggles, setCurrentStep, setRememberedOriginalOptions, setRouteData, startOptimizingUI, startPoint, startPointCoords, startPointToggle, startTime, t, validateStep2 });

  // "Настройка времени": пересчёт с выбранными длительностями
  const handleApplyTimeSettings = async (timeSettings: { [key: number]: number }): Promise<boolean> => handleApplyTimeSettingsImpl({ appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, baseDurations, buildAppliedFoodForceEdges, buildFullRoute, buildPreserveTransportOverrides, checkTerminalReachability, conflictRestaurantSections, conflictToggles, currentStep, isAbortError, openSettingsForInfeasibility, optimizeAbortControllerRef, pendingAttractions, pendingLegOverrides, pendingOverrideRowHeights, pickerRevealTimeoutRef, rememberedOriginalOptions, reportOptimizationFailure, resolveConflictRestaurantToast, restaurantSectionsBaseline, restaurantSectionToPlace, retagFoodPoints, routeData, routePointToPlace, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setCurrentStep, setLegOptions, setPendingAttractions, setPendingLegOverrides, setPickerRevealed, setRouteData, setSelectedAttractions, setSelectedLegId, setTableMorphDone, startOptimizingUI, t, toTransportOptions }, timeSettings);

  // "Приоритеты": убираем наименее важные точки, пока маршрут не станет возможным
  const handleApplyPriorities = async (orderedPlaces: any[]) => handleApplyPrioritiesImpl({ appliedRestaurantSections, appliedTransportToggles, attachRememberedOptions, buildAppliedFoodForceEdges, buildFullRoute, checkTerminalReachability, conflictRestaurantSectionId, conflictRestaurantSections, conflictToggles, isAbortError, language, openTransportModeModal, optimizeAbortControllerRef, rememberedOriginalOptions, reportOptimizationFailure, resolveConflictRestaurantToast, restaurantSectionsBaseline, restaurantSectionToPlace, retagFoodPoints, runOptimizationForPlaces, selectedAttractions, setAppliedRestaurantSections, setAppliedTransportToggles, setConflictRestaurantSectionId, setConflictRestaurantSections, setConflictRestaurantToast, setConflictToggles, setCurrentStep, setPendingAttractions, setRouteData, setSelectedAttractions, setShowRestaurantModal, setShowSettingsModal, startOptimizingUI, t, toTransportOptions }, orderedPlaces);

  // Прогресс-бар (и в окне, и на экране ожидания оптимизации)
  const renderProgressBar = (attachRef = false) => renderProgressBarImpl({ currentStep, effectiveFullscreen, labelTimer, onClose, onToggleFullscreen, progressBarRef, setLabelTimer, setShowLabels, setShowTrafficLight, showLabels, showTrafficLight, steps }, attachRef);

  return (
    <>
      {/* Модальное окно */}
      <div
        className="fixed inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0, zIndex: effectiveFullscreen ? FULLSCREEN_Z : zIndex + 10, pointerEvents: 'none' }}
      >
        <div
          className="pp-modal relative bg-white flex flex-col overflow-hidden"
          style={{
            pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
            position: 'absolute',
            top: '50%',
            left: '50%',
            opacity: suspended ? 0 : (isVisible ? 1 : 0),
            boxShadow: layerBoxShadow(depth),
            ...cardBoxStyle(effectiveFullscreen, offsetX, offsetY, isVisible ? 1 : 0.95),
            transition: `${FULLSCREEN_TRANSITION}, box-shadow 0.3s ease`,
          }}
        >
          {renderProgressBar(true)}

          {/* Контент с анимацией */}
          <div className="flex-1 overflow-hidden relative">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-400 text-sm">{t('Загрузка данных...')}</div>
              </div>
            ) : (
              <div
                className="flex h-full transition-transform duration-500 ease-in-out"
                style={{ transform: `translateX(-${currentStep * 100}%)` }}
              >
                {/* Шаг 1: Точки посещения */}
                <div className="min-w-full h-full flex flex-col p-6 overflow-y-auto" inert={currentStep !== 0}>
                  <div className="mb-4 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">1/4</span>
                      <h2 className="text-xl font-semibold text-gray-800">{t('Точки посещения')}</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t('Выберите достопримечательности для маршрута')}</p>
                  </div>

                  <div className="flex gap-5 flex-1 min-h-0">
                    <div className="flex-[2] flex flex-col min-h-0">
                      <div className="flex gap-2 mb-3 flex-shrink-0">
                        <input
                          ref={attractionSearchInputRef}
                          type="text"
                          value={searchQuery}
                          onChange={handleSearchChange}
                          onFocus={handleSearchFocus}
                          onKeyDown={e => { if (e.key === 'Enter') handleSearchSubmit(); }}
                          placeholder={t('Поиск')}
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                        />
                        <button
                          onClick={handleFilterIconClick}
                          className={`w-9 h-9 border rounded-lg flex items-center justify-center ${
                            isFilterActive
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200'
                          }`}
                        >
                          <SliderHorizontal3Icon color={isFilterActive ? '#007AFF' : '#4B5563'} size={18} />
                        </button>
                      </div>

                      {(showSearchResults || isFiltersApplied) && !showFilters && (
                        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {visibleAttractions.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              {awaitingSubmit
                                ? (isLiveAvailable ? t('Нажмите Enter, чтобы искать по всей Москве и области') : t('Нажмите Enter, чтобы искать'))
                                : liveLoadingCount > 0
                                  ? t('Ищем по всей Москве и области…')
                                  : t('Ничего не найдено')}
                            </div>
                          ) : (
                            visibleAttractions.map(attraction => {
                              const isAdded = selectedAttractions.some(a => a.id === attraction.id);
                              const isRowExpanded = expandedSearchRowId === attraction.id;
                              const expandLineCount =
                                (attraction.description ? 1 : 0) +
                                (attraction.address ? 1 : 0) +
                                (attraction.work_time && attraction.work_time !== '-' ? 1 : 0);
                              const hasExpandContent = expandLineCount > 0;
                              // max-height близок к высоте контента
                              const expandMaxHeightPx = 12 + expandLineCount * 18;
                              // Переход как у expand-эффекта таблицы маршрута
                              const expandTransition = isRowExpanded
                                ? 'max-height 0.55s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.45s ease-out'
                                : 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-in-out';
                              return (
                                <div
                                  key={attraction.id}
                                  data-row-id={attraction.id}
                                  className="pp-add-row flex flex-col px-3 py-2 hover:bg-gray-50 relative"
                                  onMouseEnter={hasExpandContent ? () => handleSearchRowMouseEnter(attraction.id) : undefined}
                                  onMouseLeave={hasExpandContent ? (e) => handleSearchRowMouseLeave(attraction.id, e) : undefined}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className={`text-sm ${isAdded ? 'text-gray-400' : 'text-gray-700'}`}>
                                      {searchDisplayName(attraction)}
                                      {isAdded && ' ✓'}
                                    </span>
                                    <button
                                      onClick={() => handleAddAttraction(attraction)}
                                      disabled={isAdded}
                                      className={`pp-add-trigger w-6 h-6 flex items-center justify-center flex-shrink-0 ${
                                        isAdded ? 'cursor-not-allowed' : ''
                                      }`}
                                    >
                                      <PlusCircleIcon color={isAdded ? '#9CA3AF' : '#007AFF'} size={22} />
                                    </button>
                                  </div>
                                  {hasExpandContent && (
                                    <div
                                      className="overflow-hidden"
                                      style={{
                                        transition: expandTransition,
                                        maxHeight: isRowExpanded ? `${expandMaxHeightPx / 16}rem` : '0px',
                                        opacity: isRowExpanded ? 1 : 0,
                                      }}
                                    >
                                      <div className="pt-1 text-xs text-gray-500 space-y-0.5">
                                        {attraction.description && (
                                          <div className="text-gray-600">{attraction.description}</div>
                                        )}
                                        {attraction.address && <div>{attraction.address}</div>}
                                        {attraction.work_time && attraction.work_time !== '-' && (
                                          <div>{attraction.work_time}</div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                          {visibleAttractions.length > 0 && (liveLoadingCount > 0 || hasMoreLive) ? (
                            <div className="px-3 py-3 text-center text-xs text-gray-400">
                              {liveLoadingCount > 0
                                ? t('Ищем по всей Москве и области…')
                                : (
                                  <button onClick={handleLoadMoreLive} className="pp-plain text-sm text-[#007AFF]">
                                    {t('Показать ещё')}
                                  </button>
                                )}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {showFilters && (
                        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg p-4">
                          <div className="mb-3 text-xs text-gray-400 text-center">
                            {t('Нажмите на иконку фильтра, чтобы применить изменения')}
                          </div>
                          {categoryNames.map(category => (
                            <div key={category} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                              <span className="text-sm text-gray-700">{t(category)}</span>
                              <button
                                onClick={() => handleFilterToggle(category)}
                                className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                                  tempFilters.includes(category) ? 'bg-[#007AFF]' : 'bg-gray-300'
                                }`}
                              >
                                <div className={`
                                  absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                                  ${tempFilters.includes(category) ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                                `} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {!showSearchResults && !showFilters && !isFiltersApplied && (
                        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                          {t('Начните поиск или откройте фильтры')}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 border-l border-gray-200 pl-5 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-3 flex-shrink-0">
                        <h3 className="text-sm font-medium text-gray-700">{t('Список достопримечательностей')}</h3>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {selectedAttractions.length}
                        </span>
                      </div>
                      <div className="flex-1 overflow-y-auto min-h-0">
                        {selectedAttractions.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm">
                            <span className="text-2xl mb-1">📍</span>
                            <p>{t('Выберите места')}</p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {selectedAttractions.map(attraction => (
                              <div key={attraction.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg group">
                                <span className="text-sm truncate">{selectedDisplayName(attraction)}</span>
                                <button
                                  onClick={() => handleRemoveAttraction(attraction.id)}
                                  className="pp-plain text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Точки питания предка ниже разделительной черты */}
                        {appliedRestaurantSections.some(s => s.restaurant) && (
                          <>
                            <div className="my-3 border-t border-gray-200" />
                            <div className="space-y-1.5">
                              {appliedRestaurantSections.filter(s => s.restaurant).map(section => (
                                <div key={`food-${section.id}`} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg group">
                                  <span className="text-sm truncate">{section.restaurant!.name}</span>
                                  <button
                                    onClick={() => setAppliedRestaurantSections(prev => {
                                      const next = prev.filter(s => s.id !== section.id);
                                      return next.length > 0 ? next : [createEmptyRestaurantSection()];
                                    })}
                                    className="pp-plain text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end mt-4 pt-3 border-t border-gray-100 flex-shrink-0">
                    <button
                      onClick={handleNext}
                      disabled={selectedAttractions.length === 0}
                      className={`px-4 py-2 rounded-xl text-sm font-medium ${
                        selectedAttractions.length === 0
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-500 text-white'
                      }`}
                    >
                      {t('Далее')}
                    </button>
                  </div>
                </div>

                {/* Шаг 2: Параметры маршрута */}
                {renderStep2()}

                {/* Шаг 3: Персонализация */}
                <div className="min-w-full h-full flex flex-col p-6 overflow-hidden" inert={currentStep !== 2}>
                  <div className="mb-4 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">3/4</span>
                      <h2 className="text-xl font-semibold text-gray-800">{t('Персонализация')}</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t('Настройте маршрут под свои предпочтения')}</p>
                  </div>

                  <div className="flex-1 flex gap-6 min-h-0">
                    <div className="flex-1 flex flex-col min-h-0">
                      {renderRouteList()}
                    </div>

                    <div className={`flex flex-col gap-4 flex-shrink-0 transition-[width] duration-500 ease-in-out ${effectiveFullscreen ? 'w-[32.5rem]' : 'w-80'}`}>
                      {/* Мини-карта (active - только на шаге 3, чтобы не тратить квоту) */}
                      <RouteMiniMap routeData={routeData} active={currentStep === 2} />

                      <div className="flex flex-col gap-2">
                        <button
                          onClick={openSettingsManually}
                          className="w-full px-4 py-2.5 flex items-center gap-2.5 text-left text-sm font-medium text-gray-700 bg-gray-50 rounded-xl"
                        >
                          <ClockIcon color="#007AFF" size={18} />
                          {t('Время посещения и приоритеты')}
                        </button>
                        <button
                          onClick={openTransportModeModal}
                          className="w-full px-4 py-2.5 flex items-center gap-2.5 text-left text-sm font-medium text-gray-700 bg-gray-50 rounded-xl"
                        >
                          <CarBadgeGearshapeFillIcon color="#007AFF" size={18} />
                          {t('Режим передвижения')}
                        </button>
                        <button
                          onClick={openRestaurantModal}
                          className="w-full px-4 py-2.5 flex items-center gap-2.5 text-left text-sm font-medium text-gray-700 bg-gray-50 rounded-xl"
                        >
                          <ForkKnifeIcon color="#007AFF" size={18} />
                          {t('Рестораны и кафе')}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between mt-4 pt-3 border-t border-gray-100 flex-shrink-0">
                    <button
                      onClick={handleBack}
                      className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
                    >
                      {t('Назад')}
                    </button>
                    <button
                      onClick={handleNext}
                      className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
                    >
                      {t('Далее')}
                    </button>
                  </div>
                </div>

                {/* Шаг 4: Экспорт */}
                <div className="min-w-full h-full flex flex-col p-6 overflow-hidden" inert={currentStep !== 3}>
                  <div className="mb-4 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">4/4</span>
                      <h2 className="text-xl font-semibold text-gray-800">{t('Экспорт')}</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{t('Сохраните или экспортируйте готовый маршрут')}</p>
                  </div>

                  <div className="flex-1 flex gap-8 min-h-0">
                    <div className="flex-1 flex flex-col gap-4">
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('Название маршрута')} <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={routeTitle}
                            onChange={(e) => {
                              setRouteTitle(e.target.value);
                              if (e.target.value.trim()) setTitleError(false);
                            }}
                            placeholder={t('Например: «Москва за один день»')}
                            className={`w-full px-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all placeholder:text-gray-400 ${
                              titleError ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200'
                            }`}
                          />
                        </div>

                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            {t('Обложка маршрута')} <span className="text-gray-400 text-xs font-normal">{t('(опционально)')}</span>
                          </label>
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const file = e.target.files[0];
                                  if (file.size > COVER_MAX_FILE_BYTES) {
                                    // Прежняя обложка остаётся; value сбрасываем для повторного выбора файла
                                    showInfoPlaque(t('Файл слишком большой. Максимальный размер обложки - 10 МБ'), 'error');
                                    e.target.value = '';
                                    return;
                                  }
                                  setCoverImageName(file.name);
                                  prepareCoverImage(file).then(setCoverImage).catch(() => setCoverImage(null));
                                }
                              }}
                            />
                            <div className="pp-plaque flex items-center gap-3 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50/50">
                              <PhotoIcon size={20} className="text-gray-400 flex-shrink-0" />
                              <span className="text-sm text-gray-500 truncate">{coverImageName || t('Выберите изображение')}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          {t('Описание маршрута')} <span className="text-gray-400 text-xs font-normal">{t('(опционально)')}</span>
                        </label>
                        <textarea
                          value={routeDescription}
                          onChange={(e) => setRouteDescription(e.target.value)}
                          placeholder={t('Краткое описание маршрута...')}
                          rows={3}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all resize-none placeholder:text-gray-400"
                        />
                      </div>

                      <div className="flex gap-4 mt-1">
                        <div className="w-1/2 space-y-3">
                          <p className="text-sm font-medium text-gray-700">{t('Экспортировать как')}</p>

                          <div
                            onClick={handleExportPDF}
                            className={`flex items-center justify-between px-4 py-3 bg-white pp-plaque border border-gray-200 rounded-xl cursor-pointer group ${
                              !routeTitle.trim() ? 'opacity-50 pointer-events-none' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <DocumentIcon size={20} className="text-red-500 flex-shrink-0" />
                              <span className="text-sm font-medium text-gray-700">PDF</span>
                              <span className="text-xs text-gray-400">{t('Скачать как PDF-файл')}</span>
                            </div>
                            <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>

                          <div
                            onClick={handleExportJSON}
                            className={`flex items-center justify-between px-4 py-3 bg-white pp-plaque border border-gray-200 rounded-xl cursor-pointer group ${
                              !routeTitle.trim() ? 'opacity-50 pointer-events-none' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <CurlybracesIcon size={20} className="text-yellow-600 flex-shrink-0" />
                              <span className="text-sm font-medium text-gray-700">JSON</span>
                              <span className="text-xs text-gray-400">{t('Экспорт в формате JSON')}</span>
                            </div>
                            <svg className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>

                          {/* Ссылка - доступ внутрь приложения, поэтому отдельный подраздел */}
                          {isLoggedIn && (
                            <div className="pt-1">
                              <div className="w-10 h-px bg-gray-200 mb-3" />
                              <div
                                onClick={handleCopyLink}
                                className={`flex items-center justify-between px-4 py-3 bg-white pp-plaque border border-gray-200 rounded-xl cursor-pointer group ${
                                  !routeTitle.trim() ? 'opacity-50 pointer-events-none' : ''
                                }`}
                              >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <LinkIcon size={20} className="text-blue-500 flex-shrink-0" />
                                  <span className="text-sm font-medium text-gray-700">URL</span>
                                  <span className="text-xs text-gray-400 flex-1 truncate">{t('Поделиться ссылкой')}</span>
                                </div>
                                <span className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg flex-shrink-0">
                                  {urlCopied ? t('Готово') : t('Скопировать ссылку')}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="w-1/2 space-y-3">
                          <p className="text-sm font-medium text-gray-700">{t('Параметры сохранения')}</p>

                          <div className="px-4 py-3 bg-gray-50/70 rounded-xl border border-gray-100/50 space-y-3">
                            {/* Скрыт при адаптации владельцем (обе кнопки наследуют настройку) */}
                            {isAdmin && !adaptFrom?.detail.is_owner && (
                              <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200/70">
                                <span className="text-sm text-gray-700">{t('Сохранить как личный')}</span>
                                <button
                                  onClick={() => setSaveAsPersonal(!saveAsPersonal)}
                                  className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                                    saveAsPersonal ? 'bg-[#007AFF]' : 'bg-gray-300'
                                  }`}
                                >
                                  <div className={`
                                    absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                                    ${saveAsPersonal ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                                  `} />
                                </button>
                              </div>
                            )}

                            {isAdmin && !saveAsPersonal ? (
                              <p className="text-sm font-medium text-blue-500">{t('Создание нового маршрута от имени админа')}</p>
                            ) : (
                              <>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm text-gray-700">{t('Доступ:')}</span>
                                  <select
                                    value={accessLevel}
                                    onChange={(e) => setAccessLevel(e.target.value as 'private' | 'public')}
                                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="private">{t('Приватный')}</option>
                                    <option value="public" disabled={!isLoggedIn}>{t('Открытый')}</option>
                                  </select>
                                </div>
                                {!isLoggedIn && (
                                  <p className="text-xs text-gray-400">{t('Войдите в аккаунт, чтобы сохранять открытые маршруты')}</p>
                                )}

                                {/* grid-template-rows 0fr -> 1fr вместо max-height */}
                                <div className={`grid transition-all duration-300 ease-out ${
                                  accessLevel === 'public' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                                }`}>
                                  <div className="overflow-hidden">
                                    <div className="flex items-center justify-between gap-3 pt-1">
                                      <span className="text-sm text-gray-700">{t('Показывать:')}</span>
                                      <select
                                        value={displayMode}
                                        onChange={(e) => setDisplayMode(e.target.value as 'full' | 'points_only')}
                                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      >
                                        <option value="full">{t('Готовый маршрут')}</option>
                                        <option value="points_only">{t('Только точки посещения')}</option>
                                      </select>
                                    </div>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-72 flex-shrink-0">
                      <div className="bg-gray-50/70 rounded-2xl p-5 border border-gray-100/50">
                        <div className="space-y-4">
                          <div>
                            <div className="text-xs text-gray-400 mb-0.5">{t('Количество точек посещения')}</div>
                            <div className="text-lg font-semibold text-gray-800">
                              {routeData.filter(item => item.type === 'attraction').length}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-gray-400 mb-0.5">{t('Общее время')}</div>
                            <div className="text-lg font-semibold text-gray-800">
                              {(() => {
                                const firstTime = routeData.length > 0 ? routeData[0].time : '--:--';
                                const lastTime = routeData.length > 0 ? routeData[routeData.length - 1].time : '--:--';
                                return formatDuration(firstTime, lastTime);
                              })()}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-gray-400 mb-0.5">{t('Общая стоимость')}</div>
                            <div className="text-lg font-semibold text-gray-800">
                              {Math.round(routeData.reduce((sum, item) => sum + (item.cost || 0), 0) * peopleCount)} ₽
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between mt-4 pt-3 border-t border-gray-100 flex-shrink-0">
                    <button
                      onClick={handleBack}
                      className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
                    >
                      {t('Назад')}
                    </button>
                    {adaptFrom?.detail.is_owner ? (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleUpdateInPlace}
                          className="px-4 py-2 rounded-xl bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
                        >
                          {t('Обновить текущий')}
                        </button>
                        <button
                          onClick={handleSave}
                          className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
                        >
                          {t('Сохранить как новый')}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
                      >
                        {t('Сохранить')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Затемнение слоёв глубже верхнего - см. layerScrimOpacity */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      </div>

      {/* Экран оптимизации вынесен на верхний уровень (виден и на первой оптимизации) */}
      {showOptimizingOverlay && (
        <div
          className="pp-modal fixed bg-white flex flex-col overflow-hidden"
          style={{
            top: '50%',
            left: '50%',
            // z-index выше окон опций в fullscreen
            zIndex: effectiveFullscreen ? FULLSCREEN_Z + 30 : zIndex + 40,
            pointerEvents: isTop ? 'auto' : 'none',
            opacity: optimizingVisible ? 1 : 0,
            boxShadow: layerBoxShadow(depth),
            transition: `${FULLSCREEN_TRANSITION}, box-shadow 0.3s ease`,
            ...cardBoxStyle(effectiveFullscreen, offsetX, offsetY, optimizingVisible ? 1 : 0.97),
          }}
        >
          {renderProgressBar()}
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-6">
                <p className="text-xl font-medium text-gray-800">
                  {optimizationMessage}
                </p>
                <div className="flex gap-2">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="w-3 h-3 bg-blue-500 rounded-full transition-all duration-300"
                      style={{
                        opacity: index < dotCount ? 1 : 0.2,
                        transform: `scale(${index < dotCount ? 1 : 0.8})`
                      }}
                    />
                  ))}
                </div>
                <button
                  onClick={handleCancelOptimization}
                  className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
                >
                  {t('Отменить')}
                </button>
              </div>
            </div>
            {/* Разделительная черта снизу */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex-shrink-0" style={{ height: '3.125rem' }} />
          </div>

          {/* Затемнение слоёв глубже верхнего - см. layerScrimOpacity */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      )}

      {/* Модальное окно настроек */}
      {showSettingsModal && (
        <SettingsModal
          isOpen={showSettingsModal}
          zIndex={zIndex + 20}
          offsetX={offsetX}
          offsetY={offsetY}
          isTop={isTop}
          depth={depth}
          isFullscreen={effectiveFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          // На время применения окно опций гаснет (suspended)
          suspended={suspended || isOptimizing || closingOptionsModalRef.current}
          onClose={() => {
            setShowSettingsModal(false);
            // Слой закрылся
            closingOptionsModalRef.current = false;
            // Закрытие конфликта: отклонённая попытка отбрасывается
            setPendingAttractions(null);
            // Закрытие конфликта: отбрасываем и вставку ресторана
            setConflictRestaurantSections(null);
            setConflictRestaurantSectionId(null);
            setConflictRestaurantToast(null);
          }}
          onRequestFullClose={onBackdropClose}
          attractions={[
            ...(pendingAttractions ?? selectedAttractions).map(p => ({
              id: p.id,
              name: p.name,
              type: 'attraction',
              icon: 'pin',
              address: p.address || t('Адрес не указан'),
              workTime: p.work_time || '-',
              time: '--:--',
              endTime: '--:--',
              cost: p.ticket_price || 0,
              isUserDefined: false,
              duration: baseDurations[p.id] ?? p.recommended_duration ?? 60,
              currentDuration: p.recommended_duration || 60,
              // Отброшенная оптимизатором точка подсвечивается в приоритетах
              isExcluded: routeData.length > 0 && !routeData.some(r => r.type === 'attraction' && r.id === p.id)
            })),
            // Применённые точки питания в конце списка (наименьший приоритет)
            ...restaurantSectionsBaseline.filter(s => s.restaurant).map(s => ({
              id: `restaurant-${s.id}`,
              name: s.restaurant!.name,
              type: 'food',
              icon: 'restaurant',
              address: s.restaurant!.address,
              workTime: s.restaurant!.workTime,
              time: '--:--',
              endTime: '--:--',
              cost: s.restaurant!.avgCheck || 0,
              isUserDefined: false,
              duration: DEFAULT_RESTAURANT_VISIT_MINUTES,
              currentDuration: s.visitMinutes,
              isExcluded: routeData.length >0 && !routeData.some(r => r.type === 'food' && r.id === `restaurant-${s.id}`)
            })),
          ]}
          availableTime={availableTime}
          neededReductionMinutes={neededReduction}
          travelTimeMinutes={travelTimeMinutes}
          timeTabDisabled={timeTabDisabled}
          preferPrioritiesTab={settingsPreferPriorities}
          onApplyTime={handleApplyTimeSettings}
          onApplyPriorities={handleApplyPriorities}
        />
      )}

      {showTransportModeModal && (
        <TransportModeModal
          isOpen={showTransportModeModal}
          zIndex={zIndex + 20}
          offsetX={offsetX}
          offsetY={offsetY}
          isTop={isTop}
          depth={depth}
          isFullscreen={effectiveFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          // На время применения окно гаснет
          suspended={suspended || isOptimizing || closingOptionsModalRef.current}
          onClose={() => {
            setShowTransportModeModal(false);
            closingOptionsModalRef.current = false;
            // "Назад" забывает все изменения
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
          }}
          onRequestFullClose={onBackdropClose}
          onApply={handleApplyTransportOptions}
          ferryFeasible={ferryFeasible}
          initialToggles={appliedTransportToggles}
          routeTableContent={renderRouteList(true)}
          legSelected={selectedLegId !== null}
          hasPendingLegOverride={pendingLegOverrides.size > 0}
        />
      )}

      {showRestaurantModal && (
        <RestaurantModal
          isOpen={showRestaurantModal}
          zIndex={zIndex + 20}
          offsetX={offsetX}
          offsetY={offsetY}
          isTop={isTop}
          depth={depth}
          isFullscreen={effectiveFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          // На время применения окно гаснет
          suspended={suspended || isOptimizing || closingOptionsModalRef.current}
          onClose={() => { setShowRestaurantModal(false); closingOptionsModalRef.current = false; }}
          onRequestFullClose={onBackdropClose}
          onApply={handleApplyRestaurantSections}
          onDeleteSection={handleDeleteRestaurantSection}
          initialSections={appliedRestaurantSections}
          visitPoints={restaurantVisitPoints}
          renderSlotPointRow={renderRestaurantSlotPointRow}
        />
      )}

      {/* Офскрин-снимок для экспорта в PDF */}
      {routeData.length > 0 && renderExportSnapshot()}
    </>
  );
};

export default CreateRouteModal;
