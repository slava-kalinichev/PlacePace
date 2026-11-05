// Загрузка Yandex Maps JS API и дневная квота

declare global {
  interface Window {
    ymaps: any;
  }
}

const API_URL = `https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=${import.meta.env.VITE_YANDEX_MAPS_API_KEY}`;

// Дневная квота загрузок карты (счётчик в localStorage)
const DAILY_QUOTA = 100;
const QUOTA_STORAGE_KEY = 'pp_yandex_map_quota';

// Время ожидания инициализации карты (мс)
export const MAP_LOAD_TIMEOUT_MS = 8000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// true, если квота не исчерпана (счётчик увеличивается до попытки)
export function tryConsumeMapQuota(): boolean {
  let stored: { date: string; count: number } | null;
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }

  const today = todayKey();
  const count = stored?.date === today ? stored.count : 0;
  if (count >= DAILY_QUOTA) return false;

  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify({ date: today, count: count + 1 }));
  } catch {
    // Без localStorage карту не блокируем
  }
  return true;
}

// Общий промис загрузки; при ошибке сбрасывается
let apiPromise: Promise<any> | null = null;

export function loadYandexMapsApi(): Promise<any> {
  if (window.ymaps) {
    return new Promise((resolve) => window.ymaps.ready(() => resolve(window.ymaps)));
  }
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = API_URL;
      script.async = true;
      script.onload = () => {
        if (!window.ymaps) {
          apiPromise = null;
          reject(new Error('ymaps is not available after script load'));
          return;
        }
        window.ymaps.ready(() => resolve(window.ymaps));
      };
      script.onerror = () => {
        apiPromise = null;
        script.remove();
        reject(new Error('Failed to load Yandex Maps API'));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}
