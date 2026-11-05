// Геометрия и z-index слоёв модальных окон
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { TRAFFIC_LIGHT_WIDTH } from './TrafficLight';
import { getUiScale } from '../utils/uiScale';

// Хром (лого, routebar, шестерёнка, ЛК) всегда поверх слоёв
export const CHROME_Z = 1000;
export const FULLSCREEN_Z = 1050;
export const BACKDROP_Z = 50;
export const TOAST_Z = 1100;
export const LAYER_Z_BASE = 100;
export const LAYER_Z_STEP = 100;

// Заглушки высоты шапки до первого измерения
export const DEFAULT_HEADER_HEIGHT = 77;
export const DEFAULT_CAP_HEADER_HEIGHT = 76;

// Мягкая тень верхнего слоя
const AMBIENT_SHADOW = '0 25px 50px -12px rgba(15, 23, 42, 0.35)';
export function layerBoxShadow(depth: number): string {
  if (depth <= 0) return AMBIENT_SHADOW;
  const d = Math.min(depth, 2);
  const reach = 6 + d * 4;
  const blur = 16 + d * 8;
  const alpha = (0.16 + d * 0.06).toFixed(2);
  return `-${reach}px -${reach}px ${blur}px -4px rgba(15, 23, 42, ${alpha}), ${AMBIENT_SHADOW}`;
}

// Затемнение слоёв глубже верхнего
export function layerScrimOpacity(depth: number): number {
  return Math.min(Math.max(depth, 0) * 0.1, 0.2);
}

export function useHeaderHeightReporter(
  ref: RefObject<HTMLElement | null>,
  onHeaderHeight?: (px: number) => void
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!onHeaderHeight || !ref.current) return;
    onHeaderHeight(ref.current.getBoundingClientRect().height);
  }, []);
}

// Transform карточки: центрирование и каскадный сдвиг
export function layerTransform(offsetX: number, offsetY: number, scale: number): string {
  return `translate(calc(-50% + 7.5vw - ${offsetX}px), calc(-50% - ${offsetY}px)) scale(${scale})`;
}

// Размер и позиция карточки: обычная (70x70) или fullscreen
export const CARD_WIDTH = 'var(--pp-card-w, 70vw)';
export const CARD_HEIGHT = 'var(--pp-card-h, 70vh)';

export function trafficLightZone(padding: number, contentWidth: number): number {
  const scale = getUiScale();
  return Math.max(padding*scale + contentWidth, padding*scale + TRAFFIC_LIGHT_WIDTH + 16*scale);
}

export function cardBoxStyle(isFullscreen: boolean, offsetX: number, offsetY: number, scale: number) {
  if (isFullscreen) {
    return {
      width: '100vw',
      height: '100vh',
      transform: `translate(-50%, -50%) scale(${scale})`,
      borderRadius: 0,
    };
  }
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    transform: layerTransform(offsetX, offsetY, scale),
    borderRadius: '1rem',
  };
}

// Плавный переход для fullscreen-разворота
export const FULLSCREEN_TRANSITION =
  'width 0.6s cubic-bezier(0.4, 0, 0.2, 1), height 0.6s cubic-bezier(0.4, 0, 0.2, 1), ' +
  'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.6s ease, opacity 0.3s ease';

// Ширина заголовка для зоны наведения светофора
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const measured = ref.current?.offsetWidth ?? 0;
    if (measured && measured !== width) setWidth(measured);
  });
  return width;
}

// Сдвиг тултипа, чтобы он не выходил за края окна
export function useTooltipEdgeOffset(show: boolean, margin = 8) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    if (!show) {
      setOffset(0);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const boundary = el.closest('.pp-modal');
    const bounds = boundary
      ? boundary.getBoundingClientRect()
      : { left: 0, right: window.innerWidth };
    let delta = 0;
    if (rect.left < bounds.left + margin) {
      delta = (bounds.left + margin) - rect.left;
    } else if (rect.right > bounds.right - margin) {
      delta = (bounds.right - margin) - rect.right;
    }
    setOffset(delta);
  }, [show, margin]);
  return { wrapRef, arrowOffset: offset };
}
