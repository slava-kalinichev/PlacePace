

export interface BuildFullRouteContext {
  deriveTransportRow: (travelMode: string, fromName: string, toName: string, legFare?: number, fromAddressOverride?: string, toAddressOverride?: string) => { transportMode: string; transportIcon: string; description: string; compoundParts: string[] | null; taxiTariff: "economy" | "comfort" | "business" | null; transportCost: number; isApproximateCost: boolean; };
  endPoint: string;
  endPointCoords: { lat: number; lon: number; } | null;
  endPointToggle: boolean;
  endWithStartPoint: boolean;
  isSavedHomeAddress: (address: string) => boolean;
  minutesToTime: (minutes: number) => string;
  startPoint: string;
  startPointCoords: { lat: number; lon: number; } | null;
  startPointToggle: boolean;
  startTime: string;
  t: (ru: string) => string;
  timeToMinutes: (timeStr: string) => number;
}

// Собирает список для отображения на шаге "Персонализация" из ответа бэкенда
export const buildFullRoute = (ctx: BuildFullRouteContext, result: any, placesUsed: any[], matrix: number[][], distances: number[][], modes: string[][], details: (any[] | null)[][], startTerminalIndex: number | null, endTerminalIndex: number | null) => {
  const { deriveTransportRow, endPoint, endPointCoords, endPointToggle, endWithStartPoint, isSavedHomeAddress, minutesToTime, startPoint, startPointCoords, startPointToggle, startTime, t, timeToMinutes } = ctx;
  const fullRoute: any[] = [];
  let currentTime = timeToMinutes(startTime);

  const orderedPlaces = result.order.map((id: number) =>
    placesUsed.find(p => p.id === id)
  ).filter(Boolean);

  // Иконка дома только у реального адресного терминала
  const startIsHome = !startPointToggle && startPoint.trim().length > 0;
  const endIsTerminal = !endPointToggle && !endWithStartPoint && endPoint.trim().length > 0;
  const endIsReturnToStart = endWithStartPoint && startPoint.trim().length > 0;
  const finishIsHome = endIsTerminal || endIsReturnToStart;
  // Реальный адрес стартового терминала для подписей
  const startAddressLabelRaw = startIsHome
    ? (isSavedHomeAddress(startPoint) ? 'Дом / Отель' : startPoint)
    : (orderedPlaces[0]?.address || 'первая точка');
  const startAddressLabel = t(startAddressLabelRaw);

  fullRoute.push({
    id: 'start',
    name: `${t('Старт')} (${startAddressLabel})`,
    type: 'start',
    icon: startIsHome ? 'home' : 'start',
    address: startPointToggle ? t('Согласовано с первой точкой') : startPoint,
    workTime: '-',
    time: startTime,
    endTime: result.schedule[0]?.arrival || startTime,
    cost: 0,
    isUserDefined: true,
    rawAddressLabel: startAddressLabelRaw,
    // Координаты терминала или первой точки
    latitude: startPointCoords?.lat ?? orderedPlaces[0]?.latitude,
    longitude: startPointCoords?.lon ?? orderedPlaces[0]?.longitude
  });

  // Плечо от стартового терминала до первой точки
  if (startTerminalIndex !== null && orderedPlaces.length > 0) {
    const firstIndex = placesUsed.findIndex(p => p.id === orderedPlaces[0].id);
    const travelTime = matrix[startTerminalIndex]?.[firstIndex] || 0;
    const travelDistance = distances[startTerminalIndex]?.[firstIndex] || 0;
    const travelMode = modes[startTerminalIndex]?.[firstIndex] || 'пешком';
    const travelLegs = details?.[startTerminalIndex]?.[firstIndex] || null;
    const { transportMode, transportIcon, description, compoundParts, transportCost, isApproximateCost } =
      deriveTransportRow(travelMode, 'Старт', orderedPlaces[0].name, result.transit_start_terminal_fare || 0, startAddressLabelRaw);

    const departureTime = timeToMinutes(startTime);
    const arrivalTime = departureTime + travelTime;

    fullRoute.push({
      id: 'transport_start_terminal',
      name: transportMode,
      type: 'transport',
      icon: transportIcon,
      description,
      compoundParts,
      legs: travelLegs,
      time: minutesToTime(departureTime),
      endTime: minutesToTime(arrivalTime),
      cost: transportCost,
      costApproximate: isApproximateCost,
      isUserDefined: false,
      distance: travelDistance,
      travelTime,
      // Сырая строка travelMode (нужна для ручной настройки перегона)
      rawTravelMode: travelMode,
      // Нужны Preview.tsx для пересчёта описания при смене языка
      fromAddressOverride: startAddressLabelRaw,
      toAddressOverride: undefined,
      fromPlace: 'Старт',
      toPlace: orderedPlaces[0].name,
      // id и координаты перегона для ручной настройки
      fromId: 'start-terminal',
      toId: orderedPlaces[0].id,
      fromCoords: startPointCoords,
      toCoords: { lat: orderedPlaces[0].latitude, lon: orderedPlaces[0].longitude }
    });
  }

  for (let i = 0; i < orderedPlaces.length; i++) {
    const place = orderedPlaces[i];

    if (i > 0) {
      const prevPlace = orderedPlaces[i - 1];
      const prevIndex = placesUsed.findIndex(p => p.id === prevPlace.id);
      const currIndex = placesUsed.findIndex(p => p.id === place.id);

      const travelTime = matrix[prevIndex]?.[currIndex] || 0;
      const travelDistance = distances[prevIndex]?.[currIndex] || 0;
      const travelMode = modes[prevIndex]?.[currIndex] || 'пешком';
      const travelLegs = details?.[prevIndex]?.[currIndex] || null;

      const departureTime = currentTime;
      const { transportMode, transportIcon, description, compoundParts, transportCost, isApproximateCost } =
        deriveTransportRow(travelMode, prevPlace.name, place.name, result.transit_leg_fares?.[i - 1] ?? 0);
      const arrivalTime = departureTime + travelTime;

      fullRoute.push({
        id: `transport_${i}`,
        name: transportMode,
        type: 'transport',
        icon: transportIcon,
        description,
        compoundParts,
        legs: travelLegs,
        time: minutesToTime(departureTime),
        endTime: minutesToTime(arrivalTime),
        cost: transportCost,
        costApproximate: isApproximateCost,
        isUserDefined: false,
        distance: travelDistance,
        travelTime,
        rawTravelMode: travelMode,
        fromPlace: prevPlace.name,
        toPlace: place.name,
        fromId: prevPlace.id,
        toId: place.id,
        fromCoords: { lat: prevPlace.latitude, lon: prevPlace.longitude },
        toCoords: { lat: place.latitude, lon: place.longitude }
      });

      // Время начала осмотра берём из решения бэкенда
      const scheduledArrival = result.schedule[i]?.arrival;
      currentTime = scheduledArrival ? timeToMinutes(scheduledArrival) : arrivalTime;
    } else {
      // Первая точка: реальное время прибытия из решения бэкенда
      const firstArrival = result.schedule[0]?.arrival;
      if (firstArrival) {
        currentTime = timeToMinutes(firstArrival);
      }
    }

    const placeDuration = place.recommended_duration || 60;
    const arrivalTime = currentTime;
    const departureTime = currentTime + placeDuration;

    fullRoute.push({
      id: place.id,
      name: place.name,
      type: 'attraction',
      icon: 'pin',
      address: place.address || t('Адрес не указан'),
      workTime: place.work_time || '-',
      // Часы работы на дату маршрута, по которым построено расписание (для показа)
      workTimeDay: result.work_hours?.[String(place.id)] ?? undefined,
      time: minutesToTime(arrivalTime),
      endTime: minutesToTime(departureTime),
      cost: place.ticket_price || 0,
      isUserDefined: false,
      duration: placeDuration,
      // Координаты нужны окну "Рестораны и кафе"
      latitude: place.latitude,
      longitude: place.longitude
    });

    currentTime = departureTime;
  }

  // Плечо от последней точки до конечного терминала
  if (endTerminalIndex !== null && orderedPlaces.length > 0) {
    const lastPlace = orderedPlaces[orderedPlaces.length - 1];
    const lastIndex = placesUsed.findIndex(p => p.id === lastPlace.id);
    const travelTime = matrix[lastIndex]?.[endTerminalIndex] || 0;
    const travelDistance = distances[lastIndex]?.[endTerminalIndex] || 0;
    const travelMode = modes[lastIndex]?.[endTerminalIndex] || 'пешком';
    const travelLegs = details?.[lastIndex]?.[endTerminalIndex] || null;
    const toLabel = endIsReturnToStart ? 'Старт' : 'Финиш';
    // Реальный адрес конечного терминала для подписей
    const endAddressLabelRaw = endIsReturnToStart
      ? (isSavedHomeAddress(startPoint) ? 'Дом / Отель' : startPoint)
      : endIsTerminal
        ? (isSavedHomeAddress(endPoint) ? 'Дом / Отель' : endPoint)
        : (lastPlace?.address || 'последняя точка');
    const { transportMode, transportIcon, description, compoundParts, transportCost, isApproximateCost } =
      deriveTransportRow(travelMode, lastPlace.name, toLabel, result.transit_end_terminal_fare || 0, undefined, endAddressLabelRaw);

    const departureTime = currentTime;
    const arrivalTime = departureTime + travelTime;

    fullRoute.push({
      id: 'transport_end_terminal',
      name: transportMode,
      type: 'transport',
      icon: transportIcon,
      description,
      compoundParts,
      legs: travelLegs,
      time: minutesToTime(departureTime),
      endTime: minutesToTime(arrivalTime),
      cost: transportCost,
      costApproximate: isApproximateCost,
      isUserDefined: false,
      distance: travelDistance,
      travelTime,
      rawTravelMode: travelMode,
      // Нужны Preview.tsx для пересчёта описания при смене языка
      fromAddressOverride: undefined,
      toAddressOverride: endAddressLabelRaw,
      fromPlace: lastPlace.name,
      toPlace: toLabel,
      fromId: lastPlace.id,
      toId: endIsReturnToStart ? 'start-terminal' : 'end-terminal',
      fromCoords: { lat: lastPlace.latitude, lon: lastPlace.longitude },
      toCoords: endIsReturnToStart ? startPointCoords : endPointCoords
    });

    currentTime = arrivalTime;
  }

  const lastOrderedPlace = orderedPlaces[orderedPlaces.length - 1];
  // Адрес без перевода (rawAddressLabel)
  const endAddressLabelRaw = endIsReturnToStart
    ? (isSavedHomeAddress(startPoint) ? 'Дом / Отель' : startPoint)
    : endIsTerminal
      ? (isSavedHomeAddress(endPoint) ? 'Дом / Отель' : endPoint)
      : (lastOrderedPlace?.address || 'последняя точка');
  fullRoute.push({
    id: 'end',
    name: `${t('Финиш')} (${t(endAddressLabelRaw)})`,
    type: 'end',
    icon: finishIsHome ? 'home' : 'finish',
    rawAddressLabel: endAddressLabelRaw,
    address: endPointToggle
      ? t('Согласовано с последней точкой')
      : endIsReturnToStart
        ? startPoint
        : endPoint,
    workTime: '-',
    time: minutesToTime(currentTime),
    // endTime у финиша - служебный плейсхолдер
    endTime: '--:--',
    cost: 0,
    isUserDefined: true,
    // См. аналогичный комментарий у 'start' выше
    latitude: (endIsReturnToStart ? startPointCoords?.lat : endPointCoords?.lat) ?? lastOrderedPlace?.latitude,
    longitude: (endIsReturnToStart ? startPointCoords?.lon : endPointCoords?.lon) ?? lastOrderedPlace?.longitude
  });

  return fullRoute;
};
