import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { API_BASE_URL } from '../../api/client';
import { PlusCircleIcon } from '../sfSymbols';
import { useMeasuredWidth, layerBoxShadow, layerScrimOpacity, cardBoxStyle, FULLSCREEN_TRANSITION, FULLSCREEN_Z, DEFAULT_HEADER_HEIGHT, trafficLightZone } from '../layerGeometry';
import TrafficLight from '../TrafficLight';
import { useTranslation } from '../../i18n/LanguageContext';
import { DEFAULT_RESTAURANT_VISIT_MINUTES, RESTAURANT_ACCENT_BG, type RestaurantCandidate, type RestaurantGap, type RestaurantSectionState, type RestaurantSlot, type RestaurantVisitPoint, assignRecommendedRestaurantSlots, computeRestaurantGaps, createEmptyRestaurantSection, formatRestaurantDistance, formatRestaurantRating, parseRestaurantTimeMinutes, restaurantSectionsSignature, sectionHasChanges } from './restaurantModel';
import { LEG_COLLAPSE_EASE, LEG_MORPH_DURATION_MS } from './transportModeTypes';
import { RestaurantCandidateRow, RestaurantSlotNewPointRow } from './RestaurantRows';

// Экран "Рестораны и кафе" (механика окна как у SettingsModal)
export const RestaurantModal = ({
  isOpen,
  onClose,
  onRequestFullClose,
  onApply,
  onDeleteSection,
  initialSections,
  visitPoints,
  renderSlotPointRow,
  zIndex,
  offsetX,
  offsetY,
  isTop,
  depth,
  isFullscreen,
  onToggleFullscreen,
  suspended,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRequestFullClose?: () => void;
  // true - экран закрывается
  onApply: (sections: RestaurantSectionState[]) => Promise<boolean>;
  // Удаление применённой точки питания
  onDeleteSection: (sectionId: number) => Promise<boolean>;
  // Применённые разделы (окно открывается с них)
  initialSections: RestaurantSectionState[];
  visitPoints: RestaurantVisitPoint[];
  // Строка точки посещения той же разметки, что в главной таблице
  renderSlotPointRow: (point: RestaurantVisitPoint, options?: {
    hidden?: boolean;
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    dragging?: boolean;
    onRowClick?: () => void;
    accent?: boolean;
    accentActive?: boolean;
    gapKey?: string;
    noExpand?: boolean;
  }) => React.ReactNode;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  isFullscreen: boolean;
  onToggleFullscreen?: () => void;
  suspended?: boolean;
}) => {
  const { t, language } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [sections, setSections] = useState<RestaurantSectionState[]>(initialSections);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [showHeaderTrafficLight, setShowHeaderTrafficLight] = useState(false);
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);
  // Кандидаты для активного раздела (живой поиск)
  const [candidates, setCandidates] = useState<RestaurantCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(false);
  // Drag-and-drop новой точки в слоте
  const [draggingNewPoint, setDraggingNewPoint] = useState(false);
  const [dragOverGapKey, setDragOverGapKey] = useState<string | null>(null);
  // Слот на момент открытия редактирования
  const [slotSnapshotOnEditStart, setSlotSnapshotOnEditStart] = useState<RestaurantSlot | null>(null);
  // Контейнер таблицы слота (FLIP-раскрытие)
  const restaurantTableContainerRef = useRef<HTMLDivElement>(null);
  const restaurantFlipFirstRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);
  const pointById = (id: number | string) => visitPoints.find(p => p.id === id) || null;

  // Середина применённого слота питания, мин
  const foodSectionMidpoint = (s: RestaurantSectionState): number | null => {
    if (!s.restaurant) return null;
    const point = pointById(`restaurant-${s.id}`);
    if (!point) return null;
    const start = parseRestaurantTimeMinutes(point.time);
    let end = parseRestaurantTimeMinutes(point.endTime);
    if (start === null || end === null) return null;
    if (end <= start) end += 1440;
    return (start + end) / 2;
  };

  // Черновик собирается из применённого состояния при каждом открытии
  useEffect(() => {
    if (!isOpen) { setIsVisible(false); return; }
    setIsVisible(true);
    const seeded = (initialSections.length > 0 ? initialSections : [createEmptyRestaurantSection()])
      .map(s => ({ ...s, editingSlot: false }));
    const gaps = computeRestaurantGaps(visitPoints);
    const pendingIndexes = seeded
      .map((s, idx) => (s.restaurant ? -1 : idx))
      .filter(idx => idx !== -1);
    const existingMidpoints = seeded.map(foodSectionMidpoint).filter((m): m is number => m !== null);
    const recommended = assignRecommendedRestaurantSlots(gaps, pendingIndexes.length, existingMidpoints);
    const withSlots = seeded.map((s, idx) => {
      if (s.restaurant) return s;
      if (s.slotMode === 'custom' && s.slot) return s;
      const pendingPos = pendingIndexes.indexOf(idx);
      const gap = recommended[pendingPos];
      return { ...s, slot: gap ? { beforeId: gap.beforeId, afterId: gap.afterId } : null };
    });
    setSections(withSlots);
    setActiveSectionIndex(0);
    setHoveredCandidateId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(), 300);
  };

  const handleApply = async () => {
    const shouldClose = await onApply(sections.filter(s => s.restaurant !== null));
    if (shouldClose) handleClose();
  };

  const updateSection = (id: number, patch: Partial<RestaurantSectionState>) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleAddSection = () => {
    const newSection = createEmptyRestaurantSection();
    const gaps = computeRestaurantGaps(visitPoints);
    // Рекомендованный слот для нового раздела с учётом занятых
    const existingMidpoints = sections.map(foodSectionMidpoint).filter((m): m is number => m !== null);
    const recommended = assignRecommendedRestaurantSlots(gaps, sections.length + 1, existingMidpoints);
    const gap = recommended[sections.length];
    newSection.slot = gap ? { beforeId: gap.beforeId, afterId: gap.afterId } : null;
    setSections(prev => [...prev, newSection]);
    setActiveSectionIndex(sections.length);
  };

  // Крестик раздела: удаление применённой точки или просто раздела
  const handleRemoveSection = async (id: number) => {
    const appliedMatch = initialSections.find(s => s.id === id && s.restaurant !== null);
    if (appliedMatch) {
      const shouldClose = await onDeleteSection(id);
      if (shouldClose) handleClose();
      return;
    }
    setSections(prev => {
      if (prev.length === 1) {
        return prev.map(s => (s.id === id ? { ...createEmptyRestaurantSection(), id: s.id, slot: s.slot } : s));
      }
      const removedIdx = prev.findIndex(s => s.id === id);
      const next = prev.filter(s => s.id !== id);
      setActiveSectionIndex(cur => (removedIdx <= cur ? Math.max(0, cur - 1) : cur));
      return next;
    });
  };

  // Активный раздел (нужен обработчикам drag-and-drop и FLIP)
  const activeSectionForGuard = sections[activeSectionIndex] ?? sections[0];

  // FLIP: снимок геометрии до изменения
  const captureRestaurantFlipBefore = () => {
    const container = restaurantTableContainerRef.current;
    if (!container) return;
    const rects = new Map<string, DOMRect>();
    container.querySelectorAll('[data-row-id]').forEach((el) => {
      const id = el.getAttribute('data-row-id');
      if (id) rects.set(id, el.getBoundingClientRect());
    });
    restaurantFlipFirstRectsRef.current = rects;
  };

  // Клик по маркеру открывает и закрывает редактор слота
  const handleMarkerClick = () => {
    const section = activeSectionForGuard;
    if (!section) return;
    captureRestaurantFlipBefore();
    if (!section.editingSlot) {
      setSlotSnapshotOnEditStart(section.slot);
      updateSection(section.id, { editingSlot: true });
    } else {
      const moved = !!(section.slot && slotSnapshotOnEditStart && (
        section.slot.beforeId !== slotSnapshotOnEditStart.beforeId ||
        section.slot.afterId !== slotSnapshotOnEditStart.afterId
      ));
      updateSection(section.id, {
        editingSlot: false,
        slotMode: moved ? 'custom' : section.slotMode,
      });
      setDraggingNewPoint(false);
      setDragOverGapKeyBoth(null);
    }
  };

  const handleNewPointDragStart = () => setDraggingNewPoint(true);
  const handleNewPointDragEnd = () => {
    setDraggingNewPoint(false);
    setDragOverGapKeyBoth(null);
  };

  // Зазор, ближайший к курсору при перетаскивании
  const restaurantGapByKeyRef = useRef<Map<string, RestaurantGap>>(new Map());
  const dragOverGapKeyRef = useRef<string | null>(null);
  const setDragOverGapKeyBoth = (key: string | null) => {
    dragOverGapKeyRef.current = key;
    setDragOverGapKey(key);
  };
  const applyClosestGapKey = (clientY: number) => {
    const container = restaurantTableContainerRef.current;
    if (!container) return;
    let closestKey: string | null = null;
    let closestDist = Infinity;
    container.querySelectorAll('[data-gap-key]').forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - center);
      if (dist < closestDist) {
        closestDist = dist;
        closestKey = el.getAttribute('data-gap-key');
      }
    });
    if (closestKey !== dragOverGapKeyRef.current) setDragOverGapKeyBoth(closestKey);
  };
  // Фиксация переноса точки в слот (смена ресторана или слота)
  const commitSlotDrop = () => {
    const section = activeSectionForGuard;
    const key = dragOverGapKeyRef.current;
    const gap = key ? restaurantGapByKeyRef.current.get(key) : null;
    if (section && gap) {
      const appliedMatch = initialSections.find(s => s.id === section.id && s.restaurant !== null) || null;
      const isBackToApplied = !!appliedMatch?.slot
        && appliedMatch.slot.beforeId === gap.beforeId && appliedMatch.slot.afterId === gap.afterId;
      const isSameAsCurrent = !!section.slot
        && section.slot.beforeId === gap.beforeId && section.slot.afterId === gap.afterId;
      updateSection(section.id, {
        slot: { beforeId: gap.beforeId, afterId: gap.afterId },
        restaurant: isBackToApplied ? appliedMatch!.restaurant : (isSameAsCurrent ? section.restaurant : null),
        visitMinutes: isBackToApplied ? appliedMatch!.visitMinutes : section.visitMinutes,
        expandedCandidateId: isBackToApplied ? appliedMatch!.expandedCandidateId : null,
      });
    }
    setDraggingNewPoint(false);
    setDragOverGapKeyBoth(null);
  };

  // Резервное отслеживание курсора на уровне документа во время перетаскивания
  useEffect(() => {
    if (!draggingNewPoint) return;
    const onDocumentDragOver = (e: DragEvent) => {
      e.preventDefault();
      applyClosestGapKey(e.clientY);
    };
    const onDocumentDrop = (e: DragEvent) => {
      e.preventDefault();
      commitSlotDrop();
    };
    document.addEventListener('dragover', onDocumentDragOver);
    document.addEventListener('drop', onDocumentDrop);
    return () => {
      document.removeEventListener('dragover', onDocumentDragOver);
      document.removeEventListener('drop', onDocumentDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingNewPoint]);

  // Единая таблица слота: строки схлопываются, а не размонтируются
  const renderSlotEditorRows = () => {
    const section = activeSectionForGuard;
    if (!section?.slot) return null;
    const editing = section.editingSlot;
    const appliedMatch = initialSections.find(s => s.id === section.id && s.restaurant !== null) || null;
    const appliedFoodPoint = appliedMatch ? pointById(`restaurant-${section.id}`) : null;
    const points = appliedFoodPoint
      ? visitPoints.filter(p => p.id !== appliedFoodPoint.id)
      : visitPoints;
    const currentKey = `${section.slot.beforeId}:${section.slot.afterId}`;
    const appliedKey = appliedMatch?.slot ? `${appliedMatch.slot.beforeId}:${appliedMatch.slot.afterId}` : null;
    const isMarkerAtAppliedPosition = !!appliedFoodPoint && currentKey === appliedKey;
    const eligibleGaps = computeRestaurantGaps(points);
    const eligibleByKey = new Map(eligibleGaps.map(g => [`${g.beforeId}:${g.afterId}`, g]));
    restaurantGapByKeyRef.current = eligibleByKey;

    const markerBeforeIdx = points.findIndex(p => p.id === section.slot!.beforeId);

    const rows: React.ReactNode[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // Соседи слота остаются видимыми
      const isSlotNeighbor = i === markerBeforeIdx || i === markerBeforeIdx + 1;
      rows.push(
        <React.Fragment key={`pt-${point.id}`}>
          {renderSlotPointRow(point, { hidden: !editing && !isSlotNeighbor })}
        </React.Fragment>
      );
      if (i === points.length - 1) continue;
      const before = points[i];
      const after = points[i + 1];
      const gapKey = `${before.id}:${after.id}`;
      if (gapKey === currentKey) {
        const isSelfOver = dragOverGapKey === currentKey;
        rows.push(
          <React.Fragment key="marker">
            {isMarkerAtAppliedPosition && appliedFoodPoint ? (
              // Применённая точка: полная строка с акцентом
              renderSlotPointRow(appliedFoodPoint, {
                draggable: editing,
                onDragStart: handleNewPointDragStart,
                onDragEnd: handleNewPointDragEnd,
                dragging: draggingNewPoint,
                onRowClick: handleMarkerClick,
                accent: true,
                accentActive: isSelfOver,
                gapKey: currentKey,
                // В режиме редактирования hover-expand отключён
                noExpand: editing,
              })
            ) : (
              <RestaurantSlotNewPointRow
                draggable={editing}
                onDragStart={handleNewPointDragStart}
                onDragEnd={handleNewPointDragEnd}
                dragging={draggingNewPoint}
                onClick={handleMarkerClick}
                gapKey={currentKey}
                active={isSelfOver}
                // Ресторан раздела уже выбран
                label={section.restaurant
                  ? section.restaurant.name
                  : appliedFoodPoint ? t('Данная точка маршрута') : t('Новая точка маршрута')}
              />
            )}
          </React.Fragment>
        );
        continue;
      }
      const gap = eligibleByKey.get(gapKey);
      const isOver = dragOverGapKey === gapKey;
      const showDivider = editing && !!gap;
      // Зазор прежнего положения применённой точки (серая линия)
      const isVacatedAppliedSlot = !isMarkerAtAppliedPosition && !!appliedKey && gapKey === appliedKey;
      rows.push(
        <tr key={`gap-${gapKey}`} data-row-id={`gap-${gapKey}`}>
          <td colSpan={4} className="p-0">
            <div
              data-gap-key={gap ? gapKey : undefined}
              className="flex items-center select-none pl-3 pr-3"
              style={{
                maxHeight: showDivider ? 24 : 0,
                opacity: showDivider ? 1 : 0,
                overflow: 'hidden',
                transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out`,
              }}
            >
              <div
                className="w-full rounded-full transition-all duration-150"
                style={{
                  height: isOver ? 3 : 2,
                  backgroundColor: isVacatedAppliedSlot
                    ? (isOver ? '#000000' : '#9CA3AF')
                    : (isOver ? '#3B82F6' : '#BFDBFE'),
                }}
              />
            </div>
          </td>
        </tr>
      );
    }
    return rows;
  };

  // FLIP: геометрия "после" снимается после применения новых размеров
  useLayoutEffect(() => {
    const firstRects = restaurantFlipFirstRectsRef.current;
    if (!firstRects) return;
    restaurantFlipFirstRectsRef.current = null;
    const container = restaurantTableContainerRef.current;
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
    void container.offsetHeight;
    deltas.forEach(({ row }) => {
      row.style.transition = `transform ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`;
      row.style.transform = '';
    });
  }, [activeSectionForGuard?.editingSlot]);

  const hasChanges = restaurantSectionsSignature(sections) !== restaurantSectionsSignature(initialSections);
  // Изменения в активном разделе блокируют переключение и удаление других
  const activeSectionHasChanges = activeSectionForGuard ? sectionHasChanges(activeSectionForGuard, initialSections) : false;

  // Живой поиск "Подходящие места" для слота активного раздела
  useEffect(() => {
    const section = activeSectionForGuard;
    if (!isOpen || !section?.slot || section.editingSlot) {
      setCandidates([]);
      setCandidatesLoading(false);
      setCandidatesError(false);
      return;
    }
    const before = pointById(section.slot.beforeId);
    const after = pointById(section.slot.afterId);
    if (!before && !after) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError(false);
    fetch(`${API_BASE_URL}/restaurants/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        before: before ? { lat: before.latitude, lon: before.longitude } : null,
        after: after ? { lat: after.latitude, lon: after.longitude } : null,
      }),
    })
      .then(r => { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(data => {
        if (cancelled) return;
        setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCandidatesError(true);
        setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeSectionForGuard?.id, activeSectionForGuard?.slot?.beforeId, activeSectionForGuard?.slot?.afterId, activeSectionForGuard?.editingSlot]);

  if (!isOpen) return null;

  const activeSection = sections[activeSectionIndex] ?? sections[0];
  const hoveredCandidate = hoveredCandidateId != null
    ? candidates.find(c => c.id === hoveredCandidateId) || null
    : null;
  // Плашка остаётся для уже выбранного ресторана
  const displayedCandidate = hoveredCandidate ?? activeSection?.restaurant ?? null;
  const candidatesVisible = !!activeSection?.slot && !activeSection.editingSlot;
  // Слот совпадает с применённым к маршруту
  const activeAppliedMatch = activeSection
    ? initialSections.find(s => s.id === activeSection.id && s.restaurant !== null) || null
    : null;
  const isActiveMarkerAtAppliedPosition = !!(
    activeSection?.slot && activeAppliedMatch?.slot &&
    activeSection.slot.beforeId === activeAppliedMatch.slot.beforeId &&
    activeSection.slot.afterId === activeAppliedMatch.slot.afterId
  );

  return (
    <div
      className="fixed inset-0 flex items-center justify-center transition-opacity duration-300 select-none"
      style={{
        opacity: isVisible ? 1 : 0,
        zIndex: isFullscreen && isTop ? FULLSCREEN_Z + 20 : zIndex,
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}
    >
      <div
        className="absolute inset-0"
        style={{ pointerEvents: isTop && !suspended ? 'auto' : 'none' }}
        onClick={() => onRequestFullClose?.()}
      />
      <div
        className="pp-modal relative bg-white flex flex-col overflow-hidden select-none"
        style={{
          pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
          position: 'absolute',
          top: '50%',
          left: '50%',
          opacity: suspended ? 0 : (isVisible ? 1 : 0),
          boxShadow: layerBoxShadow(depth),
          transition: `${FULLSCREEN_TRANSITION}, box-shadow 0.3s ease`,
          ...cardBoxStyle(isFullscreen && isTop, offsetX, offsetY, isVisible ? 1 : 0.95),
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}
      >
        <div
          className="relative border-b border-gray-100 flex-shrink-0 select-none"
          style={{ height: DEFAULT_HEADER_HEIGHT }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setShowHeaderTrafficLight(e.clientX - rect.left <= trafficLightZone(24, titleWidth));
          }}
          onMouseLeave={() => setShowHeaderTrafficLight(false)}
        >
          <div
            className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150 select-none"
            style={{ opacity: showHeaderTrafficLight ? 0 : 1, transitionDelay: showHeaderTrafficLight ? '0ms' : '150ms' }}
          >
            <h2 ref={titleRef} className="text-xl font-semibold text-gray-800 select-none">{t('Рестораны и кафе')}</h2>
          </div>
          <div
            className="absolute inset-0 flex items-center pl-6 transition-opacity duration-150"
            style={{
              opacity: showHeaderTrafficLight ? 1 : 0,
              transitionDelay: showHeaderTrafficLight ? '150ms' : '0ms',
              pointerEvents: showHeaderTrafficLight ? 'auto' : 'none',
            }}
          >
            <TrafficLight
              onClose={() => onRequestFullClose?.()}
              fullscreenAvailable
              isFullscreen={isFullscreen && isTop}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>

        {/* Панель разделов в стиле вкладок SettingsModal */}
        <div className="flex items-center gap-1 px-6 pt-4 border-b border-gray-100 select-none flex-wrap">
          {(() => {
            // "+" скрыт, пока есть незаполненная новая точка
            const hasEmptySection = sections.some(s => s.restaurant === null);
            return sections.map((section, idx) => {
              const isActive = idx === activeSectionIndex;
              const title = section.restaurant ? section.restaurant.name : t('Новая точка');
              const showDeleteButton = section.restaurant !== null || sections.length > 1;
              // Блокировка переключения разделов при неприменённых изменениях
              const isBlocked = !isActive && activeSectionHasChanges;
              // "+" только после применения последней точки
              const isApplied = initialSections.some(s => s.id === section.id && s.restaurant !== null);
              // "+" скрыт при неприменённых изменениях
              const showAddButton = idx === sections.length - 1 && isApplied && !hasEmptySection && !activeSectionHasChanges;
              return (
                <div key={section.id} className="relative flex items-center select-none">
                  <div
                    onClick={() => { if (!isBlocked) setActiveSectionIndex(idx); }}
                    className={`group relative flex items-center gap-1 px-3 py-2 rounded-t-lg transition-colors select-none ${
                      isBlocked ? 'cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      isActive ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <span className="text-sm font-medium whitespace-nowrap max-w-[10rem] truncate select-none">{title}</span>
                    {showDeleteButton && (
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!isBlocked) handleRemoveSection(section.id); }}
                        className={`pp-plain text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ${
                          isBlocked ? 'cursor-not-allowed' : ''
                        } ${
                          // Крестик активного раздела виден всегда, у остальных - при наведении на вкладку
                          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {/* Кнопка "+" вне вкладки */}
                  {showAddButton && (
                    <button
                      onClick={() => handleAddSection()}
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ml-0.5"
                    >
                      <PlusCircleIcon color="#007AFF" size={22} />
                    </button>
                  )}
                </div>
              );
            });
          })()}
        </div>

        <div className="flex-1 flex gap-6 min-h-0 p-6 overflow-hidden select-none">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center mb-2 flex-shrink-0">
              <h3 className="text-xs font-medium text-gray-400 select-none">
                {t(activeSection?.slotMode === 'custom' ? 'Пользовательский слот' : 'Рекомендованный слот')}
              </h3>
            </div>

            {!activeSection?.slot ? (
              <div className="flex-shrink-0 p-4 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
                {t('Не нашлось свободного окна в маршруте для добавления новой точки')}
              </div>
            ) : (
              // Единая таблица: клик по маркеру сворачивает и разворачивает слот
              <div className="flex-1 flex flex-col min-h-0">
                <div
                  className="px-4 text-center text-blue-500 text-xs flex-shrink-0 select-none overflow-hidden"
                  style={{
                    maxHeight: activeSection.editingSlot ? 32 : 0,
                    opacity: activeSection.editingSlot ? 1 : 0,
                    marginBottom: activeSection.editingSlot ? 8 : 0,
                    paddingTop: activeSection.editingSlot ? 8 : 0,
                    paddingBottom: activeSection.editingSlot ? 8 : 0,
                    // Фон как у строки "Новая точка маршрута"
                    backgroundColor: RESTAURANT_ACCENT_BG,
                    borderBottom: activeSection.editingSlot ? '1px solid rgba(219, 234, 254, 0.5)' : 'none',
                    transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out, margin-bottom ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, padding ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`,
                  }}
                >
                  {t(isActiveMarkerAtAppliedPosition
                    ? 'Перетащите ресторан в другой слот для изменения'
                    : activeAppliedMatch
                      ? 'Перетащите данную точку в любой доступный слот'
                      : 'Перетащите новую точку в любой доступный слот')}
                </div>
                {/* Содержимое без горизонтального отступа контейнера */}
                <div
                  ref={restaurantTableContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto border border-gray-200 rounded-xl"
                >
                  <table className="w-full">
                    <tbody>{renderSlotEditorRows()}</tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Плашка кандидата остаётся для выбранного ресторана */}
            {!activeSection?.editingSlot && displayedCandidate && (
              <div className="mt-3 flex-shrink-0 p-3.5 bg-white border border-gray-100 rounded-xl shadow-sm select-none">
                <div className="text-sm font-semibold text-gray-800">{displayedCandidate.name}</div>
                <div className="text-sm text-gray-600 mt-0.5">{displayedCandidate.address}</div>
                <div className="text-sm text-gray-600">{displayedCandidate.workTime}</div>
                <div className="text-sm text-gray-600">{formatRestaurantDistance(displayedCandidate.distanceMeters, language)}</div>
                <div style={{ borderTop: '1px solid #f3f4f6', margin: '10px 0' }} />
                {displayedCandidate.cuisine && (
                  <div className="text-sm text-gray-600 mb-0.5">{displayedCandidate.cuisine}</div>
                )}
                {displayedCandidate.avgCheck != null && (
                  <div className="mb-0.5">
                    <div className="text-sm text-gray-600">{t('Средний чек')}</div>
                    <div className="text-sm text-gray-600">{displayedCandidate.avgCheck}₽</div>
                  </div>
                )}
                <div className="text-sm text-gray-600">{t('Рейтинг: ')}{formatRestaurantRating(displayedCandidate.rating)}</div>
              </div>
            )}
          </div>

          {/* Внешняя обёртка и прокручиваемый внутренний блок */}
          <div className={`flex flex-col flex-shrink-0 min-h-0 transition-[width] duration-500 ease-in-out ${isFullscreen && isTop ? 'w-[32.5rem]' : 'w-80'}`}>
            <h3 className="text-xs font-medium text-gray-400 mb-1 select-none flex-shrink-0">{t('Подходящие места')}</h3>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {!activeSection?.slot ? (
                // Слота нет - пустое место
                <div className="h-full" />
              ) : !candidatesVisible ? (
                <div className="h-full flex items-center justify-center text-center text-xs text-gray-800 select-none">
                  {t('Нажмите на строку для подтверждения слота')}
                </div>
              ) : candidatesLoading ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-400 select-none">
                  {t('Ищем места поблизости...')}
                </div>
              ) : candidatesError ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-400 select-none">
                  {t('Не удалось загрузить рестораны')}
                </div>
              ) : candidates.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-400 select-none">
                  {t('Рядом ничего не найдено')}
                </div>
              ) : (
                <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {candidates.map((candidate, candidateIdx) => (
                    <RestaurantCandidateRow
                      key={candidate.id}
                      candidate={candidate}
                      active={activeSection?.restaurant?.id === candidate.id}
                      expanded={activeSection?.expandedCandidateId === candidate.id}
                      isFirst={candidateIdx === 0}
                      isLast={candidateIdx === candidates.length - 1}
                      visitMinutes={activeSection?.restaurant?.id === candidate.id ? activeSection.visitMinutes : DEFAULT_RESTAURANT_VISIT_MINUTES}
                      onSelect={() => activeSection && updateSection(activeSection.id, {
                        restaurant: candidate,
                        expandedCandidateId: candidate.id,
                        visitMinutes: activeSection.restaurant?.id === candidate.id ? activeSection.visitMinutes : DEFAULT_RESTAURANT_VISIT_MINUTES,
                      })}
                      onVisitMinutesChange={(minutes) => activeSection && updateSection(activeSection.id, { visitMinutes: minutes })}
                      onHoverStart={() => setHoveredCandidateId(candidate.id)}
                      onHoverEnd={() => setHoveredCandidateId(prev => (prev === candidate.id ? null : prev))}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-between px-6 pb-6 pt-3 border-t border-gray-100 flex-shrink-0 select-none">
          <button
            onClick={handleClose}
            className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors select-none"
          >
            {t('Назад')}
          </button>
          {/* Кнопка скрыта, пока таблица слота развёрнута */}
          {hasChanges && !activeSection?.editingSlot && activeSection?.restaurant && (
            <button
              onClick={handleApply}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors select-none"
            >
              {t('Применить изменения')}
            </button>
          )}
        </div>

        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
        />
      </div>
    </div>
  );
};
