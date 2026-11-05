import React from 'react';
import { ForkKnifeIcon } from '../sfSymbols';
import { useTranslation } from '../../i18n/LanguageContext';
import { LEG_COLLAPSE_EASE, LEG_MORPH_DURATION_MS } from './transportModeTypes';
import { MAX_RESTAURANT_VISIT_MINUTES, MIN_RESTAURANT_VISIT_MINUTES, RESTAURANT_ACCENT_BG, RESTAURANT_NEW_POINT_BORDER_COLOR, type RestaurantCandidate, formatRestaurantDistance, formatRestaurantRating, restaurantDurationTrackBackground } from './restaurantModel';

// Граница вместо ring (box-shadow на <tr> не рисуется)
export const RestaurantSlotNewPointRow = ({
  draggable, onDragStart, onDragEnd, dragging, onClick, gapKey, active, label,
}: {
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  // Клик по маркеру открывает редактор слота
  onClick?: () => void;
  // Ключ собственного зазора точки (для drag-and-drop)
  gapKey?: string;
  // Курсор ближе к этой строке - подсветка ярче
  active?: boolean;
  // Подпись: "Новая точка маршрута" или "Данная точка маршрута"
  label?: string;
} = {}) => {
  const { t } = useTranslation();
  return (
  <tr data-row-id="marker" data-gap-key={gapKey}>
    <td
      colSpan={4}
      className="pl-3 pr-3 py-2"
      style={{
        backgroundColor: RESTAURANT_ACCENT_BG,
        border: `1px solid ${active ? '#3B82F6' : RESTAURANT_NEW_POINT_BORDER_COLOR}`,
        transition: 'border-color 0.15s ease',
      }}
    >
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className="flex items-start gap-3 select-none"
        style={{
          cursor: draggable ? 'grab' : (onClick ? 'pointer' : undefined),
          opacity: dragging ? 0.4 : 1,
          transition: 'opacity 0.15s ease',
        }}
      >
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <ForkKnifeIcon color="#000000" size={18} />
        </div>
        <div className="text-sm text-gray-500">
          <div>{label ?? t('Новая точка маршрута')}</div>
          <div className="text-xs invisible">&nbsp;</div>
        </div>
      </div>
    </td>
  </tr>
  );
};

// Строка кандидата в "Подходящие места"
export const RestaurantCandidateRow = ({
  candidate, active, expanded, visitMinutes, isFirst, isLast, onSelect, onVisitMinutesChange, onHoverStart, onHoverEnd,
}: {
  candidate: RestaurantCandidate;
  active: boolean;
  expanded: boolean;
  visitMinutes: number;
  // Первая и последняя строки списка скругляются по контейнеру
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onVisitMinutesChange: (minutes: number) => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) => {
  const { t, language } = useTranslation();
  return (
  <div className="select-none" onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd}>
    <button
      onClick={onSelect}
      className={`w-full flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors select-none ${
        isFirst ? 'rounded-t-xl' : ''
      } ${isLast && !expanded ? 'rounded-b-xl' : ''} ${
        active ? 'bg-white ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-100'
      }`}
    >
      <span className={`text-sm font-medium ${active ? 'text-blue-600' : 'text-gray-700'}`}>{candidate.name}</span>
      <span className="text-xs text-gray-400">
        {t('Рейтинг: ')}{formatRestaurantRating(candidate.rating)} · {formatRestaurantDistance(candidate.distanceMeters, language)}
      </span>
    </button>
    <div
      className="overflow-hidden"
      style={{
        maxHeight: expanded ? 56 : 0,
        opacity: expanded ? 1 : 0,
        transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out`,
      }}
    >
      <div className="px-3 py-2 flex items-center gap-3 select-none">
        <input
          type="range"
          min={MIN_RESTAURANT_VISIT_MINUTES}
          max={MAX_RESTAURANT_VISIT_MINUTES}
          step={5}
          value={visitMinutes}
          onChange={(e) => onVisitMinutesChange(parseInt(e.target.value, 10))}
          className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-blue-500 select-none"
          style={{ background: restaurantDurationTrackBackground(visitMinutes) }}
        />
        <span className="text-xs text-gray-500 whitespace-nowrap select-none">{t('Посещение: ')}{visitMinutes} {t('мин')}</span>
      </div>
    </div>
  </div>
  );
};
