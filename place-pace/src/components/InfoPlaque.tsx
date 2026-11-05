// Единая система информационных плашек (очередь, категории, автозакрытие)
import { useEffect, useRef, useState } from 'react';
import { XmarkOctagonFillIcon, ExclamationmarkTriangleFillIcon, CheckmarkCircleFillIcon, InfoCircleFillIcon, ArrowUturnBackwardSquareFillIcon } from './sfSymbols';
import { TOAST_Z } from './layerGeometry';
import { useTranslation, type Language } from '../i18n/LanguageContext';
import { DICTIONARY } from '../i18n/dictionary';
import { useUiScale } from '../utils/uiScale';

// Язык для вызовов вне компонентов
let currentLanguage: Language = 'ru';
const tPlaque = (ru: string): string => (currentLanguage === 'en' ? (DICTIONARY[ru] ?? ru) : ru);

// 'cancel' - плашка отмены с действием
type PlaqueCategory = 'error' | 'warning' | 'success' | 'info' | 'cancel';

const CATEGORY_ICON = {
  error: XmarkOctagonFillIcon,
  warning: ExclamationmarkTriangleFillIcon,
  success: CheckmarkCircleFillIcon,
  info: InfoCircleFillIcon,
  cancel: ArrowUturnBackwardSquareFillIcon,
} as const;

const CATEGORY_COLOR: Record<PlaqueCategory, string> = {
  error: '#EF4444',
  warning: '#EAB308',
  success: '#007AFF',
  info: '#6B7280',
  cancel: '#1F2937',
};

const DISPLAY_MS: Record<PlaqueCategory, number> = {
  error: 3000,
  warning: 3000,
  success: 3000,
  info: 3000,
  cancel: 5000,
};

const PLAQUE_HEIGHT = 38;
const PLAQUE_SIDE_PADDING = 18;
const PLAQUE_BAR_INSET = 14;
const ENTER_MS = 320;
const EXIT_MS = 260;
// Отступы от логотипа и свёрнутого routebar
const EDGE_MARGIN = 20;
const ROUTEBAR_COLLAPSED_VW = 0.15;
const LOGO_LEFT_OFFSET_PX = 104;

interface QueueItem {
  id: number;
  text: string;
  category: PlaqueCategory;
  actionLabel?: string;
  onAction?: () => void;
  // Второе действие блокирующей плашки (Да/Нет)
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  actionLabelColorClassName?: string;
  secondaryActionLabelColorClassName?: string;
  // Блокирующая плашка: без автозакрытия, перекрывает страницу
  blocking?: boolean;
}

let dispatch: ((item: Omit<QueueItem, 'id'>) => void) | null = null;
let nextId = 1;

export function showInfoPlaque(text: string, category: PlaqueCategory) {
  dispatch?.({ text, category });
}

// Плашка отмены действия: "Да" сразу выполняет onConfirm
export function showCancelPlaque(text: string, onConfirm: () => void) {
  dispatch?.({ text, category: 'cancel', actionLabel: tPlaque('Да'), onAction: onConfirm });
}

// Блокирующая плашка с выбором Да/Нет
export function showBlockingConfirmPlaque(text: string, onYes: () => void, onNo: () => void) {
  dispatch?.({
    text,
    category: 'warning',
    actionLabel: tPlaque('Да'),
    onAction: onYes,
    actionLabelColorClassName: 'text-gray-500',
    secondaryActionLabel: tPlaque('Нет'),
    onSecondaryAction: onNo,
    secondaryActionLabelColorClassName: 'text-blue-500',
    blocking: true,
  });
}

