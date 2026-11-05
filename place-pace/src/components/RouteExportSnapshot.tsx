// Офскрин-таблица маршрута для экспорта в PDF
import type { RefObject, ReactNode } from 'react';
import { TransportTimeline } from './TransportTimeline';
import { displayedWorkTime } from '../utils/workHours';

interface RouteExportSnapshotProps {
  exportRef: RefObject<HTMLDivElement | null>;
  title: string;
  dateLabel: string;
  pointsCount: number;
  durationLabel: string;
  totalCostLabel: string;
  peopleCount: number;
  routeData: any[];
  renderIcon: (item: any) => ReactNode;
}

const POINT_BLOCK_BG = '#F9FAFB';
const PLAIN_BLOCK_BG = 'transparent';

// Общие ширины колонок для вложенных таблиц
const ColumnGroup = () => (
  <colgroup>
    <col style={{ width: '4%' }} />
    <col style={{ width: '58%' }} />
    <col style={{ width: '19%' }} />
    <col style={{ width: '19%' }} />
  </colgroup>
);

export const RouteExportSnapshot = ({
  exportRef,
  title,
  dateLabel,
  pointsCount,
  durationLabel,
  totalCostLabel,
  peopleCount,
  routeData,
  renderIcon,
}: RouteExportSnapshotProps) => (
  <div ref={exportRef} style={{ position: 'fixed', left: '-10000px', top: 0, width: '900px', background: '#ffffff', padding: '32px' }}>
    <img
      src="/images/pp_logo.png"
      alt=""
      style={{ position: 'absolute', top: '32px', right: '32px', width: '48px', height: 'auto' }}
    />
    <h2 style={{ fontSize: '22px', fontWeight: 600, color: '#1f2937', marginBottom: '4px', paddingRight: '64px' }}>{title}</h2>
    <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>Дата прохождения: {dateLabel}</p>
    <div style={{ display: 'flex', gap: '32px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f3f4f6' }}>
      <div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>Количество точек посещения</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{pointsCount}</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>Общее время</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{durationLabel}</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>Общая стоимость</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{totalCostLabel}</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>Количество человек</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1f2937' }}>{peopleCount}</div>
      </div>
    </div>

    <table className="w-full" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        {routeData.map((item) => {
          const isStart = item.type === 'start';
          const isEnd = item.type === 'end';
          const isTransport = item.type === 'transport';
          const isAttraction = item.type === 'attraction';
          const isFood = item.type === 'food';
          const isUserDefined = item.isUserDefined;
          const hasExpandRow = isAttraction || isFood || isTransport;
          const blockBg = (isAttraction || isFood) ? POINT_BLOCK_BG : PLAIN_BLOCK_BG;
          // Поправка высоты иконки (пин ниже остальных)
          const iconOffsetPx = item.icon === 'pin' ? -3 : 5;

          let visitDurationLabel = '';
          if ((isAttraction || isFood) && item.time && item.endTime && item.endTime !== '-') {
            const [vh, vm] = item.time.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            let diff = (eh * 60 + em) - (vh * 60 + vm);
            if (diff < 0) diff += 1440;
            visitDurationLabel = `${diff} мин`;
          }

          const expandedCostLabel = item.cost > 0 ? `${item.cost * peopleCount}₽` : '';
          const transportDurationLabel = isTransport && item.travelTime != null ? `${item.travelTime} мин` : '';

          let textColor = 'text-gray-800';
          if (isAttraction) textColor = 'text-blue-500';
          else if (isTransport) textColor = 'text-gray-500';
          else if (isUserDefined || isFood) textColor = 'text-gray-800';

          // Строка и её раскрытие - один блок (для разрезов PDF)
          return (
            <tr key={item.id} data-row-block={item.id}>
              <td className="p-0" colSpan={4}>
                <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', background: blockBg }}>
                  <ColumnGroup />
                  <tbody>
                    <tr>
                      <td className="py-2 pr-3 w-8 text-gray-600" style={{ verticalAlign: 'top' }}>
                        {/* table-cell вместо flex для центрирования (html2canvas) */}
                        <div style={{ display: 'table', width: '20px', height: '20px' }}>
                          <div style={{ display: 'table-cell', verticalAlign: 'middle', textAlign: 'center' }}>
                            <div style={{ position: 'relative', top: `${iconOffsetPx}px` }}>
                              {renderIcon(item)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`py-2 pr-3 text-sm ${textColor}`} style={{ verticalAlign: 'top' }}>
                        {isTransport && item.compoundParts ? (
                          <div className="flex flex-col">
                            <div>{item.name}</div>
                            {item.compoundParts.map((part: string, partIdx: number) => (
                              <div key={partIdx} className="text-gray-400 text-xs">
                                {partIdx === 0 ? part : `→ ${part}`}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {item.name}
                            {isTransport && item.description && (
                              <span className="text-gray-400 text-xs ml-1">{item.description}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-sm text-gray-800 whitespace-nowrap" style={{ verticalAlign: 'top' }}>
                        {isStart ? (
                          <div className="text-gray-600">Старт: {item.time}</div>
                        ) : isEnd ? (
                          <>
                            <div className="text-gray-600">Финиш: {item.time}</div>
                            {item.endTime && item.endTime !== '-' && item.endTime !== '--:--' && (
                              <div className="text-xs text-gray-400">→ {item.endTime}</div>
                            )}
                          </>
                        ) : isTransport ? (
                          <>
                            <div className="text-gray-500">{item.time}</div>
                            <div className="text-xs text-gray-400">→ {item.endTime}</div>
                          </>
                        ) : (
                          <>
                            <div>{item.time}</div>
                            {item.endTime && item.endTime !== '-' && (
                              <div className="text-xs text-gray-400">до {item.endTime}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-2 text-sm text-gray-800 whitespace-nowrap" style={{ verticalAlign: 'top' }}>
                        {item.cost > 0 && (
                          <span>{item.cost}₽ × {peopleCount}</span>
                        )}
                      </td>
                    </tr>
                    {hasExpandRow && (
                      <tr>
                        <td className="p-0" />
                        <td className="p-0">
                          {isTransport ? (
                            <div className="pr-3 pb-2">
                              <TransportTimeline item={item} />
                            </div>
                          ) : (
                            <div className="pr-3 pb-2 text-sm">
                              <div className="text-gray-600">Адрес: {item.address || 'не указан'}</div>
                              {displayedWorkTime(item) && displayedWorkTime(item) !== '-' && (
                                <div className="text-gray-500 text-xs mt-0.5">Время работы: {displayedWorkTime(item)}</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-0">
                          <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">
                            {isTransport ? transportDurationLabel : visitDurationLabel}
                          </div>
                        </td>
                        <td className="p-0">
                          <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">{expandedCostLabel}</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
