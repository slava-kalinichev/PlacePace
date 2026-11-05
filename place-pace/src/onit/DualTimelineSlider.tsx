// Линейка с двумя ручками для TimeEditor (controlled: startValue, endValue, onChange)
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { hourWord } from '../i18n/plurals';
import { CHECK_COLOR } from './TimeEditor';

const MIN_VIEW_SPAN = 40;
const COMPRESS_THRESHOLD_RATIO = 0.4;
const COMPRESS_MARGIN_RATIO = 0.3;
const REST_PADDING_RATIO = 0.125;
const BOUND_EPS = 0.5;
const LABEL_EDGE_NUDGE_PX = 10;
const PIN_ADVANCE_MIN_PER_SEC = 24;
const EASE_FACTOR = 0.25;
const COMPRESS_EASE_FACTOR = 0.12;
const SETTLE_EPSILON = 0.05;

const HANDLE_HIT_SIZE = 44;
const HANDLE_VISUAL_SIZE = 26;
const LABEL_RESERVED_HEIGHT = 16;
const LABEL_GAP = 4;
const TRACK_LINE_THICKNESS = 4;
const LINE_TOP = LABEL_RESERVED_HEIGHT + LABEL_GAP + HANDLE_HIT_SIZE /2 - TRACK_LINE_THICKNESS / 2;
const TRACK_AREA_HEIGHT = LABEL_RESERVED_HEIGHT + LABEL_GAP + HANDLE_HIT_SIZE;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Симметричный вид вокруг пары значений
function computeTargetView(a: number, b: number, marginRatio: number): { start: number; end: number } {
  const handleMin = Math.min(a, b);
  const handleMax = Math.max(a, b);
  const span = Math.max(handleMax - handleMin, MIN_VIEW_SPAN);
  const margin = span * marginRatio;
  return { start: handleMin - margin, end: handleMax + margin };
}

// Подгоняет вид под истинные пределы bounds
function clampToTrueBounds(
  candidate: { start: number; end: number },
  nextStart: number,
  nextEnd: number,
  limitBounds: { startMin: number; endMax: number }
): { start: number; end: number } {
  const startAtTrueLimit = nextStart <= limitBounds.startMin + BOUND_EPS;
  const endAtTrueLimit = nextEnd >= limitBounds.endMax - BOUND_EPS;
  return {
    start: startAtTrueLimit ? limitBounds.startMin : candidate.start,
    end: endAtTrueLimit ? limitBounds.endMax : candidate.end,
  };
}

// Вид в покое
function computeRestView(
  startVal: number,
  endVal: number,
  bounds: { startMin: number; endMax: number }
): { start: number; end: number } {
  return clampToTrueBounds(computeTargetView(startVal, endVal, REST_PADDING_RATIO), startVal, endVal, bounds);
}

// Хаптик при зуме (где доступен Vibration API)
function triggerZoomHaptic() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(10);
  }
}