export function InfoPlaqueHost() {
  const { language } = useTranslation();
  useEffect(() => { currentLanguage = language; }, [language]);
  // Размеры в px умножаются на масштаб интерфейса
  const uiScale = useUiScale();
  const plaqueHeight = PLAQUE_HEIGHT * uiScale;

  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering');
  const [maxWidth, setMaxWidth] = useState(480);
  const queueRef = useRef<QueueItem[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const currentRef = useRef<QueueItem | null>(null);

  useEffect(() => {
    const recompute = () => {
      const vw = window.innerWidth;
      const leftHalf = vw / 2 - vw * ROUTEBAR_COLLAPSED_VW - EDGE_MARGIN * uiScale;
      const rightHalf = (vw - LOGO_LEFT_OFFSET_PX * uiScale) - vw / 2 - EDGE_MARGIN * uiScale;
      setMaxWidth(Math.max(120 * uiScale, 2 * Math.min(leftHalf, rightHalf)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [uiScale]);

  const advance = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
    setPhase('entering');
    if (next) {
      timersRef.current.push(setTimeout(() => setPhase('visible'), ENTER_MS));
      // Блокирующая плашка ждёт явного выбора
      if (!next.blocking) {
        const displayMs = DISPLAY_MS[next.category];
        timersRef.current.push(setTimeout(() => setPhase('exiting'), ENTER_MS + displayMs));
        timersRef.current.push(setTimeout(advance, ENTER_MS + displayMs + EXIT_MS));
      }
    }
  };

  useEffect(() => {
    dispatch = (item) => {
      // Плашки идут по очереди
      queueRef.current.push({ id: nextId++, ...item });
      if (!currentRef.current) advance();
    };
    return () => { dispatch = null; };
  }, []);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  if (!current) return null;

  const Icon = CATEGORY_ICON[current.category];
  const color = CATEGORY_COLOR[current.category];
  // shown только для 'visible', иначе exiting-плашка исчезала бы мгновенно
  const shown = phase === 'visible';
  const barShrunk = phase !== 'entering';

  // "Да" выполняет действие и завершает плашку сразу
  const handleAction = () => {
    current.onAction?.();
    advance();
  };
  const handleSecondaryAction = () => {
    current.onSecondaryAction?.();
    advance();
  };

  const blocking = !!current.blocking;

  return (
    <>
      {/* Блокирующий оверлей под плашкой, поверх страницы */}
      {blocking && (
        <div
          className="fixed inset-0"
          style={{ zIndex: TOAST_Z - 1, cursor: 'not-allowed', pointerEvents: 'auto' }}
        />
      )}
      <div
        className="fixed left-1/2 pointer-events-none"
        style={{ top: plaqueHeight, zIndex: TOAST_Z, transform: 'translateX(-50%)' }}
      >
        <div
          key={current.id}
          className={blocking ? 'relative bg-white overflow-hidden' : 'relative inline-flex items-center bg-white overflow-hidden'}
          style={{
            height: blocking ? undefined : plaqueHeight,
            maxWidth: blocking ? Math.min(420 * uiScale, Math.max(maxWidth, 320 * uiScale)) : maxWidth,
            borderRadius: blocking ? 20 * uiScale : plaqueHeight * 0.42,
            padding: blocking ? `${16 * uiScale}px ${20 * uiScale}px` : `0 ${PLAQUE_SIDE_PADDING * uiScale}px`,
            gap: blocking ? undefined : 8 * uiScale,
            boxShadow: '0 10px 40px -8px rgba(15, 23, 42, 0.28), 0 2px 8px -2px rgba(15, 23, 42, 0.12)',
            opacity: shown ? 1 : 0,
            transform: shown ? 'scale(1) translateY(0)' : 'scale(0.85) translateY(-8px)',
            transition: phase === 'exiting'
              ? `opacity ${EXIT_MS}ms ease-in, transform ${EXIT_MS}ms ease-in`
              : `opacity ${ENTER_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1), transform ${ENTER_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
          }}
        >
          {blocking ? (
            <>
              <div className="flex items-start gap-2">
                <Icon size={18} color={color} className="flex-shrink-0 mt-0.5" />
                <span className="text-sm font-medium text-gray-800">{current.text}</span>
              </div>
              <div className="flex items-center justify-end gap-4 mt-3">
                <span
                  className={`text-sm font-medium whitespace-nowrap cursor-pointer hover:opacity-70 transition-opacity ${current.actionLabelColorClassName ?? 'text-blue-500'}`}
                  style={{ pointerEvents: 'auto' }}
                  onClick={handleAction}
                >
                  {current.actionLabel}
                </span>
                {current.secondaryActionLabel && (
                  <span
                    className={`text-sm font-medium whitespace-nowrap cursor-pointer hover:opacity-70 transition-opacity ${current.secondaryActionLabelColorClassName ?? 'text-blue-500'}`}
                    style={{ pointerEvents: 'auto' }}
                    onClick={handleSecondaryAction}
                  >
                    {current.secondaryActionLabel}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <Icon size={18} color={color} className="flex-shrink-0" />
              <span className="text-sm font-medium text-gray-800 whitespace-nowrap overflow-hidden text-ellipsis">
                {current.text}
              </span>
              {current.actionLabel && (
                <span
                  className="text-sm font-medium text-blue-500 whitespace-nowrap flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
                  style={{ pointerEvents: 'auto' }}
                  onClick={handleAction}
                >
                  {current.actionLabel}
                </span>
              )}
              <div
                className="absolute bottom-0 bg-blue-500"
                style={{
                  left: PLAQUE_BAR_INSET * uiScale,
                  right: PLAQUE_BAR_INSET * uiScale,
                  height: 2,
                  borderRadius: 1,
                  transformOrigin: 'left',
                  transform: barShrunk ? 'scaleX(0)' : 'scaleX(1)',
                  transition: phase === 'entering' ? 'none' : `transform ${DISPLAY_MS[current.category]}ms linear`,
                }}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
