// Мини-карта маршрута: синяя ломаная и пины по точкам (общая карта на приложение)
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapFillIcon } from './sfSymbols';
import { useTranslation } from '../i18n/LanguageContext';
import { claimSharedMap, releaseSharedMap } from '../services/sharedRouteMap';
import { extractRouteCoords } from '../utils/routeCoords';
import { useUiScale } from '../utils/uiScale';
import { api } from '../api/client';

const LINE_COLOR = '#007AFF';
const LINE_WIDTH = 4;
const FIT_MARGIN = 28;
const MAX_FIT_ZOOM = 16;
const SINGLE_POINT_ZOOM = 15;
const RESIZE_DEBOUNCE_MS = 120;

const PIN_SIZE = 22;
const pinTemplate = (size: number) =>
  `<div style="width:${size}px;height:${size}px;font-size:${size}px;line-height:${size}px;text-align:center;user-select:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35));">📍</div>`;

interface RouteMiniMapProps {
  routeData: any[] | null | undefined;
  // false - карту не запрашиваем (не тратим квоту)
  active?: boolean;
}

const RouteMiniMap = ({ routeData, active = true }: RouteMiniMapProps) => {
  const { t } = useTranslation();
  const uiScale = useUiScale();
  const wrapRef = useRef<HTMLDivElement>(null);
  // fadeRef - внешний слой с прозрачностью, containerRef - контейнер карты Яндекса
  const fadeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const pinsRef = useRef<any>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const [grantedMap, setGrantedMap] = useState<any>(null);
  const claimantIdRef = useRef({});
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // Карта проявляется только после успешной отрисовки линии
  const setMapVisible = (visible: boolean) => {
    if (fadeRef.current) fadeRef.current.style.opacity = visible ? '1' : '0';
  };

  const coords = useMemo(() => extractRouteCoords(routeData), [routeData]);
  const coordsKey = useMemo(() => coords.map(c => c.join(',')).join(';'), [coords]);
  const hasCoords = coords.length > 0;

  const clearDrawn = () => {
    const map = mapRef.current;
    if (map) {
      try {
        if (lineRef.current) map.geoObjects.remove(lineRef.current);
        if (pinsRef.current) map.geoObjects.remove(pinsRef.current);
      } catch {
        // карта уже недоступна - нечего освобождать
      }
    }
    lineRef.current = null;
    pinsRef.current = null;
    fitRef.current = null;
    mapRef.current = null;
  };

  useEffect(() => {
    let alive = true;
    api.getAppSettings()
      .then((s) => { if (alive) setEnabled(s.route_mini_map_enabled !== false); })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (enabled !== true || !active || !hasCoords) return;
    const id = claimantIdRef.current;
    claimSharedMap({
      id,
      getContainer: () => containerRef.current,
      onGranted: (map) => setGrantedMap(map),
      onRevoked: () => {
        clearDrawn();
        setMapVisible(false);
        setGrantedMap(null);
      },
    });
    return () => {
      clearDrawn();
      setMapVisible(false);
      releaseSharedMap(id);
      setGrantedMap(null);
    };
    // clearDrawn/setMapVisible работают только с ref-ами
  }, [enabled, active, hasCoords]);

  useEffect(() => {
    const map = grantedMap;
    if (!map || !window.ymaps || !hasCoords) return;
    mapRef.current = map;
    try {
      map.container.fitToViewport();
      if (lineRef.current) {
        map.geoObjects.remove(lineRef.current);
        lineRef.current = null;
      }
      if (pinsRef.current) {
        map.geoObjects.remove(pinsRef.current);
        pinsRef.current = null;
      }

      const pinSize = PIN_SIZE * uiScale;
      // Верхний отступ при подгонке больше остальных: пин рисуется ВЫШЕ своей координаты
      const fitMargin = [FIT_MARGIN * uiScale + pinSize, FIT_MARGIN * uiScale, FIT_MARGIN * uiScale, FIT_MARGIN * uiScale];

      if (coords.length === 1) {
        fitRef.current = () => map.setCenter(coords[0], SINGLE_POINT_ZOOM, { duration: 0 });
      } else {
        const line = new window.ymaps.Polyline(coords, {}, {
          strokeColor: LINE_COLOR,
          strokeWidth: LINE_WIDTH,
          strokeOpacity: 0.95,
          interactivityModel: 'default#transparent',
        });
        map.geoObjects.add(line);
        lineRef.current = line;
        fitRef.current = () => {
          map.setBounds(line.geometry.getBounds(), {
            checkZoomRange: true,
            zoomMargin: fitMargin,
            duration: 0,
          }).then(() => {
            if (map.getZoom() > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
          }).catch(() => {
            // подгонка не удалась - карта остаётся на прежнем положении
          });
        };
      }

      const pinLayout = window.ymaps.templateLayoutFactory.createClass(pinTemplate(pinSize));
      const pins = new window.ymaps.GeoObjectCollection();
      const seen = new Set<string>();
      for (const point of coords) {
        const key = point.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        pins.add(new window.ymaps.Placemark(point, {}, {
          iconLayout: pinLayout,
          iconOffset: [-pinSize / 2, -(pinSize - 2 * uiScale)],
          interactivityModel: 'default#transparent',
          hasBalloon: false,
          hasHint: false,
        }));
      }
      map.geoObjects.add(pins);
      pinsRef.current = pins;

      fitRef.current();
      setMapVisible(true);
    } catch {
      setMapVisible(false);
    }
    // coords сравниваем по содержимому (coordsKey)
  }, [grantedMap, coordsKey, uiScale]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!grantedMap || !el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          mapRef.current?.container.fitToViewport();
          fitRef.current?.();
        } catch {
          // карта уже уничтожена
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [grantedMap]);

  return (
    <div
      ref={wrapRef}
      className="flex-1 relative bg-gray-200 rounded-xl overflow-hidden text-gray-400 text-sm"
      // isolation - Safari иначе игнорирует скругление у содержимого с transform (ymaps)
      style={{ isolation: 'isolate' }}
    >
      {/* Заглушка - всегда под картой, см. комментарий в начале файла */}
      <div className="absolute inset-0 flex items-center justify-center gap-1.5">
        <MapFillIcon size={16} />
        {t('Карта маршрута')}
      </div>
      <div
        ref={fadeRef}
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: 0 }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};

export default RouteMiniMap;
