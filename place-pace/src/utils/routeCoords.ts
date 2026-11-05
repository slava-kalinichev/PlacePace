// Координаты точек маршрута для мини-карты

type LatLon = [number, number];

const isFiniteIn = (v: unknown, limit: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

// Точки с координатами по порядку, без подряд идущих дублей
export function extractRouteCoords(routeData: any[] | null | undefined): LatLon[] {
  const coords: LatLon[] = [];
  for (const item of routeData ?? []) {
    if (!isFiniteIn(item?.latitude, 90) || !isFiniteIn(item?.longitude, 180)) continue;
    const last = coords[coords.length - 1];
    if (last && last[0] === item.latitude && last[1] === item.longitude) continue;
    coords.push([item.latitude, item.longitude]);
  }
  return coords;
}
