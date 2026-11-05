// Двухрядный редактор времени посещения точки (начало и окончание, Sync, таймлайн)
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { CheckmarkIcon, InfoCircleIcon, XmarkIcon } from '../components/sfSymbols';
import { useTooltipEdgeOffset } from '../components/layerGeometry';
import DualTimelineSlider from './DualTimelineSlider';
import { timeToMinutes } from './routeTimeShift';

// Лимиты между началом и концом визита, мин
const MIN_GAP_MINUTES = 10;
const BOUND_SLACK_MINUTES = 120;

// Границы по часам работы точки
function parseWorkTimeBounds(workTime: unknown): { openMin: number; closeMin: number } | null {
  if (typeof workTime !== 'string' || workTime === '-') return null;
  const parts = workTime.split('-');
  if (parts.length !== 2) return null;
  const open = parts[0].trim();
  const close = parts[1].trim();
  if (!/^\d{1,2}:\d{2}$/.test(open) || !/^\d{1,2}:\d{2}$/.test(close)) return null;
  const openMin = timeToMinutes(open);
  const closeMin = timeToMinutes(close);
  if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || closeMin <= openMin) return null;
  return { openMin, closeMin };
}

// Фирменный синий для иконок подтверждения
export const CHECK_COLOR = '#007AFF';
const XMARK_COLOR = '#000000';

interface TimeEditorProps {
  anchor: 'start' | 'end';
  item: any;
  onCancel: () => void;
  onConfirm: (draftStart: number, draftEnd: number, syncEnabled: boolean) => void;
}

const TimeEditor = ({ anchor, item, onCancel, onConfirm }: TimeEditorProps) => {
  const { t } = useTranslation();

  // Sync включён, если открыли "Начало"
  const [syncEnabled, setSyncEnabled] = useState(anchor === 'start');
  const [draftStart, setDraftStart] = useState(() => timeToMinutes(item.time));
  const [draftEnd, setDraftEnd] = useState(() => timeToMinutes(item.endTime));
  // Значения на момент открытия
  const [defaultStart] = useState(draftStart);
  const [defaultEnd] = useState(draftEnd);
  const defaultDuration = defaultEnd - defaultStart;

  const [showInfo, setShowInfo] = useState(false);
  const { wrapRef: infoTooltipRef, arrowOffset: infoArrowOffset } = useTooltipEdgeOffset(showInfo);
  // Закрытие тултипа тапом вне его
  const infoWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showInfo) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (infoWrapRef.current && !infoWrapRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showInfo]);

  // Границы драга пересчитываются на каждый рендер
  let startMin = defaultStart - BOUND_SLACK_MINUTES;
  let endMax = defaultEnd + BOUND_SLACK_MINUTES;
  const workTimeBounds = parseWorkTimeBounds(item.workTime);
  if (workTimeBounds) {
    startMin = Math.max(startMin, workTimeBounds.openMin);
    endMax = Math.min(endMax, workTimeBounds.closeMin);
  }
  const startMax = syncEnabled ? endMax - defaultDuration : draftEnd - MIN_GAP_MINUTES;
  const endMin = syncEnabled ? startMin + defaultDuration : draftStart + MIN_GAP_MINUTES;
  const bounds = { startMin, startMax, endMin, endMax };

  const handleSliderChange = (newStart: number, newEnd: number) => {
    setDraftStart(newStart);
    setDraftEnd(newEnd);
  };

  return (
    // Карточка редактора
    <div className="rounded-xl bg-gray-100 px-6 pt-2.5 pb-3">
      {/* Ряд 1: крестик, Sync, галочка */}
      <div className="flex items-center justify-between gap-2">
        {/* Белая круглая кнопка отмены */}
        <button
          type="button"
          onClick={onCancel}
          className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 active:bg-gray-50"
        >
          <XmarkIcon size={16} color={XMARK_COLOR} />
        </button>

        <div className="flex items-center gap-2">
          {/* "Sync" не переводится */}
          <span className="text-sm text-gray-500">Sync</span>
          <div className="relative" ref={infoWrapRef}>
            <button
              type="button"
              onClick={() => setShowInfo(v => !v)}
              className="w-6 h-6 rounded-full text-gray-400 flex items-center justify-center"
            >
              {/* Иконка info */}
              <InfoCircleIcon size={18} />
            </button>
            {showInfo && (
              // Тултип по центру триггера со сдвигом от краёв
              <div
                ref={infoTooltipRef}
                className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-20 w-52"
                style={{ transform: `translateX(calc(-50% + ${infoArrowOffset}px))` }}
              >
                <div className="pp-tooltip">
                  {/* Текст тултипа */}
                  {t('Изменения времени синхронизируются с фиксированной длительностью посещения точки')}
                </div>
                <div
                  className="pp-tooltip-arrow pp-tooltip-arrow--top"
                  style={{ left: `calc(50% - ${infoArrowOffset}px)` }}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSyncEnabled(v => !v)}
            className={`relative w-[50.4px] h-[22.95px] rounded-full transition-colors flex-shrink-0 ${
              syncEnabled ? 'bg-[#007AFF]' : 'bg-gray-300'
            }`}
          >
            {/* Бегунок тумблера Sync */}
            <div className={`
              absolute top-[2.25px] w-[28.8px] h-[18.45px] bg-white rounded-full shadow-sm transition-all
              ${syncEnabled ? 'left-[19.1px]' : 'left-[2.5px]'}
            `} />
          </button>
        </div>

        {/* Синяя кнопка подтверждения */}
        <button
          type="button"
          onClick={() => onConfirm(draftStart, draftEnd, syncEnabled)}
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:opacity-80"
          style={{ backgroundColor: CHECK_COLOR }}
        >
          <CheckmarkIcon size={18} color="#FFFFFF" />
        </button>
      </div>

      {/* Ряд 2: таймлайн */}
      <div className="mt-2">
        <DualTimelineSlider
          startValue={draftStart}
          endValue={draftEnd}
          onChange={handleSliderChange}
          syncEnabled={syncEnabled}
          bounds={bounds}
        />
      </div>
    </div>
  );
};

export default TimeEditor;