// ЧЧ:ММ
function formatTimeBadge(minutes: number): { text: string; dayOffset: number } {
  const dayOffset = Math.floor(minutes / 1440);
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return { text: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`, dayOffset };
}

interface DualTimelineSliderProps {
  startValue: number;
  endValue: number;
  onChange: (newStart: number, newEnd: number) => void;
  syncEnabled: boolean;
  bounds: { startMin: number; startMax: number; endMin: number; endMax: number };
}

const DualTimelineSlider = ({ startValue, endValue, onChange, syncEnabled, bounds }: DualTimelineSliderProps) => {
  const { language } = useTranslation();

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // view - отрисованный вид, viewRef - его синхронная копия
  const [view, setView] = useState(() => computeRestView(startValue, endValue, bounds));
  const viewRef = useRef(view);
  const targetRef = useRef(view);
  const rafRef = useRef<number | null>(null);
  // Скорость текущей погони
  const easeFactorRef = useRef(EASE_FACTOR);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const [draggingState, setDraggingState] = useState<'start' | 'end' | null>(null);
  // Исходные значения жеста; масштаб фиксируется на его время
  const dragOriginRef = useRef({ pointerX: 0, start: 0, end: 0, scaleSpan: MIN_VIEW_SPAN });
  // Защита от аномального pointermove
  const lastAcceptedDxPxRef = useRef(0);
  const suspectDxPxRef = useRef<number | null>(null);
  // Последние значения ручек за драг
  const lastDragValuesRef = useRef({ start: startValue, end: endValue });
  // Латч перехода в сжатие
  const wasCompressingRef = useRef(false);
  // Размах вида в момент старта сжатия
  const compressBaselineSpanRef = useRef(0);

  // Пиксель, на котором заморожена ручка у предела
  const pinnedPxRef = useRef<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [pinnedPx, setPinnedPx] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  // Последняя известная координата пальца
  const lastPointerClientXRef = useRef(0);
  const pinAdvanceRafRef = useRef<number | null>(null);
  const pinAdvanceLastTsRef = useRef(0);
  // Накопленный авто-рост времени у предела
  const pinAutoAdvanceRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  const ensureRaf = useCallback(() => {
    if (rafRef.current != null) return;
    const step = () => {
      const prev = viewRef.current;
      const target = targetRef.current;
      const ease = easeFactorRef.current;
      const nextStart = prev.start + (target.start - prev.start) * ease;
      const nextEnd = prev.end + (target.end - prev.end) * ease;
      const closeEnough =
        Math.abs(target.start - nextStart) < SETTLE_EPSILON && Math.abs(target.end - nextEnd) < SETTLE_EPSILON;
      const next = closeEnough ? target : { start: nextStart, end: nextEnd };
      viewRef.current = next;
      setView(next);
      // Цикл живёт, пока не доехали или идёт драг
      if (!closeEnough || draggingRef.current) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (pinAdvanceRafRef.current != null) cancelAnimationFrame(pinAdvanceRafRef.current);
    };
  }, []);

  const beginDrag = (which: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = which;
    setDraggingState(which);
    // scaleSpan фиксируется один раз на жест
    dragOriginRef.current = {
      pointerX: e.clientX,
      start: startValue,
      end: endValue,
      scaleSpan: targetRef.current.end - targetRef.current.start,
    };
    lastDragValuesRef.current = { start: startValue, end: endValue };
    wasCompressingRef.current = false;
    compressBaselineSpanRef.current = 0;
    easeFactorRef.current = EASE_FACTOR;
    // Новый жест - координаты от нуля
    lastAcceptedDxPxRef.current = 0;
    suspectDxPxRef.current = null;
    lastPointerClientXRef.current = e.clientX;
    // Гасим авто-рост предыдущего жеста
    if (pinAdvanceRafRef.current != null) {
      cancelAnimationFrame(pinAdvanceRafRef.current);
      pinAdvanceRafRef.current = null;
    }
    pinAdvanceLastTsRef.current = 0;
    // Новый жест без накопленного авто-роста
    pinAutoAdvanceRef.current = { start: 0, end: 0 };
    // Снимаем приклейку только у захваченной стороны
    if (pinnedPxRef.current[which] != null) {
      pinnedPxRef.current = { ...pinnedPxRef.current, [which]: null };
      setPinnedPx(pinnedPxRef.current);
    }
  };

  // Правило зума: единственное, что двигает вид здесь, - сжатие
  const applyZoomRule = (nextStart: number, nextEnd: number) => {
    const target = targetRef.current;
    const currentSpan = Math.max(target.end - target.start, MIN_VIEW_SPAN);

    let candidate = target;
    let ease = easeFactorRef.current;

    const handleSpan = Math.max(nextEnd - nextStart, 0);
    const atTrueLimit = nextStart <= bounds.startMin + BOUND_EPS || nextEnd >= bounds.endMax - BOUND_EPS;
    if (!wasCompressingRef.current) {
      const shouldStart =
        !atTrueLimit &&
        handleSpan > 0 && currentSpan > MIN_VIEW_SPAN + 1 && handleSpan < currentSpan * COMPRESS_THRESHOLD_RATIO;
      if (shouldStart) {
        compressBaselineSpanRef.current = currentSpan;
        wasCompressingRef.current = true;
        triggerZoomHaptic();
      }
    }
    if (wasCompressingRef.current) {
      candidate = computeTargetView(nextStart, nextEnd, COMPRESS_MARGIN_RATIO);
      ease = COMPRESS_EASE_FACTOR;
      if (handleSpan >= compressBaselineSpanRef.current * COMPRESS_THRESHOLD_RATIO) {
        wasCompressingRef.current = false;
      }
    }

    targetRef.current = clampToTrueBounds(candidate, nextStart, nextEnd, bounds);
    easeFactorRef.current = ease;
    ensureRaf();
  };

  // Правило приклейки у предела для обеих сторон
  const processPinRule = (nextStart: number, nextEnd: number): boolean => {
    const target = targetRef.current;
    const nextPinned = { ...pinnedPxRef.current };
    const newTarget = { ...target };
    let touchedTarget = false;
    let pinnedAny = false;

    const endAtTrueLimit = nextEnd >= bounds.endMax - BOUND_EPS;
    const endPastCurrent = !endAtTrueLimit && nextEnd >= target.end - BOUND_EPS;
    if (endPastCurrent) {
      if (nextPinned.end == null) triggerZoomHaptic();
      nextPinned.end = trackWidth;
      // Вид растёт до живого значения без запаса
      newTarget.end = Math.min(nextEnd, bounds.endMax);
      touchedTarget = true;
      pinnedAny = true;
      wasCompressingRef.current = false;
    } else if (nextPinned.end != null) {
      nextPinned.end = null;
    }

    const startAtTrueLimit = nextStart <= bounds.startMin + BOUND_EPS;
    const startPastCurrent = !startAtTrueLimit && nextStart <= target.start + BOUND_EPS;
    if (startPastCurrent) {
      if (nextPinned.start == null) triggerZoomHaptic();
      nextPinned.start = 0;
      newTarget.start = Math.max(nextStart, bounds.startMin);
      touchedTarget = true;
      pinnedAny = true;
      wasCompressingRef.current = false;
    } else if (nextPinned.start != null) {
      nextPinned.start = null;
    }

    pinnedPxRef.current = nextPinned;
    setPinnedPx(nextPinned);

    if (touchedTarget) {
      targetRef.current = newTarget;
      // Мгновенная синхронизация вида
      viewRef.current = newTarget;
      setView(newTarget);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    return pinnedAny;
  };

  // Значения драга как функция позиции пальца
  const computePositionDerived = (which: 'start' | 'end'): { start: number; end: number } => {
    const origin = dragOriginRef.current;
    const dxPx = lastPointerClientXRef.current - origin.pointerX;
    const dxMinutes = (dxPx / trackWidth) * origin.scaleSpan;
    let nextStart = origin.start;
    let nextEnd = origin.end;
    if (syncEnabled) {
      const minDelta = Math.max(bounds.startMin - origin.start, bounds.endMin - origin.end);
      const maxDelta = Math.min(bounds.startMax - origin.start, bounds.endMax - origin.end);
      const delta = clamp(dxMinutes, minDelta, maxDelta);
      nextStart = origin.start + delta;
      nextEnd = origin.end + delta;
    } else if (which === 'start') {
      nextStart = clamp(origin.start + dxMinutes, bounds.startMin, bounds.startMax);
    } else {
      nextEnd = clamp(origin.end + dxMinutes, bounds.endMin, bounds.endMax);
    }
    return { start: nextStart, end: nextEnd };
  };

  // Позиция пальца плюс накопленный авто-рост
  const computeFinalDragValues = (which: 'start' | 'end'): { start: number; end: number } => {
    const positionDerived = computePositionDerived(which);
    const bonus = pinAutoAdvanceRef.current;
    if (syncEnabled) {
      const shift = which === 'start' ? -bonus.start : bonus.end;
      return {
        start: clamp(positionDerived.start + shift, bounds.startMin, bounds.startMax),
        end: clamp(positionDerived.end + shift, bounds.endMin, bounds.endMax),
      };
    }
    return {
      start: clamp(positionDerived.start - bonus.start, bounds.startMin, bounds.startMax),
      end: clamp(positionDerived.end + bonus.end, bounds.endMin, bounds.endMax),
    };
  };

  // Автономный рост времени, пока палец удерживает ручку у предела
  const ensurePinAdvance = () => {
    if (pinAdvanceRafRef.current != null) return;
    pinAdvanceLastTsRef.current = 0;
    const step = (ts: number) => {
      const which = draggingRef.current;
      const stillPinned = which != null && pinnedPxRef.current[which] != null;
      if (!stillPinned) {
        pinAdvanceRafRef.current = null;
        pinAdvanceLastTsRef.current = 0;
        return;
      }

      const dt = pinAdvanceLastTsRef.current ? (ts - pinAdvanceLastTsRef.current) / 1000 : 0;
      pinAdvanceLastTsRef.current = ts;
      const deltaMinutes = dt * PIN_ADVANCE_MIN_PER_SEC;

      if (deltaMinutes > 0) {
        pinAutoAdvanceRef.current = which === 'start'
          ? { ...pinAutoAdvanceRef.current, start: pinAutoAdvanceRef.current.start + deltaMinutes }
          : { ...pinAutoAdvanceRef.current, end: pinAutoAdvanceRef.current.end + deltaMinutes };

        const { start: newStart, end: newEnd } = computeFinalDragValues(which);
        lastDragValuesRef.current = { start: newStart, end: newEnd };
        const stillPinnedAfter = processPinRule(newStart, newEnd);
        if (!stillPinnedAfter) applyZoomRule(newStart, newEnd);
        onChange(newStart, newEnd);
      }

      pinAdvanceRafRef.current = requestAnimationFrame(step);
    };
    pinAdvanceRafRef.current = requestAnimationFrame(step);
  };

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const which = draggingRef.current;
    if (!which || trackWidth === 0) return;
    const origin = dragOriginRef.current;
    const dxPx = e.clientX - origin.pointerX;

    // Порог правдоподобного смещения за кадр, px
    const MAX_PLAUSIBLE_FRAME_PX = 120;
    const jumpFromLastAccepted = dxPx - lastAcceptedDxPxRef.current;
    if (Math.abs(jumpFromLastAccepted) > MAX_PLAUSIBLE_FRAME_PX) {
      const confirmed = suspectDxPxRef.current != null
        && Math.abs(dxPx - suspectDxPxRef.current) < MAX_PLAUSIBLE_FRAME_PX / 2;
      if (!confirmed) {
        suspectDxPxRef.current = dxPx;
        return;
      }
    }
    suspectDxPxRef.current = null;
    lastAcceptedDxPxRef.current = dxPx;
    // Координату обновляем после фильтра аномалий
    lastPointerClientXRef.current = e.clientX;

    const { start: nextStart, end: nextEnd } = computeFinalDragValues(which);

    lastDragValuesRef.current = { start: nextStart, end: nextEnd };
    const pinnedThisFrame = processPinRule(nextStart, nextEnd);
    if (!pinnedThisFrame) {
      applyZoomRule(nextStart, nextEnd);
    } else {
      // Запуск авто-роста
      ensurePinAdvance();
    }
    onChange(nextStart, nextEnd);
  };

  const endDrag = () => {
    draggingRef.current = null;
    setDraggingState(null);
    wasCompressingRef.current = false;
    easeFactorRef.current = EASE_FACTOR;

    // Приклейка снимается при отпускании
    pinnedPxRef.current = { start: null, end: null };
    setPinnedPx({ start: null, end: null });
    const { start, end } = lastDragValuesRef.current;
    targetRef.current = computeRestView(start, end, bounds);
    ensureRaf();
  };

  const spanMinutes = Math.max(view.end - view.start, 1);
  const minutesToPx = (m: number) => (trackWidth ? clamp(((m - view.start) / spanMinutes) * trackWidth, 0, trackWidth) : 0);

  const startPx = pinnedPx.start ?? minutesToPx(startValue);
  const endPx = pinnedPx.end ?? minutesToPx(endValue);
  const startBadge = formatTimeBadge(startValue);
  const endBadge = formatTimeBadge(endValue);
  // Ручка на истинном пределе
  const atStartTrueLimit = startValue <= bounds.startMin + BOUND_EPS;
  const atEndTrueLimit = endValue >= bounds.endMax - BOUND_EPS;

  // Короткое "мин" без склонения
  const minuteAbbrev = language === 'en' ? 'min' : 'мин';
  const durationMinutes = Math.max(0, Math.round(endValue - startValue));
  const durationHours = Math.floor(durationMinutes / 60);
  const durationRestMinutes = durationMinutes % 60;
  const durationText = durationMinutes < 60
    ? `${durationMinutes} ${minuteAbbrev}`
    : durationRestMinutes === 0
      ? `${durationHours} ${hourWord(durationHours, language)}`
      : `${durationHours} ${hourWord(durationHours, language)} ${durationRestMinutes} ${minuteAbbrev}`;

  const renderHandle = (
    which: 'start' | 'end',
    x: number,
    badge: { text: string; dayOffset: number },
    atTrueLimit: boolean
  ) => (
    <div
      className="absolute top-0 flex flex-col items-center select-none"
      style={{
        left: x,
        transform: 'translateX(-50%)',
        // Без transition на left
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {/* Подпись времени над ручкой */}
      <div
        className="whitespace-nowrap text-center pointer-events-none"
        style={{
          height: LABEL_RESERVED_HEIGHT,
          transform: atTrueLimit
            ? `translateX(${which === 'start' ? LABEL_EDGE_NUDGE_PX : -LABEL_EDGE_NUDGE_PX}px)`
            : undefined,
        }}
      >
        <span className="text-xs font-medium text-gray-700">{badge.text}</span>
        {badge.dayOffset !== 0 && (
          <sup className="ml-0.5 text-[9px] text-gray-400">{badge.dayOffset > 0 ? `+${badge.dayOffset}` : badge.dayOffset}</sup>
        )}
      </div>
      <div style={{ height: LABEL_GAP }} />
      {/* Зона захвата ручки (touchAction: none) */}
      <div
        className="flex items-center justify-center select-none"
        style={{
          width: HANDLE_HIT_SIZE,
          height: HANDLE_HIT_SIZE,
          touchAction: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        onPointerDown={beginDrag(which)}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Кружок ручки */}
        <div
          className="rounded-full bg-white transition-transform"
          style={{
            width: HANDLE_VISUAL_SIZE,
            height: HANDLE_VISUAL_SIZE,
            boxShadow: draggingState === which
              ? '0 3px 10px rgba(0,0,0,0.28), 0 1px 2px rgba(0,0,0,0.16)'
              : '0 1px 4px rgba(0,0,0,0.2), 0 1px 1px rgba(0,0,0,0.1)',
            transform: draggingState === which ? 'scale(1.15)' : 'scale(1)',
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="w-full select-none" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}>
      <div ref={trackRef} className="relative select-none" style={{ height: TRACK_AREA_HEIGHT }}>
        <div className="absolute left-0 right-0 rounded-full bg-gray-200" style={{ top: LINE_TOP, height: TRACK_LINE_THICKNESS }} />
        <div
          className="absolute rounded-full bg-blue-500"
          style={{ top: LINE_TOP, height: TRACK_LINE_THICKNESS, left: Math.min(startPx, endPx), width: Math.abs(endPx - startPx) }}
        />
        {renderHandle('start', startPx, startBadge, atStartTrueLimit)}
        {renderHandle('end', endPx, endBadge, atEndTrueLimit)}
      </div>
      {/* Длительност под треком (синяя при Sync) */}
      <div
        className="text-center text-xs font-semibold mt-2"
        style={{ color: syncEnabled ? CHECK_COLOR : '#4B5563' }}
      >
        {durationText}
      </div>
    </div>
  );
};

export default DualTimelineSlider;
