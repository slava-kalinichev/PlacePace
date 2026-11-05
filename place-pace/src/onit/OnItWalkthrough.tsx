// Пошаговое прохождение маршрута: карточка текущей точки, редактор времени, завершение
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type RouteCard, type RouteDetail, type WalkSessionStats, type WalkShiftConflict } from '../api/client';
import { useTranslation } from '../i18n/LanguageContext';
import {
  ChevronBackwardIcon,
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
} from '../components/sfSymbols';
import { CompositeTripIcon } from '../components/icons';
import { TransportTimeline } from '../components/TransportTimeline';
import { deriveTransportRow } from '../utils/transportRow';
import { paxWord } from '../i18n/plurals';
import { DEFAULT_HEADER_HEIGHT } from '../components/layerGeometry';
import { ONIT_BOTTOMBAR_HEIGHT, ONIT_MODAL_Z } from './onitLayout';
import OnItCompletionDialog from './OnItCompletionDialog';
import TimeEditor from './TimeEditor';
import ShiftConflictDialog, { type ShiftResolution } from './ShiftConflictDialog';
import { shiftStopTime } from './routeTimeShift';

interface OnItWalkthroughProps {
  route: RouteCard;
  // Шеврон слева возвращает на экран просмотра
  onExit: () => void;
  // "Завершить маршрут - сброс на домашний экран
  onFinish: () => void;
}

// Длительность морфа редактора времени, мс
const MORPH_MS = 420;

// Смена карточки - кросс-фейд одной карточки (уход и появление по 200 мс)
const CARD_FADE_MS = 200;  // Длительность одной «ноги» перехода, мс
const PREVIEW_FADE_MS = 120;  // Длительность затухания превью, мс

// Страховочный таймер перехода карточки (transitionend остаётся основным механизмом)
const CARD_FADE_SAFETY_MARGIN_MS = 80;  // Запас поверх CARD_FADE_MS для страховочного таймера, мс

// Конфликт, показанный поверх откаченного route_data
interface PendingShiftConflict {
  stopItemId: string | number;
  newStart: number;
  newEnd: number;
  conflicts: WalkShiftConflict[];
  maxFitEndMinutes: number | null;
  preEditRouteData: any[];
}

