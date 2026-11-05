// Единственная Яндекс-карта на все мини-карты маршрута (создание карты тарифицируется)
import { loadYandexMapsApi, tryConsumeMapQuota, MAP_LOAD_TIMEOUT_MS } from './yandexMaps';

interface SharedMapClaimant {
  // Уникальный ключ владельца (один и тот же объект на всё время жизни компонента)
  id: object;
  // Элемент, в который нужно поставить карту (null - ещё не смонтирован)
  getContainer: () => HTMLElement | null;
  onGranted: (map: any) => void;
  onRevoked: () => void;
}

let sharedMap: any = null;
let mapNode: HTMLDivElement | null = null;
let creating: Promise<any> | null = null;
const stack: SharedMapClaimant[] = [];

function createMap(firstContainer: HTMLElement): Promise<any> {
  if (sharedMap) return Promise.resolve(sharedMap);
  if (creating) return creating;
  if (!tryConsumeMapQuota()) return Promise.resolve(null);

  creating = new Promise<any>((resolve) => {
    let timedOut = false;
    const timeoutId = setTimeout(() => { timedOut = true; resolve(null); }, MAP_LOAD_TIMEOUT_MS);

    loadYandexMapsApi().then((ymaps) => {
      clearTimeout(timeoutId);
      if (timedOut) return;
      try {
        mapNode = document.createElement('div');
        mapNode.style.width = '100%';
        mapNode.style.height = '100%';
        firstContainer.appendChild(mapNode);
        sharedMap = new ymaps.Map(
          mapNode,
          {
            center: [55.7558, 37.6173],
            zoom: 12,
            // Масштабирование и полноэкранный режим
            controls: ['zoomControl', 'fullscreenControl'],
            behaviors: ['drag', 'scrollZoom', 'dblClickZoom', 'multiTouch'],
          },
          {
            suppressMapOpenBlock: true,
            yandexMapDisablePoiInteractivity: true,
          },
        );
        resolve(sharedMap);
      } catch {
        mapNode = null;
        sharedMap = null;
        resolve(null);
      }
    }).catch(() => {
      clearTimeout(timeoutId);
      resolve(null);
    });
  }).finally(() => { creating = null; });

  return creating;
}

function grantTop() {
  const top = stack[stack.length - 1];
  if (!top) return;
  const container = top.getContainer();
  if (!container) return;

  createMap(container).then((map) => {
    // За время загрузки владелец мог смениться или уйти
    if (!map || !mapNode || stack[stack.length - 1] !== top) return;
    const target = top.getContainer();
    if (!target) return;
    if (mapNode.parentElement !== target) target.appendChild(mapNode);
    try {
      map.container.fitToViewport();
    } catch {
      // карта уже недоступна
    }
    top.onGranted(map);
  });
}

// Запросить карту (повторный вызов возвращает владельца на вершину)
export function claimSharedMap(claimant: SharedMapClaimant) {
  const existing = stack.findIndex(c => c.id === claimant.id);
  if (existing !== -1) stack.splice(existing, 1);
  const previousTop = stack[stack.length - 1];
  stack.push(claimant);
  previousTop?.onRevoked();
  grantTop();
}

// Владелец больше не показывает карту; саму карту не уничтожать
export function releaseSharedMap(id: object) {
  const index = stack.findIndex(c => c.id === id);
  if (index === -1) return;
  const wasTop = index === stack.length - 1;
  stack.splice(index, 1);
  if (!wasTop) return;
  mapNode?.remove();
  grantTop();
}
