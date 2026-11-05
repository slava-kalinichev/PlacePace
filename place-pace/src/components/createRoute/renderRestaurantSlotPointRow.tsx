import React from 'react';
import { RESTAURANT_NEW_POINT_BORDER_COLOR, RESTAURANT_ACCENT_BG } from './restaurantModel';

export interface RenderRestaurantSlotPointRowContext {
  getIconForType: (_type: string, icon: string) => React.JSX.Element | null;
  getRestaurantRowCollapseStyle: (hidden: boolean, openMaxHeight: number) => React.CSSProperties;
  handleRestaurantRowMouseEnter: (id: number | string) => void;
  handleRestaurantRowMouseLeave: (id: number | string, e: React.MouseEvent) => void;
  peopleCount: number;
  restaurantExpandedRowId: string | number | null;
  t: (ru: string) => string;
}

export const renderRestaurantSlotPointRow = (ctx: RenderRestaurantSlotPointRowContext, item: any, options?: {
    // Строка вне слота схлопнута, но остаётся в DOM (для FLIP)
    hidden?: boolean;
    // Только применённая точка питания перетаскивается
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    dragging?: boolean;
    // Клик по применённой точке открывает редактор слота
    onRowClick?: () => void;
    // Синий акцент у применённой точки питания
    accent?: boolean;
    accentActive?: boolean;
    // Ключ собственного зазора (для drag-and-drop)
    gapKey?: string;
    // Hover-expand отключён при редактировании слота
    noExpand?: boolean;
  }) => {
  const { getIconForType, getRestaurantRowCollapseStyle, handleRestaurantRowMouseEnter, handleRestaurantRowMouseLeave, peopleCount, restaurantExpandedRowId, t } = ctx;
  const isStart = item.type === 'start';
  const isEnd = item.type === 'end';
  const isAttraction = item.type === 'attraction';
  const isFood = item.type === 'food';
  const isUserDefined = item.isUserDefined;
  const isExpanded = !options?.noExpand && restaurantExpandedRowId === item.id;
  const hidden = !!options?.hidden;

  let visitDurationLabel = '';
  if ((isAttraction || isFood) && item.time && item.endTime && item.endTime !== '-') {
    const [vh, vm] = item.time.split(':').map(Number);
    const [eh, em] = item.endTime.split(':').map(Number);
    let diff = (eh * 60 + em) - (vh * 60 + vm);
    if (diff < 0) diff += 1440;
    visitDurationLabel = `${diff} ${t('мин')}`;
  }

  const totalCostForItem = Math.round((item.cost || 0) * peopleCount);
  const expandedCostLabel = item.cost > 0 ? `${item.costApproximate ? '~' : ''}${totalCostForItem}₽` : '';
  const collapsedCostLabel = item.cost > 0 ? `${Math.round(item.cost)}₽ × ${peopleCount}` : '';

  let textColor = 'text-gray-800';
  if (isAttraction) textColor = 'text-blue-500';
  else if (isUserDefined || isFood) textColor = 'text-gray-800';

  // Старт и финиш не разворачиваются
  const isHoverable = (isAttraction || isFood) && !options?.noExpand;

  const expandTransition = isExpanded
    ? 'max-height 0.55s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.55s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.45s ease-out'
    : 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-in-out';
  const expandStyle: React.CSSProperties = {
    transition: expandTransition,
    maxHeight: isExpanded && !hidden ? '2.75rem' : '0px',
    minHeight: isExpanded && !hidden ? '2.75rem' : '0px',
    opacity: isExpanded && !hidden ? 1 : 0,
  };

  const clickableOrDraggable = !!options?.draggable || !!options?.onRowClick;
  const accent = !!options?.accent;
  // Цвет границы акцента
  const accentColor = options?.accentActive ? '#3B82F6' : RESTAURANT_NEW_POINT_BORDER_COLOR;
  const accentBg = RESTAURANT_ACCENT_BG;
  const getAccentCellStyle = (edge: 'first' | 'middle' | 'last'): React.CSSProperties => {
    if (!accent) return {};
    return {
      backgroundColor: accentBg,
      borderTop: `1px solid ${accentColor}`,
      borderBottom: `1px solid ${accentColor}`,
      borderLeft: edge === 'first' ? `1px solid ${accentColor}` : undefined,
      borderRight: edge === 'last' ? `1px solid ${accentColor}` : undefined,
      transition: 'border-color 0.15s ease',
    };
  };

  return (
    <React.Fragment key={item.id}>
      <tr
        data-row-id={item.id}
        data-gap-key={options?.gapKey}
        draggable={options?.draggable}
        onDragStart={options?.onDragStart}
        onDragEnd={options?.onDragEnd}
        onClick={options?.onRowClick}
        className={`group transition-all duration-300 ${hidden ? 'cursor-default' : !accent && isHoverable ? 'hover:bg-gray-50/50' : ''}`}
        onMouseEnter={!hidden && isHoverable ? () => handleRestaurantRowMouseEnter(item.id) : undefined}
        onMouseLeave={!hidden && isHoverable ? (e) => handleRestaurantRowMouseLeave(item.id, e) : undefined}
        style={{
          pointerEvents: hidden ? 'none' : undefined,
          opacity: hidden ? undefined : (options?.dragging ? 0.4 : 1),
          cursor: hidden ? undefined : (options?.draggable ? 'grab' : options?.onRowClick ? 'pointer' : 'default'),
          transition: clickableOrDraggable ? 'opacity 0.15s ease' : undefined,
        }}
      >
        <td className="pl-3 pr-3 w-8 text-gray-600 align-top" style={getAccentCellStyle('first')}>
          <div style={getRestaurantRowCollapseStyle(hidden, 40)}>
            <div className="w-5 h-5 flex items-center justify-center">
              {getIconForType(item.type, item.icon)}
            </div>
          </div>
        </td>
        <td className={`pr-3 text-sm ${textColor} align-top`} style={getAccentCellStyle('middle')}>
          <div style={getRestaurantRowCollapseStyle(hidden, 40)}>
            {item.name}
          </div>
        </td>
        <td className="pr-3 text-sm text-gray-800 whitespace-nowrap align-top" style={getAccentCellStyle('middle')}>
          <div style={getRestaurantRowCollapseStyle(hidden, 52)}>
            {isStart ? (
              <>
                <div className="text-gray-600">Старт: {item.time}</div>
                <div className="text-xs invisible">&nbsp;</div>
              </>
            ) : isEnd ? (
              <>
                <div className="text-gray-600">Финиш: {item.time}</div>
                {item.endTime && item.endTime !== '-' && item.endTime !== '--:--' ? (
                  <div className="text-xs text-gray-400">→ {item.endTime}</div>
                ) : (
                  // Невидимая вторая строка финиша
                  <div className="text-xs invisible">&nbsp;</div>
                )}
              </>
            ) : (
              <>
                <div>{item.time}</div>
                {item.endTime && item.endTime !== '-' ? (
                  <div className="text-xs text-gray-400">до {item.endTime}</div>
                ) : (
                  <div className="text-xs invisible">&nbsp;</div>
                )}
              </>
            )}
          </div>
        </td>
        <td className="pr-3 text-sm text-gray-800 whitespace-nowrap align-top" style={getAccentCellStyle('last')}>
          <div style={getRestaurantRowCollapseStyle(hidden, 40)}>
            {collapsedCostLabel && <span>{collapsedCostLabel}</span>}
          </div>
        </td>
      </tr>
      {isHoverable && (
        <tr
          data-row-id={item.id}
          onMouseEnter={!hidden ? () => handleRestaurantRowMouseEnter(item.id) : undefined}
          onMouseLeave={!hidden ? (e) => handleRestaurantRowMouseLeave(item.id, e) : undefined}
          style={{ pointerEvents: hidden ? 'none' : undefined }}
        >
          <td className="p-0">
            <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>&nbsp;</div>
          </td>
          <td className="p-0">
            <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
              <div className="pr-3 pb-2 text-sm">
                <div className="text-gray-600">{t('Адрес: ')}{item.address || t('не указан')}</div>
                {item.workTime && item.workTime !== '-' && (
                  <div className="text-gray-500 text-xs mt-0.5">{t('Время работы: ')}{item.workTime}</div>
                )}
              </div>
            </div>
          </td>
          <td className="p-0">
            <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
              <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">{visitDurationLabel}</div>
            </div>
          </td>
          <td className="p-0">
            <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
              <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">{expandedCostLabel}</div>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};