const OnItWalkthrough = ({ route, onExit, onFinish }: OnItWalkthroughProps) => {
  const { t, language } = useTranslation();
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);

  // Фаза смены карточки: idle, out (уход), in (появление); cardIndex - чей контент сейчас в карточке
  const [cardPhase, setCardPhase] = useState<'idle' | 'out' | 'in'>('idle');
  const [cardIndex, setCardIndex] = useState(0);
  // DOM-узел карточки (нужен для transitionend)
  const cardRef = useRef<HTMLDivElement>(null);
  // Прозрачность ряда "Начало/Окончание" при повторном монтировании
  const [rowVisible, setRowVisible] = useState(false);

  // Редактор времени: null - ряд кнопок, иначе какая кнопка его открыла
  const [editorAnchor, setEditorAnchor] = useState<'start' | 'end' | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  // Измеренная высота редактора для плавного раскрытия
  const [editorMeasuredHeight, setEditorMeasuredHeight] = useState(220);
  const editorContentRef = useRef<HTMLDivElement>(null);
  // Таймер закрывающей фазы морфа
  const editorCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Сессия прохождения: создаётся на первое "Начать"
  const [walkSession, setWalkSession] = useState<{ id: number; started_at: string } | null>(null);
  const walkSessionPromiseRef = useRef<Promise<{ id: number; started_at: string } | { error: string }> | null>(null);

  // Идёт сетевой сдвиг времени (блокирует "Далее")
  const [shiftPending, setShiftPending] = useState(false);
  const [shiftConflict, setShiftConflict] = useState<PendingShiftConflict | null>(null);

  // Статистика завершения (null - ещё не получена)
  const [finishStats, setFinishStats] = useState<WalkSessionStats | null>(null);
  const [finishError, setFinishError] = useState(false);

  useEffect(() => {
    if (editorAnchor == null) {
      setEditorVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEditorVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [editorAnchor]);

  // Измеряем высоту редактора сразу после монтирования
  useLayoutEffect(() => {
    if (editorAnchor == null || !editorContentRef.current) return;
    const measured = editorContentRef.current.scrollHeight;
    if (measured > 0) setEditorMeasuredHeight(measured);
  }, [editorAnchor]);

  // Закрытие редактора с обратным морфом
  const closeEditor = () => {
    setEditorVisible(false);
    if (editorCloseTimerRef.current != null) clearTimeout(editorCloseTimerRef.current);
    editorCloseTimerRef.current = setTimeout(() => {
      setEditorAnchor(null);
      editorCloseTimerRef.current = null;
    }, MORPH_MS);
  };

  useEffect(() => {
    return () => {
      if (editorCloseTimerRef.current != null) clearTimeout(editorCloseTimerRef.current);
    };
  }, []);

  // Смена узла закрывает редактор без коммита
  useEffect(() => {
    setEditorAnchor(null);
  }, [currentIndex]);

  useEffect(() => {
    api.getRouteDetail(route.id).then(result => {
      if ('error' in result) {
        setLoadError(true);
      } else {
        setDetail(result);
      }
    }).catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id]);

  // Переходы фаз out -> in -> idle (с страховочным таймером)
  useEffect(() => {
    if (cardPhase !== 'out' && cardPhase !== 'in') return;
    const node = cardRef.current;
    const phaseAtEffectStart = cardPhase;

    let advanced = false;
    let flipRaf1: number | null = null;
    let flipRaf2: number | null = null;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      if (phaseAtEffectStart === 'out') {
        setCardIndex(currentIndex);
        flipRaf1 = requestAnimationFrame(() => {
          flipRaf2 = requestAnimationFrame(() => setCardPhase('in'));
        });
      } else {
        setCardPhase('idle');
      }
    };

    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === node && e.propertyName === 'opacity') advance();
    };

    node?.addEventListener('transitionend', onTransitionEnd);
    const fallback = setTimeout(advance, CARD_FADE_MS + CARD_FADE_SAFETY_MARGIN_MS);
    return () => {
      node?.removeEventListener('transitionend', onTransitionEnd);
      clearTimeout(fallback);
      if (flipRaf1 != null) cancelAnimationFrame(flipRaf1);
      if (flipRaf2 != null) cancelAnimationFrame(flipRaf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPhase]);

  // Анимация появления ряда "Начало/Окончание" при переходе с неадресуемой точки
  useEffect(() => {
    if (!detail) return;
    const item = detail.route_data[cardIndex];
    const addressable = item?.type === 'attraction' || item?.type === 'food';
    if (!addressable) {
      setRowVisible(false);
      return;
    }
    const raf = requestAnimationFrame(() => setRowVisible(true));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIndex]);

  // На финише отправляем рабочую копию route_data на бэкенд и ждём статистику
  useEffect(() => {
    if (!showCompletion || finishStats) return;
    let cancelled = false;

    (async () => {
      const session = walkSession ?? await walkSessionPromiseRef.current;
      if (cancelled) return;
      if (!session || !('id' in session)) {
        setFinishError(true);
        return;
      }
      try {
        const stats = await api.finishWalkSession(session.id, detail?.route_data ?? []);
        if (cancelled) return;
        if ('error' in stats) {
          setFinishError(true);
        } else {
          setFinishError(false);
          setFinishStats(stats);
        }
      } catch {
        if (!cancelled) setFinishError(true);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompletion, finishStats]);

  if (!detail) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col">
        <ExitButton onExit={onExit} t={t} routeTitle={route.title} />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {loadError ? t('Не удалось загрузить маршрут') : t('Загрузка...')}
        </div>
      </div>
    );
  }

  const items: any[] = detail.route_data;
  const currentItem = items[currentIndex];
  const isStart = currentItem.type === 'start';
  const isEnd = currentItem.type === 'end';
  const buttonLabel = isStart ? t('Начать') : isEnd ? t('Закончить') : t('Далее');

  const goNext = () => {
    if (cardPhase !== 'idle' || editorAnchor || shiftPending) return;  // защита от повторного тапа

    // Первый переход от Старта начинает прохождение
    if (isStart && !walkSessionPromiseRef.current) {
      walkSessionPromiseRef.current = api.startWalkSession(route.id).then(result => {
        if ('id' in result) setWalkSession(result);
        return result;
      });
    }

    if (isEnd) {
      setShowCompletion(true);
      return;
    }

    // Переход к следующей карточке
    setCurrentIndex(i => i + 1);
    setCardPhase('out');
  };

  // Коммит правки времени: оптимистичный сдвиг, затем проверка на сервере
  const handleConfirmEdit = (draftStart: number, draftEnd: number, syncEnabled: boolean) => {
    const preEditRouteData = items;
    const stopItemId = currentItem.id;
    const optimistic = shiftStopTime(preEditRouteData, stopItemId, draftStart, draftEnd, syncEnabled);
    setDetail(prev => (prev ? { ...prev, route_data: optimistic } : prev));
    closeEditor();
    setShiftPending(true);

    api.shiftStopTime(route.id, {
      route_data: preEditRouteData,
      stop_item_id: stopItemId,
      new_start_minutes: draftStart,
      new_end_minutes: draftEnd,
    }).then(result => {
      if ('route_data' in result) {
        setDetail(prev => (prev ? { ...prev, route_data: result.route_data } : prev));
      } else {
        // Откат оптимистичного превью
        setDetail(prev => (prev ? { ...prev, route_data: preEditRouteData } : prev));
        if ('conflicts' in result) {
          setShiftConflict({
            stopItemId,
            newStart: draftStart,
            newEnd: draftEnd,
            conflicts: result.conflicts,
            maxFitEndMinutes: result.max_fit_end_minutes,
            preEditRouteData,
          });
        }
      }
    }).catch(() => {
      setDetail(prev => (prev ? { ...prev, route_data: preEditRouteData } : prev));
    }).finally(() => {
      setShiftPending(false);
    });
  };

  // Выбор в диалоге конфликта: второй вызов /walk/shift с resolution
  const handleResolveConflict = (resolution: ShiftResolution) => {
    if (!shiftConflict) return;
    const { stopItemId, newStart, newEnd, preEditRouteData } = shiftConflict;
    setShiftConflict(null);

    if (resolution === 'cancel') return;

    setShiftPending(true);
    api.shiftStopTime(route.id, {
      route_data: preEditRouteData,
      stop_item_id: stopItemId,
      new_start_minutes: newStart,
      new_end_minutes: newEnd,
      resolution,
    }).then(result => {
      if ('route_data' in result) {
        setDetail(prev => (prev ? { ...prev, route_data: result.route_data } : prev));
      }
      // Новый конфликт не показываем повторно, оставляем откаченную версию
    }).finally(() => {
      setShiftPending(false);
    });
  };

  return (
    <div className="fixed inset-0 bg-white flex flex-col overflow-hidden">
      <ExitButton onExit={onExit} t={t} routeTitle={detail.title} />

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {(() => {
          // cardItem - то, что отрисовано в карточке сейчас
          const cardItem = items[cardIndex];
          const cardIsAddressable = cardItem.type === 'attraction' || cardItem.type === 'food';
          const previewItem1 = items[cardIndex + 1];
          const previewItem2 = items[cardIndex + 2];
          const cardOpacity = cardPhase === 'out' ? 0 : 1;
          // Сдвиг карточки при уходе
          const cardTranslate = cardPhase === 'out' ? -8 : 0;
          const previewOpacity = cardPhase === 'out' ? 0 : 1;

          return (
            <>
              {/* Закреплённая карточка (один DOM-узел, меняется контент) */}
              <div
                ref={cardRef}
                style={{
                  opacity: cardOpacity,
                  transform: `translateY(${cardTranslate}px)`,
                  transition: `opacity ${CARD_FADE_MS}ms ease, transform ${CARD_FADE_MS}ms ease`,
                }}
              >
                <WalkthroughNode item={cardItem} t={t} language={language} peopleCount={detail.people_count} />

                {/* Ряд "Начало/Окончание" и редактор времени (только у точек посещения) */}
                {cardIsAddressable && (
                  <div
                    className="mt-5"
                    style={{
                      pointerEvents: cardPhase === 'idle' ? undefined : 'none',
                      opacity: rowVisible ? 1 : 0,
                      transition: `opacity ${CARD_FADE_MS}ms ease`,
                    }}
                  >
                    {editorAnchor == null ? (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setEditorAnchor('start')}
                          className="px-4 py-2 rounded-xl bg-gray-100 text-sm font-medium text-gray-700 active:bg-gray-200 flex-shrink-0"
                        >
                          {t('Начало')}
                        </button>
                        {/* Ужимается на узких экранах */}
                        <span className="text-xs text-gray-400 flex-shrink min-w-0 truncate text-center">{t('— Настроить время —')}</span>
                        <button
                          type="button"
                          onClick={() => setEditorAnchor('end')}
                          className="px-4 py-2 rounded-xl bg-gray-100 text-sm font-medium text-gray-700 active:bg-gray-200 flex-shrink-0"
                        >
                          {t('Окончание')}
                        </button>
                      </div>
                    ) : (
                      // Раскрытие редактора сверху вниз
                      <div
                        style={{
                          // Высота редактора анимируется как height
                          height: editorVisible ? editorMeasuredHeight : 0,
                          opacity: editorVisible ? 1 : 0,
                          transform: editorVisible ? 'translateY(0)' : 'translateY(-6px)',
                          overflow: 'hidden',
                          // Переход height и opacity на одной кривой
                          transition: `height ${MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1), transform ${MORPH_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
                        }}
                      >
                        <div ref={editorContentRef}>
                          <TimeEditor
                            key={`${currentItem.id}-${editorAnchor}`}
                            anchor={editorAnchor}
                            item={currentItem}
                            onCancel={closeEditor}
                            onConfirm={handleConfirmEdit}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Превью следующих строк (статичный блок) */}
              {previewItem1 && (
                <div
                  className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-3"
                  style={{ opacity: previewOpacity, transition: `opacity ${PREVIEW_FADE_MS}ms ease` }}
                >
                  <PreviewRow item={previewItem1} t={t} language={language} />
                  {previewItem2 && <PreviewRow item={previewItem2} t={t} language={language} />}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Нижняя панель скрыта, пока открыт редактор */}
      {/* Нижняя панель с кнопками On It */}
      <div
        className="px-6 border-t border-gray-100 flex-shrink-0 flex items-center justify-end"
        style={{ height: ONIT_BOTTOMBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box' }}
      >
        {editorAnchor == null && (
        <div className="flex justify-end">
          {/* Размер кнопки как у "Пройти маршрут" в Preview */}
          <button
            onClick={goNext}
            className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium active:bg-blue-600"
          >
            {buttonLabel}
          </button>
        </div>
        )}
      </div>

      {shiftConflict && (
        <ShiftConflictDialog
          conflicts={shiftConflict.conflicts}
          maxFitEndMinutes={shiftConflict.maxFitEndMinutes}
          onResolve={handleResolveConflict}
        />
      )}

      {showCompletion && (
        finishStats ? (
          <OnItCompletionDialog stats={finishStats} onFinish={onFinish} />
        ) : (
          <FinishStatusOverlay error={finishError} onRetry={() => setFinishError(false)} t={t} />
        )
      )}
    </div>
  );
};

// Кнопка выхода с заголовком "On It: название маршрута"
const ExitButton = ({ onExit, t, routeTitle }: { onExit: () => void; t: (ru: string) => string; routeTitle: string }) => (
  <div
    className="border-b border-gray-100 flex-shrink-0 relative"
    style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: 'env(safe-area-inset-top)' }}
  >
    <div className="absolute inset-0 flex items-center gap-3 pl-3 pr-6">
      <button
        type="button"
        onClick={onExit}
        aria-label={t('Выйти')}
        className="pp-plain w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
      >
        <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
      </button>
      <h2 className="text-lg font-semibold text-gray-800 truncate">On It: {routeTitle}</h2>
    </div>
  </div>
);

// Оверлей ожидания статистики (с повтором при ошибке)
const FinishStatusOverlay = ({ error, onRetry, t }: { error: boolean; onRetry: () => void; t: (ru: string) => string }) => (
  <div
    className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
    style={{ zIndex: ONIT_MODAL_Z + 10 }}
  >
    <div className="w-full max-w-sm bg-white rounded-3xl p-6 text-center">
      {error ? (
        <>
          <div className="text-base text-gray-700 mb-4">{t('Не удалось завершить маршрут')}</div>
          <button
            onClick={onRetry}
            className="w-full py-3 rounded-2xl bg-blue-500 text-white text-base font-semibold active:bg-blue-600"
          >
            {t('Повторить')}
          </button>
        </>
      ) : (
        <div className="text-base text-gray-500 py-2">{t('Завершение маршрута...')}</div>
      )}
    </div>
  </div>
);

// Стоимость в формате "N₽ × K чел"
function formatCostLabel(item: any, peopleCount: number, language: 'ru' | 'en'): string {
  if (!item.cost || item.cost <= 0) return '';
  const totalForItem = Math.round(item.cost * peopleCount);
  if (item.costApproximate) {
    const carCount = Math.max(1, Math.ceil(peopleCount/4));
    return carCount > 1 ? `~${Math.round(totalForItem / carCount)}₽ × ${carCount}` : `~${totalForItem}₽`;
  }
  return `${Math.round(item.cost)}₽ × ${peopleCount} ${paxWord(peopleCount, language)}`;
}

// Иконка узла по item.icon
function nodeIconFor(icon: string | undefined, size: number) {
  switch (icon) {
    case 'home':
      return <HouseFillIcon color="#000000" size={size} />;
    case 'start':
      return <PlayFillIcon color="#000000" size={size} />;
    case 'finish':
      return <FlagFillIcon color="#000000" size={size} />;
    case 'metro':
      return <TramFillIcon color="#4B5563" size={size} />;
    case 'bus':
      return <BusFillIcon color="#4B5563" size={size} />;
    case 'tram':
      return <LightrailFillIcon color="#4B5563" size={size} />;
    case 'taxi':
    case 'taxi_economy':
      return <CarRearFillIcon color="#F59E0B" size={size} />;
    case 'taxi_comfort':
      return <CarRearFillIcon color="#B0B8C1" size={size} />;
    case 'taxi_business':
      return <CarRearFillIcon color="#000000" size={size} />;
    case 'ferry':
      return <FerryFillIcon color="#4B5563" size={size} />;
    case 'transmode':
      return <CompositeTripIcon color="#4B5563" size={size} />;
    case 'walk':
      return <FigureWalkIcon color="#4B5563" size={size} />;
    case 'pin':
      return <span style={{ fontSize: size, lineHeight: 1 }} className="select-none">📍</span>;
    case 'restaurant':
      return <ForkKnifeIcon color="#000000" size={size} />;
    default:
      return null;
  }
}

// Компактная строка предпросмотра следующих элементов
const PreviewRow = ({ item, t, language }: { item: any; t: (ru: string) => string; language: 'ru' | 'en' }) => {
  const isTransport = item.type === 'transport';
  // Заголовок транспортного плеча
  const title = isTransport
    ? (item.rawTravelMode
        ? deriveTransportRow(t, language, item.rawTravelMode, item.fromPlace, item.toPlace, item.cost, item.fromAddressOverride, item.toAddressOverride).transportMode
        : item.name)
    : item.name;
  return (
    <div className="flex items-center justify-between gap-3">
      {/* Иконка узла (приглушённая) */}
      <div className="flex items-center gap-1.5 min-w-0">
        {item.icon && (
          <span className="flex-shrink-0 opacity-60">{nodeIconFor(item.icon, 14)}</span>
        )}
        {/* Приглушённый, но читаемый цвет */}
        <span className="text-sm font-medium text-gray-500 truncate">{title}</span>
      </div>
      {item.time && <span className="text-xs font-medium text-gray-400 flex-shrink-0">{item.time}</span>}
    </div>
  );
};

// Узел маршрута: транспорт через TransportTimeline, остальное - карточка
const WalkthroughNode = ({ item, t, language, peopleCount }: { item: any; t: (ru: string) => string; language: 'ru' | 'en'; peopleCount: number }) => {
  if (item.type === 'transport') {
    // У старых маршрутов rawTravelMode нет
    const transportDisplay = item.rawTravelMode
      ? deriveTransportRow(t, language, item.rawTravelMode, item.fromPlace, item.toPlace, item.cost, item.fromAddressOverride, item.toAddressOverride)
      : null;
    const title = transportDisplay?.transportMode ?? item.name;
    // Составная поездка с текстом каждого плеча
    const compoundParts: string[] | null = transportDisplay?.compoundParts ?? item.compoundParts ?? null;
    const costLabel = formatCostLabel(item, peopleCount, language);
    return (
      <div className="pt-4">
        <div className="flex items-center gap-2">
          {item.icon && <span className="flex-shrink-0">{nodeIconFor(item.icon, 20)}</span>}
          <div className="text-2xl font-semibold text-gray-800 break-words">{title}</div>
        </div>
        {compoundParts ? (
          <div className="flex flex-col mt-1">
            {compoundParts.map((part: string, idx: number) => (
              <div key={idx} className="text-sm text-gray-400 break-words">{idx === 0 ? part : `→ ${part}`}</div>
            ))}
          </div>
        ) : (
          transportDisplay?.description && (
            <div className="text-sm text-gray-400 mt-0.5 break-words">{transportDisplay.description}</div>
          )
        )}
        {item.travelTime != null && (
          <div className="text-base text-gray-600 mt-1">{item.travelTime} {t('мин')}</div>
        )}
        {/* Время отправления и прибытия плеча */}
        {item.time && (
          <div className="text-sm text-gray-400 mt-0.5">
            {item.time}
            {item.endTime && item.endTime !== '-' && item.endTime !== '--:--' ? ` → ${item.endTime}` : ''}
          </div>
        )}
        {costLabel && (
          <div className="text-sm text-gray-600 mt-1">{costLabel}</div>
        )}
        <div className="mt-5">
          <TransportTimeline item={item} />
        </div>
      </div>
    );
  }

  const isStart = item.type === 'start';
  const isEnd = item.type === 'end';
  const isAddressable = item.type === 'attraction' || item.type === 'food';
  // Цена только у точек посещения
  const costLabel = isAddressable ? formatCostLabel(item, peopleCount, language) : '';

  // Адрес и "Дом / Отель" у Старта и Финиша
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

  return (
    <div className="pt-4">
      {/* break-words для длинных названий */}
      <div className="flex items-center gap-2">
        {item.icon && <span className="flex-shrink-0">{nodeIconFor(item.icon, 20)}</span>}
        <div className="text-2xl font-semibold text-gray-800 break-words">
          {(isStart || isEnd) && startEndParenthetical ? startEndMain : item.name}
        </div>
      </div>
      {(isStart || isEnd) && startEndParenthetical && (
        <div className="text-sm text-gray-500 mt-1 break-words">({startEndParenthetical})</div>
      )}
      {isAddressable && item.address && (
        <div className="text-sm text-gray-500 mt-1 break-words">{item.address}</div>
      )}
      <div className="text-base mt-3">
        {isStart ? (
          <div className="text-gray-600">{t('Старт: ')}{item.time}</div>
        ) : isEnd ? (
          <>
            <div className="text-gray-600">{t('Финиш: ')}{item.time}</div>
            {item.endTime && item.endTime !== '-' && item.endTime !== '--:--' && (
              <div className="text-sm text-gray-400 mt-0.5">→ {item.endTime}</div>
            )}
          </>
        ) : (
          <>
            <div className="text-gray-600">{item.time}</div>
            {item.endTime && item.endTime !== '-' && (
              <div className="text-sm text-gray-400 mt-0.5">{t('до ')}{item.endTime}</div>
            )}
          </>
        )}
      </div>
      {/* Часы работы перед ценой */}
      {isAddressable && item.workTime && item.workTime !== '-' && (
        <div className="text-xs text-gray-400 mt-2">{t('Время работы: ')}{item.workTime}</div>
      )}
      {costLabel && (
        <div className="text-sm text-gray-600 mt-1">{costLabel}</div>
      )}
    </div>
  );
};

export default OnItWalkthrough;
