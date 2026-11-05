import { useEffect, useRef, useState } from 'react';
import { MapFillIcon } from './sfSymbols';
import { loadYandexMapsApi, tryConsumeMapQuota, MAP_LOAD_TIMEOUT_MS } from '../services/yandexMaps';

// Фоновая карта (загрузка API иквота - в services/yandexMaps.ts)

const YandexMap = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  // ready остаётся false при исчерпанной квоте или сбое загрузки (тогда заглушка)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!tryConsumeMapQuota()) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => { cancelled = true; }, MAP_LOAD_TIMEOUT_MS);

    loadYandexMapsApi().then((ymaps) => {
      if (cancelled || !containerRef.current) return;
      try {
        new ymaps.Map(containerRef.current, {
          center: [55.7558, 37.6173],
          zoom: 12,
          // Декоративная подложка, не интерактивная карта - без controls
          controls: [],
        });
        clearTimeout(timeoutId);
        setReady(true);
      } catch {
        // остаётся заглушка
      }
    }).catch(() => {
      // остаётся заглушка
    });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-gray-300">
      <div ref={containerRef} id="yandex-map-container" className="w-full h-full" />
      {!ready && (
        // Отступ слева равен ширине свёрнутого routebar
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ paddingLeft: '15vw' }}
        >
          <MapFillIcon size={56} color="#9CA3AF" />
        </div>
      )}
    </div>
  );
};

export default YandexMap;
