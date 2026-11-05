import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { api, type RouteCard, type RouteSection } from '../api/client';
import { EyeFillIcon, EyeSlashFillIcon, PhotoIcon, InfoCircleIcon, PlusIcon } from './sfSymbols';
import { StarButton } from './StarButton';
import { showInfoPlaque } from './InfoPlaque';
import { useTranslation } from '../i18n/LanguageContext';
import { pointWord, paxWord } from '../i18n/plurals';
import { useTooltipEdgeOffset } from './layerGeometry';

const ANCHOR_DURATION_MS = 700;

interface RouteBarProps {
  isHovered: boolean;
  isAdapterMode: boolean;
  isAnyModalOpen: boolean;
  // true - "Просмотр" уже открыт, клик по карточке запрещён
  previewLocked: boolean;
  isLoggedIn: boolean;
  // Счётчик действий входа и выхода (не восстановления сессии)
  authActionNonce: number;
  guestRoutes: RouteCard[];
  justCreatedRouteId: number | null;
  justCreatedTab: 'mine' | 'all';
  justCreatedSkipScroll?: boolean;
  deletedRouteId: number | null;
  refreshKey: number;
  searchTrigger: number;
  pendingUserSearch: { query: string; nonce: number } | null;
  cancelUserSearchTrigger: number;
  onRouteClick: (route: RouteCard) => void;
  onCreateNew: () => void;
  onAdaptRoute: () => void;
  // On It: раздел "Мои" зафиксирован, переключателя вкладок нет
  lockedTab?: FilterTab;
  hideFooterActions?: boolean;
  // On It: избранное нельзя ставить и снимать
  hideFavoriteToggle?: boolean;
  // On It: общий мобильный флаг (увеличенное многоточие, цена и "чел" в две строки)
  mobileMode?: boolean;
}

type FilterTab = 'all' | 'mine' | 'popular' | 'search';

const TAB_LABELS: Record<Exclude<FilterTab, 'search'>, string> = {
  all: 'Все',
  mine: 'Мои',
  popular: 'Популярные',
};

const TAB_ORDER: FilterTab[] = ['all', 'mine', 'popular', 'search'];

