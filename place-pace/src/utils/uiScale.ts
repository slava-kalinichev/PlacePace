// Масштаб интерфейса десктопа под размер окна (эталон - ноутбук 16", масштаб 1)

import { useSyncExternalStore } from 'react';

// Эталонное окно, где масштаб равен 1
const UI_SCALE_REF_WIDTH = 1728;
const UI_SCALE_REF_HEIGHT = 744;

// Границы масштаба
const UI_SCALE_MIN = 0.7;
const UI_SCALE_MAX = 1.2;
// Масштаб по ширине смягчён степенью 0.5
const UI_SCALE_WIDTH_EXPONENT = 0.5;
// Мёртвая зона вокруг 1.0
const UI_SCALE_SNAP = 0.04;
const BASE_FONT_PX = 16;

// Масштаб = минимум из ограничений по ширине (смягчённого) и высоте
function computeUiScale(width: number, height: number): number {
  const byWidth = Math.pow(width / UI_SCALE_REF_WIDTH, UI_SCALE_WIDTH_EXPONENT);
  const byHeight = height / UI_SCALE_REF_HEIGHT;
  const scale = Math.min(byWidth, byHeight);
  if (Math.abs(scale - 1) <= UI_SCALE_SNAP) return 1;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, scale)) * 100) / 100;
}

// Отладка: ?ui-scale=0.85
function readOverride(): number | null {
  const raw = new URLSearchParams(window.location.search).get('ui-scale');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : null;
}

// Отладка: ?ui-debug показывает размер окна и масштаб
function hasDebugBadge(): boolean {
  return new URLSearchParams(window.location.search).has('ui-debug');
}

let suspended = false;
let refresh: (() => void) | null = null;

// Текущий фактический масштаб (1 - в On It и при отключении)
let currentScale = 1;
const scaleListeners = new Set<() => void>();

function setCurrentScale(scale: number) {
  if (scale === currentScale) return;
  currentScale = scale;
  scaleListeners.forEach((listener) => listener());
}

export function getUiScale(): number {
  return currentScale;
}

function subscribeUiScale(listener: () => void): () => void {
  scaleListeners.add(listener);
  return () => { scaleListeners.delete(listener); };
}

// Хук: перерисовка при смене масштаба
export function useUiScale(): number {
  return useSyncExternalStore(subscribeUiScale, getUiScale, getUiScale);
}

function applyScale(scale: number) {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(scale));
  // При масштабе 1 inline-размер не ставим
  root.style.fontSize = scale === 1 ? '' : `${BASE_FONT_PX * scale}px`;
  setCurrentScale(scale);
}

// Возвращает функцию отписки (в приложении не нужна, оставлена для тестов)
export function installUiScale(): () => void {
  const root = document.documentElement;
  root.dataset.ui = 'desktop';
  const override = readOverride();

  let badge: HTMLDivElement | null = null;
  if (hasDebugBadge()) {
    badge = document.createElement('div');
    badge.setAttribute('data-ui-debug', '');
    badge.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483000;padding:3px 8px;border-radius:6px;' +
      'background:rgba(15,23,42,0.85);color:#fff;font:11px/1.4 ui-monospace,Menlo,monospace;' +
      'pointer-events:none;white-space:nowrap;';
    document.body.appendChild(badge);
  }

  const update = () => {
    if (suspended) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = override ?? computeUiScale(w, h);
    applyScale(scale);
    if (badge) badge.textContent = `${w}\u00d7${h} \u00b7 scale ${scale}`;
  };
  refresh = update;
  update();

  // rAF-троттлинг: при перетаскивании края окна resize приходит очень часто
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(frame);
    refresh = null;
    badge?.remove();
    delete root.dataset.ui;
    root.style.fontSize = '';
    root.style.removeProperty('--ui-scale');
    setCurrentScale(1);
  };
}

// Отключает масштаб на время fn (для экспорта PDF)
export async function withUiScaleSuspended<T>(fn: () => Promise<T>): Promise<T> {
  const root = document.documentElement;
  if (!root.style.fontSize) return fn();
  suspended = true;
  root.style.fontSize = '';
  setCurrentScale(1);
  try {
    return await fn();
  } finally {
    suspended = false;
    refresh?.();
  }
}
