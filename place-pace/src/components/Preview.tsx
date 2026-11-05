import React, { useEffect, useRef, useState } from 'react';
import { api, type RouteCard, type RouteDetail, type GuestRoute } from '../api/client';
import {
  HouseFillIcon,
  PlayFillIcon,
  FlagFillIcon,
  TramFillIcon,
  BusFillIcon,
  LightrailFillIcon,
  CarRearFillIcon,
  FerryFillIcon,
  FigureWalkIcon,
  ForkKnifeIcon,
  TrashIcon,
  InfoCircleIcon,
  DeleteBackwardIcon,
  DocumentIcon,
  LinkIcon,
  CurlybracesIcon,
  ChevronBackwardIcon,
} from './sfSymbols';
import { CompositeTripIcon } from './icons';
import { TransportTimeline } from './TransportTimeline';
import { useHeaderHeightReporter, useMeasuredWidth, useTooltipEdgeOffset, layerBoxShadow, layerScrimOpacity, cardBoxStyle, FULLSCREEN_TRANSITION, FULLSCREEN_Z, DEFAULT_HEADER_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { showInfoPlaque, showCancelPlaque } from './InfoPlaque';
import RouteMiniMap from './RouteMiniMap';
import { StarButton } from './StarButton';
import { RouteExportSnapshot } from './RouteExportSnapshot';
import { sanitizeFilename, computeRouteAggregates, exportRoutePDF, downloadJSON, copyRouteLink } from '../utils/routeExport';
import { deriveTransportRow } from '../utils/transportRow';
import { PREVIEW_CONTROL_ICON_SIZES } from './previewControlIconSizes';
import { useUiScale } from '../utils/uiScale';
import { useTranslation } from '../i18n/LanguageContext';
import { hourWord, minuteWord, paxWord } from '../i18n/plurals';
import { ONIT_BOTTOMBAR_HEIGHT } from '../onit/onitLayout';
import { displayedWorkTime } from '../utils/workHours';

interface PreviewProps {
  route: RouteCard;
  guestRoutes: GuestRoute[];
  isLoggedIn: boolean;
  onClose: () => void;
  onRouteDeleted: (routeId: number) => void;
  onRouteUpdated: () => void;
  onAdapt: (detail: RouteDetail, mode: 'adapt' | 'personalize') => void;
  // true - кнопки "Адаптировать"/"Персонализировать" скрыты (доступны, только когда "Просмотр" единственный слой)
  hideAdaptButtons: boolean;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // true - слой закрыт и ждёт окна отмены, остаётся смонтированным
  suspended?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onHeaderHeight?: (px: number) => void;
  onSearchByCreator: (username: string) => void;
  onCancelSearchByCreator: () => void;
  // прыжок корзины: App.tsx прячет слой на время окна отмены
  onDeleteBounced: () => void;
  // "Отменить удаление маршрута" нажали - App.tsx возвращает слой обратно
  onDeleteCanceled: () => void;
  mode?: 'desktop' | 'onit-view';
  onWalk?: () => void;
}

const getIconForType = (icon: string) => {
  switch (icon) {
    case 'home':
      return <HouseFillIcon color="#000000" size={19} />;
    case 'start':
      return <PlayFillIcon color="#000000" size={14} />;
    case 'finish':
      return <FlagFillIcon color="#000000" size={14} />;
    case 'metro':
      return <TramFillIcon color="#4B5563" size={20} />;
    case 'bus':
      return <BusFillIcon color="#4B5563" size={16} />;
    case 'tram':
      return <LightrailFillIcon color="#4B5563" size={20} />;
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
    case 'restaurant':
      return <ForkKnifeIcon color="#000000" size={18} />;
    default:
      return null;
  }
};

// Время показывается по Москве, а не по поясу браузера
const MOSCOW_TZ = 'Europe/Moscow';

const formatDateOnly = (iso: string | null, language: 'ru' | 'en') => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: MOSCOW_TZ });
};

const formatDateTime = (iso: string | null, language: 'ru' | 'en') => {
  if (!iso) return '—';
  const d = new Date(iso);
  const locale = language === 'en' ? 'en-GB' : 'ru-RU';
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: MOSCOW_TZ });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MOSCOW_TZ });
  const cleanedDate = language === 'ru' ? date.replace(/\.$/, '') : date;
  return language === 'ru' ? `${cleanedDate} ${time}` : `${date}, ${time}`;
};