const formatRouteDuration = (totalMinutes: number, t: (ru: string) => string): string => {
  const total = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} ${t('мин')}`;
  if (minutes === 0) return `${hours} ${t('ч')}`;
  return `${hours} ${t('ч')} ${minutes} ${t('мин')}`;
};

const LOCK_ICON_SIZE = 17;

const RouteBar = ({
  isHovered,
  isAdapterMode,
  isAnyModalOpen,
  previewLocked,
  isLoggedIn,
  authActionNonce,
  guestRoutes,
  justCreatedRouteId,
  justCreatedTab,
  justCreatedSkipScroll = false,
  deletedRouteId,
  refreshKey,
  searchTrigger,
  pendingUserSearch,
  cancelUserSearchTrigger,
  onRouteClick,
  onCreateNew,
  onAdaptRoute,
  lockedTab,
  hideFooterActions,
  hideFavoriteToggle,
  mobileMode,
}: RouteBarProps) => {
  const { t, language } = useTranslation();
  const [showLabels, setShowLabels] = useState(false);
  const [showInfoText, setShowInfoText] = useState(false);
  const [justActivatedId, setJustActivatedId] = useState<number | null>(null);

  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [forceShowTabs, setForceShowTabs] = useState(false);
  const forceShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTabs = isHeaderHovered || forceShowTabs;

  const [activeTab, setActiveTab] = useState<FilterTab>(lockedTab ?? 'all');
  useEffect(() => {
    if (lockedTab) setActiveTab(lockedTab);
  }, [lockedTab]);
  // Смена активного раздела не анимируется перетеканием
  const prevActiveTabForOpacityRef = useRef(activeTab);
  const skipOpacityTransition = prevActiveTabForOpacityRef.current !== activeTab;
  useEffect(() => {
    prevActiveTabForOpacityRef.current = activeTab;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [sections, setSections] = useState<RouteSection[]>([]);
  // Вкладка, которой принадлежат данные в sections
  const [sectionsTab, setSectionsTab] = useState<FilterTab>('all');

  const [pendingScrollToTop, setPendingScrollToTop] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [pendingStarToggle, setPendingStarToggle] = useState<Set<number>>(new Set());
  const [hoveredCostInfoId, setHoveredCostInfoId] = useState<number | null>(null);
  // Один хук на все карточки (тултип одновременно только один)
  const { wrapRef: costInfoTooltipRef, arrowOffset: costInfoArrowOffset } = useTooltipEdgeOffset(hoveredCostInfoId !== null);
  const [hoveredEllipsisId, setHoveredEllipsisId] = useState<number | null>(null);
  const { wrapRef: ellipsisTooltipRef, arrowOffset: ellipsisArrowOffset } = useTooltipEdgeOffset(hoveredEllipsisId !== null);

  const [descPhase, setDescPhase] = useState<Map<number, 'expanding' | 'expanded' | 'collapsing'>>(new Map());
  const [overlayHeights, setOverlayHeights] = useState<Map<number, number>>(new Map());
  const [descAnimMetrics, setDescAnimMetrics] = useState<Map<number, { collapsed: number; total: number }>>(new Map());
  const [truncatedDescIds, setTruncatedDescIds] = useState<Set<number>>(new Set());
  const namingSpaceRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const cardBodyRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const collapsedDescRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());
  const descAnimTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!showInfoText) return;
    const timer = setTimeout(() => {
      const next = new Set<number>();
      collapsedDescRefs.current.forEach((el, id) => {
        if (el && el.scrollHeight > el.clientHeight + 1) next.add(id);
      });
      setTruncatedDescIds(next);
    }, 50);
    return () => clearTimeout(timer);
  }, [showInfoText, sections]);

  useEffect(() => {
    if (isHovered) return;
    descAnimTimersRef.current.forEach(timer => clearTimeout(timer));
    descAnimTimersRef.current.clear();
    setDescPhase(new Map());
    setOverlayHeights(new Map());
  }, [isHovered]);

  const handleToggleDescription = (e: React.MouseEvent, routeId: number) => {
    e.stopPropagation();
    const phase = descPhase.get(routeId);
    if (phase === 'expanding' || phase === 'collapsing') return;

    if (phase === 'expanded') {
      const metrics = descAnimMetrics.get(routeId);
      if (!metrics) return;
      setDescPhase(prev => new Map(prev).set(routeId, 'collapsing'));
      setOverlayHeights(prev => new Map(prev).set(routeId, metrics.collapsed));
      const timer = setTimeout(() => {
        setDescPhase(prev => {
          const next = new Map(prev);
          next.delete(routeId);
          return next;
        });
        descAnimTimersRef.current.delete(routeId);
      }, 650);
      descAnimTimersRef.current.set(routeId, timer);
      return;
    }

    const namingEl = namingSpaceRefs.current.get(routeId);
    const bodyEl = cardBodyRefs.current.get(routeId);
    if (!namingEl || !bodyEl) return;
    const collapsed = namingEl.getBoundingClientRect().height;
    const total = bodyEl.getBoundingClientRect().height;
    setDescAnimMetrics(prev => new Map(prev).set(routeId, { collapsed, total }));
    setOverlayHeights(prev => new Map(prev).set(routeId, collapsed));
    setDescPhase(prev => new Map(prev).set(routeId, 'expanding'));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setOverlayHeights(prev => new Map(prev).set(routeId, total));
      });
    });
    const timer = setTimeout(() => {
      setDescPhase(prev => new Map(prev).set(routeId, 'expanded'));
      descAnimTimersRef.current.delete(routeId);
    }, 650);
    descAnimTimersRef.current.set(routeId, timer);
  };

  // Принудительная перерисовка слоя панели после серии переходов
  const routeBarPanelRef = useRef<HTMLDivElement>(null);
  const prevHoveredForNudgeRef = useRef(isHovered);
  useEffect(() => {
    if (!prevHoveredForNudgeRef.current && isHovered) {
      const el = routeBarPanelRef.current;
      if (el) {
        // Синхронный reflow, чтобы transform считался изменением
        void el.offsetHeight;
        el.style.transform = 'translateZ(0.001px)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transform = '';
          });
        });
      }
    }
    prevHoveredForNudgeRef.current = isHovered;
  }, [isHovered]);

  // Подстройка прокрутки при расширении и сворачивании: карточка под курсором остаётся на месте
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const stopAnchorRef = useRef<(() => void) | null>(null);
  const prevHoveredForAnchorRef = useRef(isHovered);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { pointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  useLayoutEffect(() => {
    const wasHovered = prevHoveredForAnchorRef.current;
    prevHoveredForAnchorRef.current = isHovered;
    if (wasHovered === isHovered) return;

    stopAnchorRef.current?.();
    stopAnchorRef.current = null;
    if (mobileMode) return;

    const list = listContainerRef.current;
    const pointer = pointerRef.current;
    if (!list) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-route-card]'));
    if (cards.length === 0) return;

    const pickCard = (y: number) => {
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;
      for (const card of cards) {
        const r = card.getBoundingClientRect();
        const distance = Math.max(r.top - y, y - r.bottom, 0);
        if (distance < bestDistance) { bestDistance = distance; best = card; }
      }
      return best;
    };

    let anchorY: number;
    let initialTarget: HTMLElement | null = null;
    if (isHovered) {
      if (!pointer) return;
      // Курсор не над списком (фильтры/поиск/зона "+") - сценарии 1 и 3
      const hit = document.elementFromPoint(pointer.x, pointer.y);
      if (!hit || !list.contains(hit)) return;
      anchorY = pointer.y;
    } else {
      const listRect = list.getBoundingClientRect();
      if (!pointer || pointer.y < listRect.top || pointer.y > listRect.bottom) return;
      anchorY = pointer.y;
      initialTarget = pickCard(pointer.y);
    }

    const startedAt = performance.now();
    let rafId = 0;
    let stopped = false;
    let target: HTMLElement | null = null;
    let ratio = 0;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      list.removeEventListener('wheel', stop);
      list.removeEventListener('touchstart', stop);
      list.removeEventListener('pointerdown', stop);
    };
    stopAnchorRef.current = stop;
    list.addEventListener('wheel', stop, { passive: true });
    list.addEventListener('touchstart', stop, { passive: true });
    list.addEventListener('pointerdown', stop);

    const setTarget = (card: HTMLElement, y: number) => {
      target = card;
      const r = card.getBoundingClientRect();
      ratio = r.height > 0 ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0;
    };

    const tick = () => {
      if (stopped) return;
      const y = anchorY;
      if (!target) {
        const picked = initialTarget ?? pickCard(y);
        if (!picked) { stop(); return; }
        setTarget(picked, y);
      }

      const rect = target!.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const pinY = Math.min(listRect.bottom, Math.max(listRect.top, y));
      let desiredTop = pinY - ratio * rect.height;
      const lowest = Math.max(listRect.top, pinY - rect.height);
      const highest = Math.min(listRect.bottom - rect.height, pinY);
      desiredTop = lowest > highest ? lowest : Math.min(highest, Math.max(lowest, desiredTop));
      const delta = rect.top - desiredTop;
      if (Math.abs(delta) >= 0.5) list.scrollTop += delta;

      if (performance.now() - startedAt < ANCHOR_DURATION_MS) {
        rafId = requestAnimationFrame(tick);
      } else {
        stop();
      }
    };
    tick();
  }, [isHovered]);

  useEffect(() => {
    if (isHovered) {
      const timer = setTimeout(() => {
        setShowLabels(true);
        setShowInfoText(true);
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setShowLabels(false);
      setShowInfoText(false);
    }
  }, [isHovered]);

  useEffect(() => {
    if (justCreatedRouteId === null) return;
    setActiveTab(justCreatedTab);
    setSearchQuery('');
    if (forceShowTimerRef.current) clearTimeout(forceShowTimerRef.current);
    setForceShowTabs(true);
    forceShowTimerRef.current = setTimeout(() => setForceShowTabs(false), 5000);
    if (!justCreatedSkipScroll) setPendingScrollToTop(true);
  }, [justCreatedRouteId, justCreatedTab, justCreatedSkipScroll]);

  const isFirstAuthActionRef = useRef(true);
  useEffect(() => {
    if (isFirstAuthActionRef.current) {
      isFirstAuthActionRef.current = false;
      return;
    }
    setSearchQuery('');
    if (isLoggedIn) {
      setActiveTab('mine');
      if (forceShowTimerRef.current) clearTimeout(forceShowTimerRef.current);
      setForceShowTabs(true);
      forceShowTimerRef.current = setTimeout(() => setForceShowTabs(false), 5000);
    } else {
      // Очищаем sections, чтобы не мелькали маршруты прежнего аккаунта
      setSections([]);
      setActiveTab('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authActionNonce]);

  useEffect(() => {
    if (activeTab === 'search') return;
    if (!isLoggedIn && activeTab === 'mine') {
      setSections([{ key: 'mine', label: t('Созданные'), routes: guestRoutes }]);
      setSectionsTab('mine');
      return;
    }
    let cancelled = false;
    const requestedTab = activeTab;
    api.getRoutes({ category: requestedTab }).then((data) => {
      if (cancelled) return;
      if ('sections' in data) setSections(data.sections);
      setSectionsTab(requestedTab);
    }).catch(() => {
      if (cancelled) return;
      setSections([]);
      setSectionsTab(requestedTab);
    });
    return () => {
      cancelled = true;
    };
    // justCreatedRouteId в зависимостях: нужна перезагрузка при уже открытой вкладке
  }, [activeTab, isLoggedIn, guestRoutes, justCreatedRouteId, refreshKey, language]);

  useEffect(() => {
    if (deletedRouteId === null) return;
    const keysToRemoveFrom = sections
      .filter(section => section.routes.some(r => r.id === deletedRouteId))
      .map(section => section.key);
    if (keysToRemoveFrom.length === 0) return;

    const cellKeys = keysToRemoveFrom.map(key => `${key}:${deletedRouteId}`);
    setRemovingIds(prev => new Set([...prev, ...cellKeys]));
    const timer = setTimeout(() => {
      setSections(prev => prev
        .map(section => keysToRemoveFrom.includes(section.key)
          ? { ...section, routes: section.routes.filter(r => r.id !== deletedRouteId) }
          : section)
        .filter(section => section.routes.length > 0));
      setRemovingIds(prev => {
        const next = new Set(prev);
        cellKeys.forEach(key => next.delete(key));
        return next;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [deletedRouteId]);

  // Поиск - с debounce, чтобы не дёргать бэкенд на каждое нажатие клавиши
  useEffect(() => {
    if (activeTab !== 'search') return;
    const query = searchQuery.trim();
    if (!query) {
      setSections([]);
      return;
    }
    const timer = setTimeout(() => {
      api.getRoutes({ search: query }).then((data) => {
        setSections(data.sections);
      }).catch(() => setSections([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, searchQuery, isLoggedIn, language]);

  useEffect(() => {
    if (!pendingScrollToTop || sectionsTab === 'search') return;
    listContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setPendingScrollToTop(false);
  }, [sections, sectionsTab, pendingScrollToTop]);

  const handleTabClick = (tab: Exclude<FilterTab, 'search'>) => {
    setActiveTab(tab);
    setSearchQuery('');
    setIsSearchExpanded(false);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setActiveTab(value.trim() ? 'search' : 'all');
  };

  const handleSearchExpand = () => {
    setActiveTab('search');
    setIsSearchExpanded(true);
  };

  // Cmd/Ctrl+F: раскрыть поле и сфокусировать (первый рендер пропускаем)
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isFirstSearchTriggerRef = useRef(true);
  useEffect(() => {
    if (isFirstSearchTriggerRef.current) {
      isFirstSearchTriggerRef.current = false;
      return;
    }
    handleSearchExpand();
    // Фокус следующим тактом, когда поле уже смонтировано
    requestAnimationFrame(() => searchInputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  const preSearchTabRef = useRef<FilterTab>('all');
  useEffect(() => {
    if (!pendingUserSearch) return;
    preSearchTabRef.current = activeTab;
    setSearchQuery(pendingUserSearch.query);
    handleSearchExpand();
    requestAnimationFrame(() => searchInputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUserSearch?.nonce]);

  const isFirstCancelSearchRef = useRef(true);
  useEffect(() => {
    if (isFirstCancelSearchRef.current) {
      isFirstCancelSearchRef.current = false;
      return;
    }
    setSearchQuery('');
    setActiveTab(preSearchTabRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelUserSearchTrigger]);

  const handleSearchCollapse = () => {
    setIsSearchExpanded(false);
    setSearchQuery('');
    setActiveTab('all');
  };

  const updateRouteInSections = (routeId: number, updater: (r: RouteCard) => RouteCard) => {
    setSections(prev => prev.map(section => ({
      ...section,
      routes: section.routes.map(r => (r.id === routeId ? updater(r) : r)),
    })));
  };

  // Звёзды только для вошедших, не для своих маршрутов
  const handleFavoriteToggle = async (routeId: number) => {
    if (isAdapterMode || pendingStarToggle.has(routeId)) return;
    if (!isLoggedIn) {
      showInfoPlaque(t('Войдите в аккаунт, чтобы добавлять маршруты в избранное'), 'info');
      return;
    }
    const route = sections.flatMap(section => section.routes).find(r => r.id === routeId);
    if (route?.is_owner) {
      showInfoPlaque(t('Вы не можете добавлять в избранное созданные Вами маршруты'), 'info');
      return;
    }

    setPendingStarToggle(prev => new Set([...prev, routeId]));
    const result = await api.toggleRouteStar(routeId).catch(() => null);
    setPendingStarToggle(prev => {
      const next = new Set(prev);
      next.delete(routeId);
      return next;
    });
    if (!result || !('success' in result)) return;

    if (!result.is_favorite) {
      const keysToRemoveFrom = sections
        .filter(section => section.routes.some(r => r.id === routeId))
        .filter(section => {
          if (section.key === 'mine_favorited' || section.key === 'mine') return true;
          if (section.key === 'popular') return result.stars_count === 0;
          return false;
        })
        .map(section => section.key);

      if (keysToRemoveFrom.length > 0) {
        // Ключ анимации - "секция:id"
        const cellKeys = keysToRemoveFrom.map(key => `${key}:${routeId}`);
        setRemovingIds(prev => new Set([...prev, ...cellKeys]));
        setTimeout(() => {
          setSections(prev => prev
            .map(section => keysToRemoveFrom.includes(section.key)
              ? { ...section, routes: section.routes.filter(r => r.id !== routeId) }
              : section)
            .filter(section => section.routes.length > 0));
          setRemovingIds(prev => {
            const next = new Set(prev);
            cellKeys.forEach(key => next.delete(key));
            return next;
          });
        }, 400);
      }
    }

    updateRouteInSections(routeId, r => ({
      ...r,
      is_favorite: result.is_favorite,
      stars_count: result.stars_count,
    }));

    if (result.is_favorite) {
      setJustActivatedId(routeId);
      setTimeout(() => {
        setJustActivatedId(current => (current === routeId ? null : current));
      }, 1000);
    }
  };

  // Секция после удаления последнего маршрута остаётся пустой
  const isEmpty = sections.every(section => section.routes.length === 0);

  return (
    <div
      ref={routeBarPanelRef}
      onMouseEnter={(e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; }}
      onMouseLeave={(e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; }}
      className={`h-full transition-all duration-500 ease-in-out bg-white/95 backdrop-blur-md shadow-2xl border-r border-gray-200/50 overflow-hidden flex flex-col ${
        isHovered ? 'w-full' : 'w-full'
      }`}
    >
      {!lockedTab && (
      <div className="p-4 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
        <div className="relative flex-1" style={{ height: '1.75rem' }}>
          <div
            className="relative h-full"
            onMouseEnter={() => setIsHeaderHovered(true)}
            onMouseLeave={() => setIsHeaderHovered(false)}
          >
              {TAB_ORDER.filter(tab => tab !== 'search').map((tab, index) => {
                const isActive = activeTab === tab;
                const visible = isActive || (showTabs && isHovered);
                const leftPercent = isHovered ? index * 25 : 37.5;
                return (
                  <div
                    key={tab}
                    className="absolute top-0 h-full"
                    style={{
                      width: '25%',
                      left: `${leftPercent}%`,
                      opacity: visible ? 1 : 0,
                      pointerEvents: visible ? 'auto' : 'none',
                      transition: skipOpacityTransition
                        ? 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                        : 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
                    }}
                  >
                    <button
                      onClick={() => handleTabClick(tab)}
                      className={`w-full h-full flex items-center justify-center text-sm font-medium whitespace-nowrap ${
                        isActive ? 'text-blue-500' : 'text-gray-500 hover:text-gray-700'
                      }`}
                      style={{
                        borderBottom: '2px solid',
                        borderColor: isActive && isHovered ? '#3b82f6' : 'transparent',
                        transition: 'border-color 0.4s ease, color 0.3s ease',
                      }}
                    >
                      {t(TAB_LABELS[tab])}
                    </button>
                  </div>
                );
              })}

              {(() => {
                const isActive = activeTab === 'search';
                const inputVisible = isHovered && (isActive || showTabs);
                const isExpanded = isActive && isSearchExpanded;
                const labelVisible = isActive && !isHovered;
                const labelLeft = isHovered ? 75 : 37.5;
                return (
                  <>
                    <div
                      className="absolute top-0 h-full"
                      style={{
                        width: isExpanded ? '100%' : '25%',
                        left: isExpanded ? '0%' : '75%',
                        opacity: inputVisible ? 1 : 0,
                        pointerEvents: inputVisible ? 'auto' : 'none',
                        transition: skipOpacityTransition
                          ? 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          : 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), width 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
                      }}
                    >
                      <div
                        className="w-full h-full flex items-center px-1"
                        style={{
                          gap: isExpanded ? 6 : 0,
                          transition: 'gap 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        }}
                      >
                        <input
                          ref={searchInputRef}
                          type="text"
                          value={searchQuery}
                          onChange={(e) => handleSearchChange(e.target.value)}
                          onFocus={handleSearchExpand}
                          placeholder={t('Поиск')}
                          className="flex-1 min-w-0 h-full px-2 rounded-lg bg-gray-100 outline-none text-sm font-medium text-gray-500 placeholder:text-gray-500"
                        />
                        <button
                          type="button"
                          onClick={handleSearchCollapse}
                          tabIndex={isExpanded ? 0 : -1}
                          className="flex-shrink-0 h-7 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-500 hover:text-gray-700"
                          style={{
                            width: isExpanded ? 28 : 0,
                            opacity: isExpanded ? 1 : 0,
                            pointerEvents: isExpanded ? 'auto' : 'none',
                            transition: 'width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease, background-color 0.2s ease, color 0.2s ease',
                          }}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div
                      className="absolute top-0 h-full"
                      style={{
                        width: '25%',
                        left: `${labelLeft}%`,
                        opacity: labelVisible ? 1 : 0,
                        pointerEvents: labelVisible ? 'auto' : 'none',
                        transition: skipOpacityTransition
                          ? 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                          : 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
                      }}
                    >
                      <div className="w-full h-full flex items-center justify-center text-sm font-medium text-blue-500 whitespace-nowrap">
                        {searchQuery.trim() || t('Поиск')}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
        </div>
      </div>
      )}

      {isAdapterMode && (
        <div className="px-4 py-2 bg-blue-50/80 text-blue-500 text-xs text-center border-b border-blue-100/50">
          {t('Нажмите на маршрут, чтобы адаптировать его')}
        </div>
      )}

      <div
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
        style={mobileMode ? { overscrollBehaviorY: 'contain' } : undefined}
      >
        {isEmpty && activeTab === 'mine' && (
          <div className="h-full flex items-center justify-center text-center text-sm text-gray-400 px-4">
            {t(isLoggedIn
              ? 'Здесь появятся ваши созданные и избранные маршруты'
              : 'Войдите в аккаунт, чтобы видеть свои маршруты')}
          </div>
        )}
        {isEmpty && activeTab === 'search' && searchQuery.trim() && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            {t('Ничего не найдено')}
          </div>
        )}
        {isEmpty && (activeTab === 'all' || activeTab === 'popular') && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            {t('Маршрутов пока нет')}
          </div>
        )}

        {sections.map((section, sIndex) => (
          <div key={section.key}>
            {section.label && (
              <>
                {sIndex > 0 && <div className="border-t border-gray-300 -mx-3 mb-3" />}
                <div className="text-xs font-medium text-gray-400 mb-2">{t(section.label)}</div>
              </>
            )}

            <div>
              {section.routes.map((route) => {
                const isRemoving = removingIds.has(`${section.key}:${route.id}`);
                return (
                <div
                  key={route.id}
                  style={{
                    // grid-template-rows 1fr -> 0fr вместо max-height
                    display: 'grid',
                    // Явная ширина колонки, чтобы длинные названия не раздували карточку
                    gridTemplateColumns: '100%',
                    gridTemplateRows: isRemoving ? '0fr' : '1fr',
                    opacity: isRemoving ? 0 : 1,
                    marginBottom: isRemoving ? 0 : 12,
                    transition: 'grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease, margin-bottom 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                <div
                  style={{
                    minHeight: 0,
                    // overflow-hidden только пока карточка схлопывается (иначе режет тень и обводку)
                    overflow: isRemoving ? 'hidden' : 'visible',
                  }}
                >
                <div
                  data-route-card={route.id}
                  className={`rounded-xl pp-route-card bg-gray-100/80 transition-all duration-300 relative shadow-lg ${
                    previewLocked ? 'cursor-not-allowed' : 'cursor-pointer'
                  } ${isAdapterMode ? 'pp-adapter-card' : ''} ${route.id === justCreatedRouteId ? 'animate-route-created' : ''} ${
                    // mobileMode: запрет выделения текста и hover-эффекта карточки на тач-устройствах
                    mobileMode ? 'pp-onit-no-select pp-onit-no-hover' : ''
                  }`}
                  onClick={() => { if (!previewLocked) onRouteClick(route); }}
                  // touch-action: manipulation убирает задержку клика, не блокируя скролл
                  style={mobileMode ? { touchAction: 'manipulation', WebkitTouchCallout: 'none' } : undefined}
                >
                  <div
                    className="rounded-xl overflow-hidden relative"
                    ref={(el) => {
                      if (el) cardBodyRefs.current.set(route.id, el);
                      else cardBodyRefs.current.delete(route.id);
                    }}
                  >
                  <div className="w-full aspect-[16/10] bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-gray-500 text-sm relative overflow-hidden">
                    {route.image ? (
                      <img
                        src={route.image}
                        loading="lazy"
                        decoding="async"
                        alt={route.title}
                        className="w-full h-full object-cover"
                      />
                    ) : isHovered ? (
                      <span className="flex items-center gap-1.5">
                        <PhotoIcon size={16} />
                        {t('Маршрут')}
                      </span>
                    ) : (
                      <PhotoIcon size={22} />
                    )}

                    <div
                      className="absolute top-0 right-0 h-full pointer-events-none"
                      style={{ width: mobileMode ? '28.940625%' : '25%' }}
                    >
                      <div
                        className={`w-full h-full bg-black/40 backdrop-blur-md flex flex-col justify-between py-4 px-1.5 transition-opacity duration-500 ease-out ${
                          showInfoText ? 'opacity-100 pointer-events-auto' : 'opacity-0'
                        }`}
                        style={{
                          // will-change и 3D-transform для backdrop-blur
                          willChange: 'opacity, backdrop-filter',
                          transform: 'translateZ(0)',
                        }}
                      >

                          <div className={`flex flex-col items-end gap-1 transition-opacity duration-300 ease-in-out ${
                            showInfoText ? 'opacity-100' : 'opacity-0'
                          }`}>
                            {route.stars_count !== null && (
                              <StarButton
                                starsCount={route.stars_count}
                                isFavorite={route.is_favorite}
                                // hideFavoriteToggle: счётчик виден, интерактивность отключена
                                disabled={isAdapterMode || pendingStarToggle.has(route.id) || !!hideFavoriteToggle}
                                interactive={!hideFavoriteToggle && isLoggedIn && !isAdapterMode && !route.is_owner}
                                justActivated={justActivatedId === route.id}
                                onToggle={() => handleFavoriteToggle(route.id)}
                              />
                            )}
                            {route.is_owner && !route.is_recommended && (
                              <div className="flex items-center gap-1.5">
                                {route.is_public ? (
                                  <EyeFillIcon color="#007AFF" size={LOCK_ICON_SIZE} />
                                ) : (
                                  <EyeSlashFillIcon color="#007AFF" size={LOCK_ICON_SIZE} />
                                )}
                                <span className="text-sm font-medium text-white drop-shadow-md">
                                  {t(route.is_public ? 'Открытый' : 'Приватный')}
                                </span>
                              </div>
                            )}
                            {route.admin_username && (
                              <span className="text-sm font-medium text-white drop-shadow-md">
                                {t('Админ: ')}{route.admin_username}
                              </span>
                            )}
                          </div>

                          <div className={`flex-1 flex flex-col justify-center items-end gap-1.5 transition-opacity duration-300 ease-in-out ${
                            showInfoText ? 'opacity-100' : 'opacity-0'
                          }`}>
                            <div className="w-6 h-px bg-white/30" />

                            <div className="text-right">
                              <div className="text-sm font-medium text-white drop-shadow-md">{route.points} {pointWord(route.points, language)}</div>
                              {route.duration !== null && (
                                <div className="text-sm font-medium text-white drop-shadow-md">{formatRouteDuration(route.duration, t)}</div>
                              )}
                              {route.cost_per_person !== null && (
                                mobileMode ? (
                                  <>
                                    <div className="text-sm font-medium text-white drop-shadow-md">
                                      {route.cost_per_person.toLocaleString('ru-RU')} ₽
                                    </div>
                                    <div className="text-sm font-medium text-white drop-shadow-md">
                                      × {route.people_count ?? 1} {paxWord(route.people_count ?? 1, language)}
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-sm font-medium text-white drop-shadow-md">
                                    {route.cost_per_person.toLocaleString('ru-RU')} ₽ × {route.people_count ?? 1} {paxWord(route.people_count ?? 1, language)}
                                  </div>
                                )
                              )}
                              {route.cost_per_person !== null && route.cost_excludes_transport && (
                                <div className="flex justify-end">
                                  <span className="relative flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseEnter={() => setHoveredCostInfoId(route.id)}
                                      onMouseLeave={() => setHoveredCostInfoId(null)}
                                      className="w-4 h-4 rounded-full text-white/80 flex items-center justify-center"
                                    >
                                      <InfoCircleIcon size={17} />
                                    </button>
                                    {hoveredCostInfoId === route.id && (
                                      <div
                                        ref={costInfoTooltipRef}
                                        className="pp-tooltip-wrap absolute bottom-full right-0 mb-1.5 z-10 w-32"
                                        style={{ transform: `translateX(${costInfoArrowOffset}px)` }}
                                      >
                                        <div className="pp-tooltip text-[0.6875rem] leading-snug whitespace-normal">
                                          {t('Без учета транспорта')}
                                        </div>
                                      </div>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div />
                        </div>
                      </div>
                  </div>

                  <div
                    className="p-3"
                    ref={(el) => {
                      if (el) namingSpaceRefs.current.set(route.id, el);
                      else namingSpaceRefs.current.delete(route.id);
                    }}
                  >
                    <div className="flex items-center h-6">
                      <p className="flex-1 min-w-0 text-sm font-semibold text-gray-800 truncate">
                        {route.title}
                      </p>
                    </div>
                    <div className={`grid transition-all duration-500 ease-in-out ${
                      isHovered ? 'grid-rows-[1fr] mt-1' : 'grid-rows-[0fr] mt-0'
                    }`}>
                      <p
                        ref={(el) => {
                          if (el) collapsedDescRefs.current.set(route.id, el);
                          else collapsedDescRefs.current.delete(route.id);
                        }}
                        className={`overflow-hidden text-xs text-gray-500 leading-relaxed transition-opacity duration-300 ${
                          showInfoText ? 'opacity-100' : 'opacity-0'
                        }`}
                        style={{
                          // Ограничение в 2 строки через max-height вместо line-clamp
                          maxHeight: '3.25em',
                        }}
                      >
                        {route.description}
                      </p>
                    </div>
                  </div>

                  {descPhase.has(route.id) && (() => {
                    const metrics = descAnimMetrics.get(route.id);
                    const currentHeight = overlayHeights.get(route.id) ?? metrics?.collapsed ?? 0;
                    const isGrown = !!metrics && currentHeight === metrics.total;
                    const phase = descPhase.get(route.id);
                    // Маска-градиент у нижней границы оверлея во время анимации
                    const fadeMask = phase === 'expanding' || phase === 'collapsing'
                      ? 'linear-gradient(to bottom, black calc(100% - 1.5rem), transparent 100%)'
                      : 'none';
                    return (
                    <div
                      className="absolute left-0 right-0 bottom-0 bg-white overflow-hidden"
                      style={{
                        height: currentHeight,
                        borderTopLeftRadius: isGrown ? 12 : 0,
                        borderTopRightRadius: isGrown ? 12 : 0,
                        transition: 'height 0.6s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                        zIndex: 20,
                      }}
                    >
                      {/* Маска на отдельной обёртке, чтобы не съедать фон */}
                      <div className="h-full" style={{ WebkitMaskImage: fadeMask, maskImage: fadeMask }}>
                        <div className="p-3">
                          <div className="flex items-center h-6">
                            <p className="flex-1 min-w-0 text-sm font-semibold text-gray-800 truncate">
                              {route.title}
                            </p>
                          </div>
                          <div className="mt-1 overflow-hidden">
                            <p className="text-xs text-gray-500 leading-relaxed">
                              {route.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {/* На мобильном многоточие крупнее и без hover-тултипа */}
                  {truncatedDescIds.has(route.id) && (!descPhase.has(route.id) || descPhase.get(route.id) === 'expanded') && showInfoText && (
                    <span className="absolute" style={{ right: '0.75rem', bottom: '0.75rem', zIndex: 30 }}>
                      <button
                        type="button"
                        onClick={(e) => handleToggleDescription(e, route.id)}
                        onMouseEnter={mobileMode ? undefined : () => setHoveredEllipsisId(route.id)}
                        onMouseLeave={mobileMode ? undefined : () => setHoveredEllipsisId(null)}
                        className={`block text-blue-500 font-semibold leading-relaxed ${mobileMode ? 'text-sm' : 'text-xs'}`}
                      >
                        …
                      </button>
                      {!mobileMode && hoveredEllipsisId === route.id && (
                        <div
                          ref={ellipsisTooltipRef}
                          className="pp-tooltip-wrap absolute bottom-full right-0 mb-1.5"
                          style={{ transform: `translateX(${ellipsisArrowOffset}px)` }}
                        >
                          <div className="pp-tooltip text-[0.6875rem] leading-snug whitespace-nowrap">
                            {t('Полное описание')}
                          </div>
                        </div>
                      )}
                    </span>
                  )}
                  </div>
                </div>
                </div>
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!hideFooterActions && (
      <div className="p-3 border-t border-gray-100 flex-shrink-0">
        <div className="relative w-full h-12">
          <div
            className={`
              absolute inset-0 rounded-xl bg-blue-500 shadow-lg
              transition-all duration-500 ease-in-out
              ${isHovered ? 'opacity-0' : 'opacity-100'}
            `}
          />

          <div
            className={`
              absolute top-0 left-0 h-full rounded-xl
              transition-all duration-500 ease-in-out
              flex items-center justify-center overflow-hidden
              ${
                isAnyModalOpen
                  ? 'bg-gray-300 cursor-not-allowed shadow-none'
                  : 'bg-blue-500 cursor-pointer hover:bg-blue-600 shadow-lg'
              }
              ${isHovered ? 'w-1/2 rounded-r-none' : 'w-full'}
            `}
            onClick={() => {
              if (!isAnyModalOpen) onCreateNew();
            }}
          >
            <span
              className={`
                text-white font-medium text-sm whitespace-nowrap
                transition-opacity duration-300 ease-in-out
                ${showLabels ? 'opacity-100' : 'opacity-0'}
              `}
            >
              {t('Создать новый')}
            </span>
          </div>

          <div
            className={`
              absolute top-0 right-0 h-full w-1/2 rounded-xl rounded-l-none
              transition-all duration-500 ease-in-out
              flex items-center justify-center overflow-hidden
              ${
                isAnyModalOpen
                  ? 'bg-gray-200/80 cursor-not-allowed shadow-none'
                  : 'bg-white/95 border border-gray-200/50 cursor-pointer hover:bg-gray-100 shadow-lg'
              }
              ${isHovered ? 'opacity-100' : 'opacity-0'}
            `}
            style={{
              // Без backdrop-blur: он вызывал залипание слоя
              pointerEvents: isHovered ? 'auto' : 'none',
            }}
            onClick={() => {
              if (!isAnyModalOpen) onAdaptRoute();
            }}
          >
            <span
              className={`
                text-gray-700 font-medium text-sm whitespace-nowrap
                transition-opacity duration-300 ease-in-out
                ${showLabels ? 'opacity-100' : 'opacity-0'}
              `}
            >
              {t('Адаптировать готовый')}
            </span>
          </div>

          <div
            className={`
              absolute inset-0 flex items-center justify-center
              transition-all duration-500 ease-in-out
              pointer-events-none
              ${isHovered ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}
            `}
          >
            <PlusIcon size={20} color="white" className="drop-shadow-lg" />
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default RouteBar;
