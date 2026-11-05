// Определение устройства: десктоп или On It (по UA, ширине и тачскрину)
const MOBILE_UA_RE = /iPhone|iPod|iPad|Android|Mobile|BlackBerry|IEMobile|Opera Mini|Windows Phone/i;
// Порог ширины совпадает с брейкпоинтом md в Tailwind
const MOBILE_VIEWPORT_MAX_WIDTH = 768;

type DeviceKind = 'mobile' | 'desktop';

// iPadOS Safari маскируется под Mac, отличаем по maxTouchPoints
function isMasqueradingIPad(): boolean {
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function detectDeviceKind(): DeviceKind {
  if (MOBILE_UA_RE.test(navigator.userAgent) || isMasqueradingIPad()) return 'mobile';
  return window.innerWidth < MOBILE_VIEWPORT_MAX_WIDTH ? 'mobile' : 'desktop';
}

// Скрытый отладочный параметр ?force=desktop|onit
export function resolveForceOverride(): DeviceKind | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('force')?.toLowerCase();
  if (raw !== 'desktop' && raw !== 'onit') return null;

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('force');
  window.history.replaceState({}, '', cleanUrl.toString());

  return raw === 'desktop' ? 'desktop' : 'mobile';
}