const formatDuration = (startTime: string, endTime: string, language: 'ru' | 'en') => {
  if (!startTime || !endTime) return '--:--';
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
  if (totalMinutes < 0) totalMinutes += 1440;
  if (totalMinutes < 60) return `${totalMinutes} ${minuteWord(totalMinutes, language)}`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours} ${hourWord(hours, language)}`;
  return `${hours} ${hourWord(hours, language)} ${mins} ${minuteWord(mins, language)}`;
};

const InfoDot = ({ text }: { text: string }) => {
  const [show, setShow] = useState(false);
  const { wrapRef, arrowOffset } = useTooltipEdgeOffset(show);
  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
      >
        <InfoCircleIcon size={20} />
      </button>
      {show && (
        <div
          ref={wrapRef}
          className="pp-tooltip-wrap absolute bottom-full mb-2 left-1/2 z-20 w-56"
          style={{ transform: `translateX(calc(-50% + ${arrowOffset}px))` }}
        >
          <div className="pp-tooltip whitespace-normal">
            {text}
          </div>
          <div
            className="pp-tooltip-arrow pp-tooltip-arrow--bottom"
            style={{ left: `calc(50% - ${arrowOffset}px)` }}
          />
        </div>
      )}
    </div>
  );
};

const Preview = ({ route, guestRoutes, isLoggedIn, onClose, onRouteDeleted, onRouteUpdated, onAdapt, hideAdaptButtons, zIndex, offsetX, offsetY, isTop, depth, isFullscreen, onToggleFullscreen, onHeaderHeight, suspended, onDirtyChange, onSearchByCreator, onCancelSearchByCreator, onDeleteBounced, onDeleteCanceled, mode, onWalk }: PreviewProps) => {
  const { t, language } = useTranslation();
  // Размеры в px умножаются на масштаб интерфейса
  const uiScale = useUiScale();
  const [isVisible, setIsVisible] = useState(false);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);

  const guestMatch = guestRoutes.find(g => g.card.id === route.id);
  const isGuestPreview = !!guestMatch;

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isGuestPreview && guestMatch) {
      const p = guestMatch.payload;
      const nowIso = new Date().toISOString();
      setDetail({
        id: route.id,
        public_id: p.public_id,
        title: p.title,
        description: p.description,
        cover_image: p.cover_image,
        is_owner: true,
        is_public: false,
        is_recommended: false,
        display_mode: 'full',
        creator_username: null,
        people_count: p.people_count,
        stars_count: null,
        is_favorite: false,
        total_cost: p.total_cost,
        total_duration: p.total_duration,
        cost_excludes_transport: false,
        created_at: nowIso,
        updated_at: nowIso,
        start_point: p.start_point,
        end_point: p.end_point,
        date: p.date,
        start_time: p.start_time,
        end_time: p.end_time,
        route_data: p.route_data,
        transport_options: p.transport_options ?? null,
      });
      return;
    }
    api.getRouteDetail(route.id).then(result => {
      if ('error' in result) {
        setLoadError(true);
      } else {
        setDetail(result);
      }
    }).catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id]);

  const [accessLevel, setAccessLevel] = useState<'private' | 'public'>('private');
  const [displayMode, setDisplayMode] = useState<'full' | 'points_only'>('full');
  const originalAccessLevel = useRef<'private' | 'public'>('private');
  const originalDisplayMode = useRef<'full' | 'points_only'>('full');
  const [saving, setSaving] = useState(false);

  const [starsCount, setStarsCount] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [starPending, setStarPending] = useState(false);
  const [starJustActivated, setStarJustActivated] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const access = detail.is_public ? 'public' : 'private';
    setAccessLevel(access);
    setDisplayMode(detail.display_mode);
    originalAccessLevel.current = access;
    originalDisplayMode.current = detail.display_mode;
    setStarsCount(detail.stars_count ?? 0);
    setIsFavorite(detail.is_favorite);
  }, [detail]);

  const handleStarToggle = async () => {
    if (!detail || isGuestPreview || starPending) return;
    if (!isLoggedIn) {
      showInfoPlaque(t('Войдите в аккаунт, чтобы добавлять маршруты в избранное'), 'info');
      return;
    }
    if (detail.is_owner) {
      showInfoPlaque(t('Вы не можете добавлять в избранное созданные Вами маршруты'), 'info');
      return;
    }
    setStarPending(true);
    const result = await api.toggleRouteStar(route.id).catch(() => null);
    setStarPending(false);
    if (!result || !('success' in result)) return;
    setIsFavorite(result.is_favorite);
    setStarsCount(result.stars_count);
    if (result.is_favorite) {
      setStarJustActivated(true);
      setTimeout(() => setStarJustActivated(false), 1000);
    }
  };

  const hasChanges = !!detail && (
    accessLevel !== originalAccessLevel.current || displayMode !== originalDisplayMode.current
  );

  useEffect(() => {
    onDirtyChange?.(hasChanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges]);

  // Удаление: плашка разворачивается, подтверждение - ведением курсора по каналу
  const [trashHovered, setTrashHovered] = useState(false);
  const [slideProgress, setSlideProgress] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const plaqueRef = useRef<HTMLDivElement>(null);
  const deleteTriggeredRef = useRef(false);
  // Удаление на бэкенде откладывается на время окна отмены
  const deleteUndoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Момент начала морф-анимации (до её конца курсор иконку не двигает)
  const hoverStartRef = useRef(0);
  // Точка входа курсора в плашку (проверка направления ведения)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [exportHovered, setExportHovered] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const controlsRowWidth = useMeasuredWidth(controlsRowRef);
  const exportSnapshotRef = useRef<HTMLDivElement>(null);

  const [searchTooltipHover, setSearchTooltipHover] = useState(false);
  const { wrapRef: searchTooltipRef, arrowOffset: searchTooltipOffset } = useTooltipEdgeOffset(searchTooltipHover);
  // true - RouteBar в разделе поиска, открытом этим окном
  const [searchByLoginActive, setSearchByLoginActive] = useState(false);
  const [recommendedTooltipHover, setRecommendedTooltipHover] = useState(false);
  const { wrapRef: recommendedTooltipRef, arrowOffset: recommendedTooltipOffset } = useTooltipEdgeOffset(recommendedTooltipHover);
  const [privateEyeTooltipHover, setPrivateEyeTooltipHover] = useState(false);
  const { wrapRef: privateEyeTooltipRef, arrowOffset: privateEyeTooltipOffset } = useTooltipEdgeOffset(privateEyeTooltipHover);

  const controlIconPx = (size: number) => size * uiScale;
  const DELETE_ICON_REST_SIZE = controlIconPx(PREVIEW_CONTROL_ICON_SIZES.deleteRest);
  const DELETE_HITBOX = 32 * uiScale;
  const EXPORT_HITBOX = 32 * uiScale;
  const CONTROLS_GAP = 72 * uiScale;
  const PILL_ICON_SIZE = 40 * uiScale;
  const PILL_EDGE_GAP = 8 * uiScale;
  const MORPH_DURATION_MS = 450;
  const MORPH_EASE = 'cubic-bezier(0.34, 1.35, 0.64, 1)';
  const PLAQUE_RADIUS = 16 * uiScale;
  const PLAQUE_SHADOW = '0 10px 40px -8px rgba(15, 23, 42, 0.28), 0 2px 8px -2px rgba(15, 23, 42, 0.12)';
  const MIDDLE_COL_WIDTH = 32 * uiScale;
  const outerTrackWidth = Math.max(0, (controlsRowWidth - MIDDLE_COL_WIDTH - CONTROLS_GAP * 2) / 2);
  const deleteRestGap = Math.max(0, outerTrackWidth - DELETE_HITBOX);
  const cursorReachOffset = Math.max(0, deleteRestGap - PILL_EDGE_GAP + DELETE_HITBOX / 2 - PILL_ICON_SIZE / 2);
  // Положение в покое задаётся процентами от ширины ряда и следует за вёрсткой без замеров
  const exportRestInset = `calc(50% - ${EXPORT_HITBOX / 2}px)`;
  const deleteRestInset = `calc((100% - ${MIDDLE_COL_WIDTH + CONTROLS_GAP * 2}px) / 2 - ${DELETE_HITBOX}px)`;
  // Максимальный первый шаг прогресса по каналу
  const MAX_DRAG_PROGRESS_JUMP = 0.15;
  // Максимальное вертикальное отклонение ведения курсора
  const MAX_DRAG_VERTICAL_RATIO = 0.6;
  const DRAG_VERTICAL_SLACK = 12;

  // Актуальное состояние для слежения за курсором на уровне документа
  const dragStateRef = useRef({ slideProgress, controlsRowWidth, cursorReachOffset });
  dragStateRef.current = { slideProgress, controlsRowWidth, cursorReachOffset };

  useEffect(() => {
    if (!trashHovered) return;

    const handleWindowMove = (e: MouseEvent) => {
      if (deleteTriggeredRef.current) return;

      // Запас вокруг строки для определения ухода курсора
      const leaveMargin = Math.max(40, dragStateRef.current.cursorReachOffset + 24);
      const rowRect = controlsRowRef.current?.getBoundingClientRect();
      if (rowRect && !(
        e.clientX >= rowRect.left - leaveMargin && e.clientX <= rowRect.right + leaveMargin &&
        e.clientY >= rowRect.top - leaveMargin && e.clientY <= rowRect.bottom + leaveMargin
      )) {
        setTrashHovered(false);
        setSlideProgress(0);
        return;
      }

      if (!plaqueRef.current) return;
      if (performance.now() - hoverStartRef.current < MORPH_DURATION_MS) return;

      let dx = 0;
      if (dragStartRef.current) {
        dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        if (Math.abs(dy) > Math.abs(dx) * MAX_DRAG_VERTICAL_RATIO + DRAG_VERTICAL_SLACK) return;
      }

      const { slideProgress: currentProgress, controlsRowWidth: currentRowWidth, cursorReachOffset: currentReachOffset } = dragStateRef.current;

      const rect = plaqueRef.current.getBoundingClientRect();
      const usable = Math.max(1, currentRowWidth - PILL_EDGE_GAP * 2 - PILL_ICON_SIZE);
      const relX = e.clientX - rect.left - PILL_EDGE_GAP - PILL_ICON_SIZE / 2 + currentReachOffset;
      const progress = 1 - Math.min(1, Math.max(0, relX / usable));

      // Ограничение скорости, пока движение не началось
      if (currentProgress === 0 && Math.abs(dx) > MAX_DRAG_PROGRESS_JUMP * usable) return;

      if (progress >= 0.999) {
        // Границы совпали: фиксируем позицию и запускаем удаление
        setSlideProgress(1);
        deleteTriggeredRef.current = true;
        setDeleting(true);
        // Даём bounce-анимации доиграть до скрытия окна
        setTimeout(() => {
          onDeleteBounced();
          startDeleteUndo();
        }, 700);
        return;
      }
      setSlideProgress(progress);
    };

    // Курсор покинул окно браузера
    const handleDocumentLeave = () => {
      if (deleteTriggeredRef.current) return;
      setTrashHovered(false);
      setSlideProgress(0);
    };

    window.addEventListener('mousemove', handleWindowMove);
    document.addEventListener('mouseleave', handleDocumentLeave);
    return () => {
      window.removeEventListener('mousemove', handleWindowMove);
      document.removeEventListener('mouseleave', handleDocumentLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashHovered]);

  const [expandedRow, setExpandedRow] = useState<string | number | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRowMouseEnter = (id: string | number) => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    if (expandedRow === id) return;
    expandTimerRef.current = setTimeout(() => setExpandedRow(id), 800);
  };

  const handleRowMouseLeave = (id: string | number, e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest && related.closest(`[data-row-id="${id}"]`)) return;
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    setExpandedRow(null);
  };

  const handleDelete = async () => {
    if (isGuestPreview) return; // гостевые маршруты тут не редактируются - см. ниже
    const result = await api.deleteRoute(route.id).catch(() => null);
    if (!result || !('success' in result)) return;
    onRouteDeleted(route.id);
    onClose();
    // Плашка об удалении встаёт в очередь после плашки отмены
    setTimeout(() => showInfoPlaque(t('Маршрут удален'), 'success'), 300);
  };

  // Плашка "Отмена действия" на 5 с перед удалением
  const startDeleteUndo = () => {
    showCancelPlaque(t('Отменить удаление маршрута'), () => {
      if (deleteUndoTimeoutRef.current) clearTimeout(deleteUndoTimeoutRef.current);
      deleteUndoTimeoutRef.current = null;
      deleteTriggeredRef.current = false;
      setDeleting(false);
      setSlideProgress(0);
      setTrashHovered(false);
      onDeleteCanceled();
      showInfoPlaque(t('Маршрут восстановлен'), 'info');
    });
    deleteUndoTimeoutRef.current = setTimeout(handleDelete, 5000);
  };

  const handleExportPDFClick = async () => {
    if (!detail || pdfDisabled || !exportSnapshotRef.current) return;
    await exportRoutePDF(exportSnapshotRef.current, sanitizeFilename(detail.title));
    showInfoPlaque(t('Маршрут экспортирован как PDF'), 'success');
  };

  const handleExportJSONClick = () => {
    if (!detail) return;
    const { duration, cost } = computeRouteAggregates(detail.route_data);
    const payload = {
      title: detail.title_original ?? detail.title,
      description: detail.description_original ?? detail.description,
      date: detail.date,
      people_count: detail.people_count,
      points_count: detail.route_data.filter((item: any) => item.type === 'attraction' || item.type === 'food').length,
      total_time_minutes: duration,
      total_cost: cost * detail.people_count,
      route: detail.route_data,
    };
    downloadJSON(payload, sanitizeFilename(detail.title));
    showInfoPlaque(t('Маршрут экспортирован как JSON'), 'success');
  };

  const handleExportURLClick = async () => {
    if (!detail || urlDisabled || !detail.public_id) return;
    const copied = await copyRouteLink(detail.public_id);
    if (!copied) return;
    showInfoPlaque(t('Ссылка на маршрут скопирована'), 'success');
  };

  const handleSearchByLoginClick = () => {
    if (!detail || !detail.creator_username) return;
    if (searchByLoginActive) {
      setSearchByLoginActive(false);
      onCancelSearchByCreator();
      return;
    }
    setSearchByLoginActive(true);
    onSearchByCreator(detail.creator_username);
  };

  const handleSave = async () => {
    if (isGuestPreview || !detail) return;
    setSaving(true);
    const payload: { is_public?: boolean; display_mode?: 'full' | 'points_only' } = {};
    if (!detail.is_recommended && accessLevel !== originalAccessLevel.current) {
      payload.is_public = accessLevel === 'public';
    }
    if (displayMode !== originalDisplayMode.current) {
      payload.display_mode = displayMode;
    }
    const result = await api.updateRoute(route.id, payload).catch(() => null);
    setSaving(false);
    if (!result || !('success' in result)) return;
    onRouteUpdated();
  };

  const hideTime = !!detail && !detail.is_owner && detail.display_mode === 'points_only';
  const pdfDisabled = hideTime;
  const urlDisabled = isGuestPreview;
  const showStars = !!detail && detail.stars_count !== null;
  const effectiveFullscreen = isFullscreen && isTop;
  const effectiveZIndex = effectiveFullscreen ? FULLSCREEN_Z : zIndex;

  const mobileExportButton = detail && mode === 'onit-view' && (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setExportMenuOpen(v => !v)}
        aria-label={t('Экспортировать как')}
        className="pp-plain w-10 h-10 flex items-center justify-center active:opacity-60"
      >
        <img src="/icons/exportas.png" alt="" width={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.exportRest)} height={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.exportRest)} className="pointer-events-none select-none" />
      </button>
      {exportMenuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setExportMenuOpen(false)} />
          <div
            className="absolute bottom-full left-0 mb-2 z-40 flex flex-col items-center gap-3 px-5 py-4 bg-white"
            style={{ borderRadius: PLAQUE_RADIUS, boxShadow: PLAQUE_SHADOW, width: 220 * uiScale }}
          >
            <div className="w-full flex items-center justify-between">
              <button
                type="button"
                disabled={pdfDisabled}
                onClick={() => { handleExportPDFClick(); setExportMenuOpen(false); }}
                className={`pp-plain flex flex-col items-center gap-1 ${pdfDisabled ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <DocumentIcon size={20} className="text-red-500" />
                <span className="text-xs font-medium text-gray-500">PDF</span>
              </button>
              <button
                type="button"
                disabled={urlDisabled}
                onClick={() => { handleExportURLClick(); setExportMenuOpen(false); }}
                className={`pp-plain flex flex-col items-center gap-1 ${urlDisabled ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <LinkIcon size={20} className="text-blue-500" />
                <span className="text-xs font-medium text-gray-500">URL</span>
              </button>
              <button
                type="button"
                onClick={() => { handleExportJSONClick(); setExportMenuOpen(false); }}
                className="pp-plain flex flex-col items-center gap-1"
              >
                <CurlybracesIcon size={20} className="text-yellow-600" />
                <span className="text-xs font-medium text-gray-500">JSON</span>
              </button>
            </div>
            <div className="text-sm font-medium text-gray-800">{t('Экспортировать как')}</div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0, zIndex: effectiveZIndex, pointerEvents: 'none' }}
      >
        <div
          // On It: отдельный корневой div и полноэкранный размер
          className={`pp-modal relative bg-white flex flex-col overflow-hidden ${mode === 'onit-view' ? 'pp-onit-no-select' : ''}`}
          style={mode === 'onit-view' ? {
            // On It: позиционирование окна на весь экран
            pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
            width: '100%',
            height: '100dvh',
            position: 'fixed',
            top: 0,
            left: 0,
            borderRadius: 0,
            opacity: suspended ? 0 : (isVisible ? 1 : 0),
            boxShadow: 'none',
            transition: 'opacity 0.3s ease',
          } : {
            pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
            position: 'absolute',
            top: '50%',
            left: '50%',
            opacity: suspended ? 0 : (isVisible ? 1 : 0),
            boxShadow: layerBoxShadow(depth),
            transition: `${FULLSCREEN_TRANSITION}, box-shadow 0.3s ease`,
            ...cardBoxStyle(effectiveFullscreen, offsetX, offsetY, isVisible ? 1 : 0.95),
          }}
        >
          <div
            ref={headerRef}
            className="border-b border-gray-100 flex-shrink-0 relative"
            style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: mode === 'onit-view' ? 'env(safe-area-inset-top)' : undefined }}
            onMouseMove={(e) => {
              if (mode === 'onit-view') return;
              const rect = e.currentTarget.getBoundingClientRect();
              setShowTrafficLight(e.clientX - rect.left <= trafficLightZone(24, titleWidth));
            }}
            onMouseLeave={() => { if (mode !== 'onit-view') setShowTrafficLight(false); }}
          >
            {mode === 'onit-view' ? (
              // On It: постоянная кнопка "Назад" вместо светофора
              <div className="absolute inset-0 flex items-center gap-3 pl-3 pr-6">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('Закрыть')}
                  className="pp-plain w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
                >
                  <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
                </button>
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Просмотр')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{t('Просмотр')}</h2>
            </div>
            <div
              className="absolute inset-0 flex items-center pl-6 transition-opacity duration-150"
              style={{
                opacity: showTrafficLight ? 1 : 0,
                transitionDelay: showTrafficLight ? '150ms' : '0ms',
                pointerEvents: showTrafficLight ? 'auto' : 'none',
              }}
            >
              <TrafficLight
                onClose={onClose}
                fullscreenAvailable
                isFullscreen={effectiveFullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            </div>
              </>
            )}
          </div>

          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              {loadError ? t('Не удалось загрузить маршрут') : t('Загрузка...')}
            </div>
          ) : (
            <>
              <div className={`flex-1 overflow-hidden flex flex-col min-h-0 ${mode === 'onit-view' ? 'px-3 py-6' : 'p-6'}`}>
                <div className="flex items-center justify-between mb-1 flex-shrink-0">
                  <h3 className="text-lg font-semibold text-gray-800 truncate pr-3">{detail.title}</h3>
                  {!isGuestPreview && (
                    <span className="text-sm text-gray-500 flex-shrink-0">@{detail.id}</span>
                  )}
                </div>
                {mode === 'onit-view' ? (
                  <div className="mb-4 flex-shrink-0 text-sm text-gray-500">
                    <span className="truncate">
                      <span className="text-gray-400">{t('Дата изменения: ')}</span>
                      {formatDateTime(detail.updated_at, language)}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 items-center gap-3 mb-4 flex-shrink-0 text-sm text-gray-500">
                    <span className="text-left truncate">
                      {detail.is_recommended ? t('Маршрут создал(-а): Администратор') : `${t('Маршрут создал(-а): ')}${detail.creator_username ?? t('Вы')}`}
                    </span>
                    <span className="text-center truncate">
                      {effectiveFullscreen && <span className="text-gray-400">{t('Дата создания: ')}</span>}
                      {formatDateOnly(detail.created_at, language)}
                    </span>
                    <span className="text-right truncate">
                      {effectiveFullscreen && <span className="text-gray-400">{t('Дата изменения: ')}</span>}
                      {formatDateTime(detail.updated_at, language)}
                    </span>
                  </div>
                )}

                <div className={`flex-1 flex gap-6 min-h-0 ${mode === 'onit-view' ? 'flex-col overflow-y-auto' : ''}`}>
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className={mode === 'onit-view' ? 'overflow-y-auto' : 'flex-1 overflow-y-auto'}>
                      <table className="w-full">
                        <tbody>
                          {detail.route_data.map((item: any) => {
                            const isStart = item.type === 'start';
                            const isEnd = item.type === 'end';
                            const isTransport = item.type === 'transport';
                            const isAttraction = item.type === 'attraction';
                            const isFood = item.type === 'food';
                            const isExpanded = expandedRow === item.id;

                            // Замороженные строки транспорта и сырой travelMode
                            const transportDisplay = isTransport && item.rawTravelMode
                              ? deriveTransportRow(
                                  t, language, item.rawTravelMode, item.fromPlace, item.toPlace, item.cost,
                                  item.fromAddressOverride, item.toAddressOverride,
                                )
                              : null;
                            // Старт и Финиш с адресом (сырая метка адреса)
                            const legacyAddressMatch = (isStart || isEnd) && item.rawAddressLabel == null && typeof item.name === 'string'
                              ? item.name.match(/\(([^)]*)\)\s*$/)
                              : null;
                            const startEndMain = isStart || isEnd ? t(isStart ? 'Старт' : 'Финиш') : null;
                            const startEndParenthetical = isStart || isEnd
                              ? item.rawAddressLabel != null
                                ? t(item.rawAddressLabel)
                                : legacyAddressMatch
                                  ? legacyAddressMatch[1]
                                  : null
                              : null;
                            const startEndLabel = startEndMain != null && startEndParenthetical != null
                              ? `${startEndMain} (${startEndParenthetical})`
                              : null;
                            const displayName = transportDisplay?.transportMode ?? startEndLabel ?? item.name;
                            const displayDescription = transportDisplay?.description ?? item.description;
                            const displayCompoundParts = transportDisplay?.compoundParts ?? item.compoundParts;

                            let visitDurationLabel = '';
                            if ((isAttraction || isFood) && item.time && item.endTime && item.endTime !== '-') {
                              const [vh, vm] = item.time.split(':').map(Number);
                              const [eh, em] = item.endTime.split(':').map(Number);
                              let diff = (eh * 60 + em) - (vh * 60 + vm);
                              if (diff < 0) diff += 1440;
                              visitDurationLabel = `${diff} ${t('мин')}`;
                            }

                            // Такси считается на машину, а не на человека
                            const totalCostForItem = Math.round(item.cost * detail.people_count);
                            const expandedCostLabel = item.cost > 0
                              ? `${item.costApproximate ? '~' : ''}${totalCostForItem}₽`
                              : '';
                            const taxiCarCount = Math.max(1, Math.ceil(detail.people_count / 4));
                            const collapsedCostLabel = item.cost <= 0 ? '' : item.costApproximate
                              ? (taxiCarCount > 1
                                  ? `~${Math.round(totalCostForItem / taxiCarCount)}₽ x ${taxiCarCount}`
                                  : `~${totalCostForItem}₽`)
                              : `${Math.round(item.cost)}₽ × ${detail.people_count}`;
                            const transportDurationLabel = isTransport && item.travelTime != null ? `${item.travelTime} ${t('мин')}` : '';

                            let textColor = 'text-gray-800';
                            if (isAttraction) textColor = 'text-blue-500';
                            else if (isTransport) textColor = 'text-gray-500';

                            return (
                              <React.Fragment key={item.id}>
                                <tr
                                  data-row-id={item.id}
                                  className={`group transition-all duration-300 hover:bg-gray-50/50 cursor-default ${isExpanded ? 'bg-gray-50/50' : ''}`}
                                  onMouseEnter={() => handleRowMouseEnter(item.id)}
                                  onMouseLeave={(e) => handleRowMouseLeave(item.id, e)}
                                >
                                  <td className="py-2 pr-3 w-8 text-gray-600 align-top">
                                    <div className="w-5 h-5 flex items-center justify-center">
                                      {getIconForType(item.icon)}
                                    </div>
                                  </td>
                                  <td className={`py-2 pr-3 text-sm ${textColor} align-top`}>
                                    {isTransport && displayCompoundParts ? (
                                      <div className="flex flex-col">
                                        <div>{displayName}</div>
                                        {displayCompoundParts.map((part: string, partIdx: number) => {
                                          const partLabel = mode === 'onit-view' ? part.replace(/\s*\([^)]*\)\s*$/, '') : part;
                                          return (
                                            <div key={partIdx} className="text-gray-400 text-xs">
                                              {partIdx === 0 ? partLabel : `→ ${partLabel}`}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <>
                                        {mode === 'onit-view' && (isStart || isEnd) && startEndParenthetical ? (
                                          <div className="flex flex-col">
                                            <div>{startEndMain}</div>
                                            <div>({startEndParenthetical})</div>
                                          </div>
                                        ) : (
                                          displayName
                                        )}
                                        {isTransport && displayDescription && mode !== 'onit-view' && (
                                          <span className="text-gray-400 text-xs ml-1">{displayDescription}</span>
                                        )}
                                      </>
                                    )}
                                  </td>
                                  {!hideTime && (
                                    <td className="py-2 pr-3 text-sm text-gray-800 whitespace-nowrap align-top">
                                      {isStart ? (
                                        <>
                                          <div className="text-gray-600">{t('Старт: ')}{item.time}</div>
                                          <div className="text-xs invisible">&nbsp;</div>
                                        </>
                                      ) : isEnd ? (
                                        <>
                                          <div className="text-gray-600">{t('Финиш: ')}{item.time}</div>
                                          {item.endTime && item.endTime !== '-' && item.endTime !== '--:--' && (
                                            <div className="text-xs text-gray-400">→ {item.endTime}</div>
                                          )}
                                        </>
                                      ) : isTransport ? (
                                        <>
                                          <div className="text-gray-500">{item.time}</div>
                                          <div className="text-xs text-gray-400">→ {item.endTime}</div>
                                        </>
                                      ) : (
                                        <>
                                          <div>{item.time}</div>
                                          {item.endTime && item.endTime !== '-' && (
                                            <div className="text-xs text-gray-400">{t('до ')}{item.endTime}</div>
                                          )}
                                        </>
                                      )}
                                    </td>
                                  )}
                                  <td className="py-2 text-sm text-gray-800 whitespace-nowrap align-top">
                                    {collapsedCostLabel && <span>{collapsedCostLabel}</span>}
                                  </td>
                                </tr>
                                {(isAttraction || isFood || isTransport) && (() => {
                                  const expandStyle = {
                                    transition: 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-in-out',
                                    maxHeight: isExpanded ? '2.75rem' : '0px',
                                    minHeight: isExpanded ? '2.75rem' : '0px',
                                    opacity: isExpanded ? 1 : 0,
                                  };
                                  return (
                                    <tr
                                      data-row-id={item.id}
                                      onMouseEnter={() => handleRowMouseEnter(item.id)}
                                      onMouseLeave={(e) => handleRowMouseLeave(item.id, e)}
                                    >
                                      <td className="p-0">
                                        <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>&nbsp;</div>
                                      </td>
                                      <td className="p-0">
                                        <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                                          {isTransport ? (
                                            <div className="pr-3 pb-2">
                                              <TransportTimeline item={item} />
                                            </div>
                                          ) : (
                                            <div className="pr-3 pb-2 text-sm">
                                              <div className="text-gray-600">{t('Адрес: ')}{item.address || t('не указан')}</div>
                                              {displayedWorkTime(item) && displayedWorkTime(item) !== '-' && (
                                                <div className="text-gray-500 text-xs mt-0.5">{t('Время работы: ')}{displayedWorkTime(item)}</div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                      {!hideTime && (
                                        <td className="p-0">
                                          <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                                            <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">
                                              {isTransport ? transportDurationLabel : visitDurationLabel}
                                            </div>
                                          </div>
                                        </td>
                                      )}
                                      <td className="p-0">
                                        <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                                          <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">
                                            {expandedCostLabel}
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })()}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {!hideTime && (
                      mode === 'onit-view' ? (
                        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-1 flex-shrink-0">
                          <div className="grid grid-cols-2 gap-4">
                            <span className="text-xs text-gray-400 whitespace-nowrap">{t('Общее время:')}</span>
                            <span className="text-xs text-gray-400 whitespace-nowrap text-right">{t('Общая стоимость:')}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <span className="text-sm font-medium text-gray-800 whitespace-nowrap">
                              {formatDuration(detail.route_data[0]?.time || '--:--', detail.route_data[detail.route_data.length - 1]?.time || '--:--', language)}
                            </span>
                            <span className="text-sm font-medium text-gray-800 whitespace-nowrap text-right">
                              {detail.is_owner
                                ? `${Math.round((detail.total_cost ?? 0) * detail.people_count)} ₽`
                                : `${detail.total_cost ?? 0} ₽ × ${detail.people_count} ${paxWord(detail.people_count, language)}`}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 pt-3 border-t border-gray-100 flex gap-8 flex-shrink-0">
                          <div>
                            <span className="text-xs text-gray-400">{t('Общее время:')}</span>
                            <span className="ml-2 text-sm font-medium text-gray-800">
                              {formatDuration(detail.route_data[0]?.time || '--:--', detail.route_data[detail.route_data.length - 1]?.time || '--:--', language)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400">{t('Общая стоимость:')}</span>
                            <span className="text-sm font-medium text-gray-800">
                              {detail.is_owner
                                ? `${Math.round((detail.total_cost ?? 0) * detail.people_count)} ₽`
                                : `${detail.total_cost ?? 0} ₽ × ${detail.people_count} ${paxWord(detail.people_count, language)}`}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                    {hideTime && (
                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-gray-400">{t('Общая стоимость:')}</span>
                        <span className="text-sm font-medium text-gray-800">
                          {detail.is_owner
                            ? `${Math.round((detail.total_cost ?? 0) * detail.people_count)} ₽`
                            : `${detail.total_cost ?? 0} ₽ × ${detail.people_count} ${paxWord(detail.people_count, language)}`}
                        </span>
                        {detail.cost_excludes_transport && <InfoDot text={t('Без учета транспорта')} />}
                      </div>
                    )}
                  </div>

                  {mode !== 'onit-view' && (
                  <div
                    className={`flex flex-col gap-3 flex-shrink-0 transition-[width] duration-500 ease-in-out ${effectiveFullscreen ? 'w-[32.5rem]' : 'w-80'}`}
                  >
                    <RouteMiniMap routeData={detail.route_data} />

                    <div className="flex flex-col gap-3 flex-shrink-0">
                      <div ref={controlsRowRef} className="relative h-24 flex-shrink-0">
                        <div className="h-full flex flex-col">
                          <div className="h-8 grid items-center relative" style={{ gridTemplateColumns: `1fr ${MIDDLE_COL_WIDTH}px 1fr`, columnGap: CONTROLS_GAP }}>
                            <div className="justify-self-end">
                              {detail.is_recommended ? (
                                <div
                                  className="relative flex-shrink-0 w-8 h-8 flex items-center justify-center"
                                  onMouseEnter={() => setRecommendedTooltipHover(true)}
                                  onMouseLeave={() => setRecommendedTooltipHover(false)}
                                >
                                  <img src="/icons/recommended.png" alt="" width={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.recommended)} height={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.recommended)} className="pointer-events-none select-none" />
                                  {recommendedTooltipHover && (
                                    <div
                                      ref={recommendedTooltipRef}
                                      className="pp-tooltip-wrap absolute bottom-full mb-2 left-0 z-20 w-36"
                                      style={{ transform: `translateX(${recommendedTooltipOffset}px)` }}
                                    >
                                      <div className="pp-tooltip whitespace-normal text-center">
                                        {t('Рекомендованные')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : !detail.is_public ? (
                                <div
                                  className="relative flex-shrink-0 w-8 h-8 flex items-center justify-center"
                                  onMouseEnter={() => setPrivateEyeTooltipHover(true)}
                                  onMouseLeave={() => setPrivateEyeTooltipHover(false)}
                                >
                                  <span
                                    className="inline-block pointer-events-none"
                                    style={{
                                      width: controlIconPx(PREVIEW_CONTROL_ICON_SIZES.privateEye),
                                      height: controlIconPx(PREVIEW_CONTROL_ICON_SIZES.privateEye),
                                      backgroundColor: '#007AFF',
                                      WebkitMaskImage: 'url(/icons/closedeye.png)',
                                      maskImage: 'url(/icons/closedeye.png)',
                                      WebkitMaskSize: 'contain',
                                      maskSize: 'contain',
                                      WebkitMaskRepeat: 'no-repeat',
                                      maskRepeat: 'no-repeat',
                                      WebkitMaskPosition: 'center',
                                      maskPosition: 'center',
                                    }}
                                  />
                                  {privateEyeTooltipHover && (
                                    <div
                                      ref={privateEyeTooltipRef}
                                      className="pp-tooltip-wrap absolute bottom-full mb-2 left-0 z-20 w-28"
                                      style={{ transform: `translateX(${privateEyeTooltipOffset}px)` }}
                                    >
                                      <div className="pp-tooltip whitespace-normal text-center">
                                        {t('Приватный')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : showStars ? (
                                <StarButton
                                  starsCount={starsCount}
                                  isFavorite={isFavorite}
                                  disabled={starPending}
                                  interactive={isLoggedIn && !detail.is_owner}
                                  onToggle={handleStarToggle}
                                  hoverEffect={false}
                                  idleColorClassName="text-gray-500"
                                  countClassName="text-base font-semibold text-gray-700"
                                  size={PREVIEW_CONTROL_ICON_SIZES.star}
                                  justActivated={starJustActivated}
                                />
                              ) : null}
                            </div>
                            <div className="justify-self-center w-8 h-8" />
                            <div className="justify-self-start">
                              {!isGuestPreview && detail.is_owner && (
                                <div className="w-8 h-8" />
                              )}
                              {!isGuestPreview && !detail.is_owner && !detail.is_recommended && (
                                <div className="relative flex-shrink-0">
                                  <button
                                    type="button"
                                    onMouseEnter={() => setSearchTooltipHover(true)}
                                    onMouseLeave={() => setSearchTooltipHover(false)}
                                    onClick={handleSearchByLoginClick}
                                    className="pp-plain w-8 h-8 flex items-center justify-center"
                                  >
                                    <span
                                      className="inline-block flex-shrink-0"
                                      style={{
                                        width: controlIconPx(PREVIEW_CONTROL_ICON_SIZES.loginSearch),
                                        height: controlIconPx(PREVIEW_CONTROL_ICON_SIZES.loginSearch),
                                        backgroundColor: '#3B82F6',
                                        WebkitMaskImage: 'url(/icons/loginsearch.png)',
                                        maskImage: 'url(/icons/loginsearch.png)',
                                        WebkitMaskSize: 'contain',
                                        maskSize: 'contain',
                                        WebkitMaskRepeat: 'no-repeat',
                                        maskRepeat: 'no-repeat',
                                        WebkitMaskPosition: 'center',
                                        maskPosition: 'center',
                                        // Иконка остаётся увеличенной, пока поиск активен
                                        transform: searchByLoginActive ? 'scale(1.15)' : (searchTooltipHover ? 'scale(1.05)' : 'scale(1)'),
                                        transition: 'transform 0.2s ease',
                                      }}
                                    />
                                  </button>
                                  {searchTooltipHover && (
                                    <div
                                      ref={searchTooltipRef}
                                      className="pp-tooltip-wrap absolute bottom-full mb-2 right-0 z-20 w-40"
                                      style={{ transform: `translateX(${searchTooltipOffset}px)` }}
                                    >
                                      <div className="pp-tooltip whitespace-normal text-center">
                                        {t('Маршруты пользователя')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Разделитель между центральной и правой иконками */}
                            {!isGuestPreview && (detail.is_owner || !detail.is_recommended) && (
                              <div
                                className="absolute rounded-full bg-gray-300"
                                style={{
                                  left: `calc(50% + ${MIDDLE_COL_WIDTH / 2}px + ${CONTROLS_GAP / 2}px)`,
                                  top: '50%',
                                  width: 1,
                                  height: 16 * uiScale,
                                  transform: 'translate(-50%, -50%)',
                                  opacity: (exportHovered || searchByLoginActive || (detail.is_owner ? trashHovered : searchTooltipHover)) ? 0 : 1,
                                  transition: 'opacity 0.2s ease',
                                }}
                              />
                            )}
                          </div>

                          <div className="h-2 grid items-center flex-shrink-0 mt-1.5" style={{ gridTemplateColumns: `1fr ${MIDDLE_COL_WIDTH}px 1fr`, columnGap: CONTROLS_GAP }}>
                            <div />
                            <div className="justify-self-center h-2 flex items-center justify-center">
                              <div
                                className="w-1 h-1 rounded-full flex-shrink-0"
                                style={{
                                  backgroundColor: '#111827',
                                  opacity: (exportHovered || searchByLoginActive) ? 0 : 1,
                                  transition: 'opacity 0.2s ease',
                                }}
                              />
                            </div>
                            <div className="justify-self-start w-8 h-2 flex items-center justify-center">
                              {!isGuestPreview && (detail.is_owner || !detail.is_recommended) && (
                                <div
                                  className="w-1 h-1 rounded-full flex-shrink-0"
                                  style={{
                                    backgroundColor: detail.is_owner ? '#EF4444' : '#3B82F6',
                                    opacity: searchByLoginActive
                                      ? 1
                                      : (detail.is_owner ? trashHovered : searchTooltipHover) ? 0 : 1,
                                    transition: 'opacity 0.2s ease',
                                  }}
                                />
                              )}
                            </div>
                          </div>

                          <div className="h-8 flex items-center justify-between mt-auto">
                            {detail.is_owner && !isGuestPreview && !detail.is_recommended && (
                              <>
                                <span className="text-sm text-gray-700">{t('Доступ:')}</span>
                                <select
                                  value={accessLevel}
                                  onChange={(e) => setAccessLevel(e.target.value as 'private' | 'public')}
                                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="private">{t('Приватный')}</option>
                                  <option value="public" disabled={!isLoggedIn}>{t('Открытый')}</option>
                                </select>
                              </>
                            )}
                          </div>
                        </div>

                        <div
                          onMouseEnter={() => setExportHovered(true)}
                          onMouseLeave={() => setExportHovered(false)}
                          className="absolute overflow-hidden"
                          style={{
                            top: 0,
                            zIndex: exportHovered ? 20 : 10,
                            left: exportHovered ? 0 : exportRestInset,
                            right: exportHovered ? 0 : exportRestInset,
                            height: exportHovered ? '100%' : EXPORT_HITBOX,
                            borderRadius: PLAQUE_RADIUS,
                            backgroundColor: exportHovered ? '#ffffff' : 'transparent',
                            boxShadow: exportHovered ? PLAQUE_SHADOW : 'none',
                            transition: [
                              `left 0.45s ${MORPH_EASE}`,
                              `right 0.45s ${MORPH_EASE}`,
                              `height 0.45s ${MORPH_EASE}`,
                              'background-color 0.3s ease',
                              'box-shadow 0.35s ease',
                            ].join(', '),
                          }}
                        >
                          <div
                            className="absolute inset-0 flex items-center justify-center"
                            style={{
                              opacity: exportHovered ? 0 : 1,
                              transition: exportHovered ? 'opacity 0.15s ease' : 'opacity 0.3s ease 0.2s',
                            }}
                          >
                            <img src="/icons/exportas.png" alt="" width={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.exportRest)} height={controlIconPx(PREVIEW_CONTROL_ICON_SIZES.exportRest)} className="pointer-events-none select-none" />
                          </div>
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5"
                            style={{
                              opacity: exportHovered ? 1 : 0,
                              pointerEvents: exportHovered ? 'auto' : 'none',
                              transition: exportHovered ? 'opacity 0.3s ease 0.15s' : 'opacity 0.1s ease',
                            }}
                          >
                            <div className="w-full flex items-center justify-between">
                              <button
                                type="button"
                                disabled={pdfDisabled}
                                onClick={handleExportPDFClick}
                                className={`pp-plain flex flex-col items-center gap-1 transition-transform ${pdfDisabled ? 'opacity-40 pointer-events-none' : 'hover:scale-105'}`}
                              >
                                <DocumentIcon size={20} className="text-red-500" />
                                <span className="text-xs font-medium text-gray-500">PDF</span>
                              </button>
                              <button
                                type="button"
                                disabled={urlDisabled}
                                onClick={handleExportURLClick}
                                className={`pp-plain flex flex-col items-center gap-1 transition-transform ${urlDisabled ? 'opacity-40 pointer-events-none' : 'hover:scale-105'}`}
                              >
                                <LinkIcon size={20} className="text-blue-500" />
                                <span className="text-xs font-medium text-gray-500">URL</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleExportJSONClick}
                                className="pp-plain flex flex-col items-center gap-1 transition-transform hover:scale-105"
                              >
                                <CurlybracesIcon size={20} className="text-yellow-600" />
                                <span className="text-xs font-medium text-gray-500">JSON</span>
                              </button>
                            </div>
                            <div className="text-sm font-medium text-gray-800">{t('Экспортировать как')}</div>
                          </div>
                        </div>

                        {!isGuestPreview && detail.is_owner && (
                          <div
                            ref={plaqueRef}
                            onMouseEnter={(e) => {
                              setTrashHovered(true);
                              hoverStartRef.current = performance.now();
                              dragStartRef.current = { x: e.clientX, y: e.clientY };
                            }}
                            className="absolute overflow-hidden"
                            style={{
                              top: 0,
                              // В покое плашка стоит в колонке 1fr
                              right: trashHovered ? 0 : deleteRestInset,
                              zIndex: trashHovered ? 20 : 10,
                              width: trashHovered ? '100%' : DELETE_HITBOX,
                              height: trashHovered ? '100%' : DELETE_HITBOX,
                              borderRadius: PLAQUE_RADIUS,
                              backgroundColor: trashHovered ? '#ffffff' : 'transparent',
                              boxShadow: trashHovered ? PLAQUE_SHADOW : 'none',
                              transition: [
                                `right 0.45s ${MORPH_EASE}`,
                                `width 0.45s ${MORPH_EASE}`,
                                `height 0.45s ${MORPH_EASE}`,
                                'background-color 0.3s ease',
                                'box-shadow 0.35s ease',
                              ].join(', '),
                            }}
                          >
                            <div
                              className="absolute bg-gray-200 rounded-full"
                              style={{
                                top: PILL_EDGE_GAP + PILL_ICON_SIZE / 2 - 1,
                                left: PILL_EDGE_GAP + PILL_ICON_SIZE,
                                right: PILL_EDGE_GAP + PILL_ICON_SIZE,
                                height: 2,
                                opacity: trashHovered ? 1 : 0,
                                transition: trashHovered ? 'opacity 0.3s ease 0.2s' : 'opacity 0.1s ease',
                              }}
                            />
                            <div
                              className={`absolute flex items-center justify-center text-red-500 ${deleting ? 'animate-pop-in' : ''}`}
                              style={{
                                top: PILL_EDGE_GAP,
                                right: trashHovered ? Math.max(0, controlsRowWidth - PILL_EDGE_GAP - PILL_ICON_SIZE) : 0,
                                width: PILL_ICON_SIZE,
                                height: PILL_ICON_SIZE,
                                zIndex: 2,
                                opacity: trashHovered ? 1 : 0,
                                transition: trashHovered ? 'opacity 0.3s ease 0.2s, right 0.45s ' + MORPH_EASE : 'opacity 0.1s ease',
                              }}
                            >
                              <TrashIcon size={22} />
                            </div>
                            <div
                              className="absolute flex items-center justify-center text-red-500"
                              style={{
                                top: trashHovered ? PILL_EDGE_GAP : 0,
                                right: trashHovered
                                  ? PILL_EDGE_GAP + slideProgress * Math.max(0, controlsRowWidth - PILL_EDGE_GAP * 2 - PILL_ICON_SIZE)
                                  : 0,
                                width: trashHovered ? PILL_ICON_SIZE : DELETE_HITBOX,
                                height: trashHovered ? PILL_ICON_SIZE : DELETE_HITBOX,
                                zIndex: 1,
                                opacity: deleting ? 0 : 1,
                                transition: [
                                  'opacity 0.15s ease',
                                  ...(slideProgress === 0
                                    ? [`top 0.45s ${MORPH_EASE}`, `right 0.45s ${MORPH_EASE}`, `width 0.45s ${MORPH_EASE}`, `height 0.45s ${MORPH_EASE}`]
                                    : []),
                                ].join(', '),
                              }}
                            >
                              <DeleteBackwardIcon
                                style={{
                                  width: trashHovered ? PILL_ICON_SIZE * 0.55 : DELETE_ICON_REST_SIZE,
                                  height: trashHovered ? PILL_ICON_SIZE * 0.55 : DELETE_ICON_REST_SIZE,
                                  transition: 'width 0.3s ease, height 0.3s ease',
                                }}
                              />
                            </div>
                            <div
                              className="absolute left-0 right-0 text-center text-sm font-medium text-gray-700"
                              style={{
                                top: PILL_EDGE_GAP + PILL_ICON_SIZE + 10 * uiScale,
                                opacity: trashHovered ? 1 : 0,
                                transition: trashHovered ? 'opacity 0.3s ease 0.2s' : 'opacity 0.1s ease',
                              }}
                            >
                              {t('Удалить маршрут?')}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="relative min-h-[2.5rem] flex-shrink-0">
                        {detail.is_owner && !isGuestPreview && (
                          <>
                            <div
                              className={`absolute inset-0 flex items-center justify-between gap-3 transition-opacity duration-300 ${
                                (detail.is_recommended || accessLevel === 'public') ? 'opacity-100' : 'opacity-0 pointer-events-none'
                              }`}
                            >
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
                            <div
                              className={`absolute inset-0 flex items-center px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 transition-opacity duration-300 ${
                                (!detail.is_recommended && accessLevel === 'private' && originalAccessLevel.current === 'public') ? 'opacity-100' : 'opacity-0 pointer-events-none'
                              }`}
                            >
                              {t('Маршрут потеряет все отметки Избранное')}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  )}
                </div>
              </div>

              <RouteExportSnapshot
                exportRef={exportSnapshotRef}
                title={detail.title}
                dateLabel={formatDateOnly(detail.date, language)}
                pointsCount={detail.route_data.filter((item: any) => item.type === 'attraction').length}
                durationLabel={formatDuration(
                  detail.route_data[0]?.time || '--:--',
                  detail.route_data[detail.route_data.length - 1]?.time || '--:--',
                  language
                )}
                totalCostLabel={`${computeRouteAggregates(detail.route_data).cost * detail.people_count} ₽`}
                peopleCount={detail.people_count}
                routeData={detail.route_data}
                renderIcon={(item) => getIconForType(item.icon)}
              />

              <div
                className={`border-t border-gray-100 flex-shrink-0 ${mode === 'onit-view' ? 'px-6' : 'p-6'}`}
                style={mode === 'onit-view' ? { height: ONIT_BOTTOMBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box' } : undefined}
              >
                {detail.is_owner && !isGuestPreview ? (
                  <div className={mode === 'onit-view' ? 'relative h-full' : 'relative h-10'}>
                    <div
                      className={`absolute inset-0 flex items-center justify-end transition-opacity duration-300 ${
                        hasChanges ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium disabled:opacity-60"
                      >
                        {t('Сохранить')}
                      </button>
                    </div>
                    <div
                      className={`absolute inset-0 flex items-center justify-between transition-opacity duration-300 ${
                        !hasChanges ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      {!hideAdaptButtons && (
                        <>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => onAdapt(detail, 'adapt')}
                              className="pp-btn-white px-4 py-2 rounded-xl bg-gray-100 border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
                            >
                              {t('Адаптировать')}
                            </button>
                            <InfoDot text={t('Оптимизация точек посещения')} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <InfoDot text={t('Настройка опций готового маршрута')} />
                            <button
                              onClick={() => onAdapt(detail, 'personalize')}
                              className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
                            >
                              {t('Персонализировать')}
                            </button>
                          </div>
                        </>
                      )}
                      {mode === 'onit-view' && mobileExportButton}
                      {mode === 'onit-view' && (
                        <button
                          onClick={onWalk}
                          className="ml-auto px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium"
                        >
                          {t('Пройти маршрут')}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={`relative flex items-center justify-end ${mode === 'onit-view' ? 'h-full' : 'h-10'}`}>
                    {mode === 'onit-view' && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2">{mobileExportButton}</div>
                    )}
                    {!isGuestPreview && !hideAdaptButtons && (
                      <button
                        onClick={() => onAdapt(detail, 'adapt')}
                        className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
                      >
                        {t('Адаптировать')}
                      </button>
                    )}
                    {mode === 'onit-view' && (
                      <button
                        onClick={onWalk}
                        className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium"
                      >
                        {t('Пройти маршрут')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Затемнение слоёв глубже верхнего (zIndex обязателен) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      </div>
    </>
  );
};

export default Preview;
