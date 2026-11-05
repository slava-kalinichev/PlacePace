// Раскладка транспорта по плечам в раскрытой строке маршрута
import React from 'react';
import { TramFillIcon, BusFillIcon, LightrailFillIcon, FigureWalkIcon, FerryFillIcon, CarRearFillIcon } from './sfSymbols';

interface TimelineLeg {
  mode: string;
  duration_s: number;
}

interface TimelineStep {
  icon: string;
  isWalk: boolean;
  minutes: number;
}

const MODE_TO_ICON: Record<string, string> = {
  SUBWAY: 'metro',
  RAIL: 'metro',
  BUS: 'bus',
  TRAM: 'tram',
  FERRY: 'ferry',
  TRANSIT: 'metro',
};

const WALK_COLOR = '#9CA3AF';
const TRANSPORT_COLOR = '#374151';
// Цвета тарифов такси
const TAXI_TARIFF_COLOR: Record<string, string> = {
  taxi: '#F59E0B', taxi_economy: '#F59E0B', taxi_comfort: '#B0B8C1', taxi_business: '#000000',
};

// Распределение минут по плечам, остаток - в самое долгое плечо
function distributeMinutes(rawSeconds: number[], totalMinutes: number): number[] {
  if (rawSeconds.length === 0) return [];
  const minutes = rawSeconds.map(s => Math.max(1, Math.round(s / 60)));
  const diff = totalMinutes - minutes.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < rawSeconds.length; i++) {
      if (rawSeconds[i] > rawSeconds[largestIdx]) largestIdx = i;
    }
    minutes[largestIdx] = Math.max(1, minutes[largestIdx] + diff);
  }
  return minutes;
}

// Шаги раскладки по плечам или по частям описания
function buildTimelineSteps(item: any): TimelineStep[] {
  const totalMinutes = Math.max(0, item.travelTime ?? 0);
  const legs: TimelineLeg[] | null | undefined = item.legs;

  if (legs && legs.length > 0) {
    const minutes = distributeMinutes(legs.map(l => l.duration_s || 0), totalMinutes);
    return legs.map((leg, i) => {
      const isWalk = leg.mode === 'WALK';
      return {
        icon: isWalk ? 'walk' : (MODE_TO_ICON[leg.mode] || 'metro'),
        isWalk,
        minutes: minutes[i],
      };
    });
  }

  // Без структурных плеч делим составную поездку по частям описания
  if (item.compoundParts && item.compoundParts.length > 0) {
    const n = item.compoundParts.length;
    const even = Math.max(1, Math.floor(totalMinutes / n));
    const minutes = Array(n).fill(even);
    minutes[n - 1] += totalMinutes - even * n;
    return item.compoundParts.map((_: string, i: number) => ({
      icon: item.icon === 'transmode' ? 'metro' : item.icon,
      isWalk: false,
      minutes: Math.max(1, minutes[i]),
    }));
  }

  return [{
    icon: item.icon === 'walk' ? 'walk' : item.icon,
    isWalk: item.icon === 'walk',
    minutes: totalMinutes,
  }];
}

const ICON_COMPONENTS: Record<string, (color: string, size: number) => React.ReactNode> = {
  metro: (color, size) => <TramFillIcon color={color} size={size} />,
  bus: (color, size) => <BusFillIcon color={color} size={size} />,
  tram: (color, size) => <LightrailFillIcon color={color} size={size} />,
  ferry: (color, size) => <FerryFillIcon color={color} size={size} />,
  walk: (color, size) => <FigureWalkIcon color={color} size={size} />,
  // Иконка такси
  taxi: (color, size) => <CarRearFillIcon color={color} size={size} />,
  taxi_economy: (color, size) => <CarRearFillIcon color={color} size={size} />,
  taxi_comfort: (color, size) => <CarRearFillIcon color={color} size={size} />,
  taxi_business: (color, size) => <CarRearFillIcon color={color} size={size} />,
};

const TimelineConnector = () => (
  <div style={{ flex: 1, minWidth: '0.5rem', borderTop: '2px dashed #D1D5DB', marginTop: '0.5625rem', alignSelf: 'flex-start' }} />
);

const TimelineNode = ({ isPin, icon, color, minutes }: { isPin?: boolean; icon?: string; color?: string; minutes?: number }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
    <div style={{ width: '1.125rem', height: '1.125rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {isPin ? (
        <span style={{ fontSize: '0.8125rem', lineHeight: 1 }}>📍</span>
      ) : (
        ICON_COMPONENTS[icon || 'walk']?.(color || TRANSPORT_COLOR, 14)
      )}
    </div>
    {!isPin && (
      <span style={{ fontSize: '0.625rem', color, marginTop: '0.125rem', whiteSpace: 'nowrap' }}>{minutes}&rsquo;</span>
    )}
  </div>
);

// Растягивается на ширину колонки
export const TransportTimeline: React.FC<{ item: any }> = ({ item }) => {
  const steps = buildTimelineSteps(item);
  const soloWalk = steps.length === 1 && steps[0].isWalk;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      <TimelineNode isPin />
      {steps.map((step, i) => {
        const color = step.isWalk && !soloWalk ? WALK_COLOR : TAXI_TARIFF_COLOR[step.icon] || TRANSPORT_COLOR;
        return (
          <React.Fragment key={i}>
            <TimelineConnector />
            <TimelineNode icon={step.icon} color={color} minutes={step.minutes} />
          </React.Fragment>
        );
      })}
      <TimelineConnector />
      <TimelineNode isPin />
    </div>
  );
};
