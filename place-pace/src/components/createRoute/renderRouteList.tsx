import React from 'react';
import { LEG_MORPH_DURATION_MS, LEG_COLLAPSE_EASE, LEG_OPTION_LABELS, LEG_MORPH_EASE, type LegOption, OPTION_STAGGER_MS, type PendingLegOverride } from './transportModeTypes';
import { RESTAURANT_NEW_POINT_BORDER_COLOR, RESTAURANT_ACCENT_BG } from './restaurantModel';
import { TransportTimeline } from '../TransportTimeline';
import { displayedWorkTime } from '../../utils/workHours';

export interface RenderRouteListContext {
  expandedRow: number | null;
  formatDuration: (startTime: string, endTime: string) => string;
  getIconForType: (_type: string, icon: string) => React.JSX.Element | null;
  handleLegRowClick: (item: any) => void;
  handleRowMouseEnter: (id: number) => void;
  handleRowMouseLeave: (id: number, e: React.MouseEvent) => void;
  legOptions: LegOption[] | undefined;
  pendingLegOverrides: Map<string, PendingLegOverride>;
  pendingOverrideRowHeights: React.RefObject<Map<string, number>>;
  peopleCount: number;
  pickerRevealed: boolean;
  rememberedOriginalOptions: Map<string, LegOption>;
  routeData: any[];
  routeListContainerRef: React.RefObject<HTMLDivElement | null>;
  selectedLegId: string | number | null;
  setPendingLegOverrides: React.Dispatch<React.SetStateAction<Map<string, PendingLegOverride>>>;
  slowFetchHintVisible: boolean;
  t: (ru: string) => string;
  transportAccentReady: boolean;
}

// interactive=true - левая панель "Режим передвижения"
export const renderRouteList = (ctx: RenderRouteListContext, interactive: boolean = false) => {
  const { expandedRow, formatDuration, getIconForType, handleLegRowClick, handleRowMouseEnter, handleRowMouseLeave, legOptions, pendingLegOverrides, pendingOverrideRowHeights, peopleCount, pickerRevealed, rememberedOriginalOptions, routeData, routeListContainerRef, selectedLegId, setPendingLegOverrides, slowFetchHintVisible, t, transportAccentReady } = ctx;
  const totalCost = Math.round(routeData.reduce((sum, item) => sum + (item.cost || 0), 0) * peopleCount);
  const firstTime = routeData.length > 0 ? routeData[0].time : '--:--';
  const lastTime = routeData.length > 0 ? routeData[routeData.length - 1].time : '--:--';
  const duration = formatDuration(firstTime, lastTime);

  // Порядок строк не меняется при выборе перегона
  const displayData = routeData;

  // Схлопывание ячейки строки при выборе перегона
  const getRowCollapseStyle = (hidden: boolean, openMaxHeight: number, minHeightOverride?: number): React.CSSProperties => ({
    maxHeight: hidden ? 0 : Math.max(openMaxHeight, minHeightOverride || 0),
    minHeight: hidden ? 0 : (minHeightOverride || undefined),
    opacity: hidden ? 0 : 1,
    overflow: 'hidden',
    paddingTop: hidden ? 0 : 8,
    paddingBottom: hidden ? 0 : 8,
    transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out, padding ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        // Верхние углы контейнера прямые, пока выбран перегон
        className={`flex-1 overflow-y-auto ${interactive ? `border border-gray-200 rounded-b-xl ${selectedLegId === null ? 'rounded-t-xl' : ''}` : ''}`}
        ref={interactive ? routeListContainerRef : undefined}
      >
        <table className="w-full">
          <tbody>
            {displayData.map((item, _index) => {
              const isStart = item.type === 'start';
              const isEnd = item.type === 'end';
              const isTransport = item.type === 'transport';
              const isAttraction = item.type === 'attraction';
              const isFood = item.type === 'food';
              const isUserDefined = item.isUserDefined;
              const isExpanded = expandedRow === item.id;
              const isSelectedLeg = interactive && isTransport && selectedLegId === item.id;
              const isSelectableLeg = interactive && isTransport;
              // Остальные строки схлопываются, пока настраивается один перегон
              const isHiddenBehindSelection = interactive && selectedLegId !== null && item.id !== selectedLegId;

              // Длительность осмотра для расширенной строки
              let visitDurationLabel = '';
              if ((isAttraction || isFood) && item.time && item.endTime && item.endTime !== '-') {
                const [vh, vm] = item.time.split(':').map(Number);
                const [eh, em] = item.endTime.split(':').map(Number);
                let diff = (eh * 60 + em) - (vh * 60 + vm);
                if (diff < 0) diff += 1440;
                visitDurationLabel = `${diff} ${t('мин')}`;
              }

              // Суммарная стоимость для расширенной строки
              const totalCostForItem = Math.round(item.cost * peopleCount);
              const expandedCostLabel = item.cost > 0
                ? `${item.costApproximate ? '~' : ''}${totalCostForItem}₽`
                : '';
              // Такси считается на машину (до 4 пассажиров)
              const taxiCarCount = Math.max(1, Math.ceil(peopleCount / 4));
              const collapsedCostLabel = item.cost <= 0 ? '' : item.costApproximate
                ? (taxiCarCount > 1
                    ? `~${Math.round(totalCostForItem / taxiCarCount)}₽ x ${taxiCarCount}`
                    : `~${totalCostForItem}₽`)
                : `${Math.round(item.cost)}₽ × ${peopleCount}`;
              const transportDurationLabel = isTransport && item.travelTime != null ? `${item.travelTime} ${t('мин')}` : '';

              // Строка показывает новый вид транспорта из чернового выбора
              const pendingOverrideKey = `${item.fromId}-${item.toId}`;
              const pendingOverrideForRow = pendingLegOverrides.get(pendingOverrideKey) || null;
              const pendingOverrideRowHeight = pendingOverrideForRow
                ? pendingOverrideRowHeights.current.get(pendingOverrideKey)
                : undefined;

              let textColor = 'text-gray-800';
              if (isAttraction) textColor = 'text-blue-500';
              else if (isTransport) textColor = 'text-gray-500';
              else if (isUserDefined || isFood) textColor = 'text-gray-800';

              // Акцент строк поездок в "Режим передвижения"
              const isAccentRow = interactive && isTransport && !isHiddenBehindSelection && transportAccentReady;
              const accentColor = isSelectedLeg ? '#3B82F6' : RESTAURANT_NEW_POINT_BORDER_COLOR;
              // Скругление угла выбранной строки без border-radius
              const getTransportAccentCellStyle = (edge: 'first' | 'middle' | 'last'): React.CSSProperties | undefined => {
                if (!isAccentRow) return undefined;
                return {
                  backgroundColor: RESTAURANT_ACCENT_BG,
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
                    className={`group transition-all duration-300 ${
                      isHiddenBehindSelection
                        // Схлопнутая строка без фона, чтобы не оставалось цветных полос
                        ? 'cursor-default'
                        : isSelectableLeg
                        ? 'cursor-pointer'
                        : `cursor-default hover:bg-gray-50/50 ${isExpanded ? 'bg-gray-50/50' : ''}`
                    }`}
                    onClick={isSelectableLeg && !isHiddenBehindSelection ? () => handleLegRowClick(item) : undefined}
                    onMouseEnter={isSelectableLeg ? undefined : () => handleRowMouseEnter(item.id)}
                    onMouseLeave={isSelectableLeg ? undefined : (e) => handleRowMouseLeave(item.id, e)}
                    style={{ pointerEvents: isHiddenBehindSelection ? 'none' : undefined }}
                  >
                    <td className={`${interactive ? 'pl-3' : ''} pr-3 w-8 text-gray-600 align-top`} style={getTransportAccentCellStyle('first')}>
                      <div style={getRowCollapseStyle(isHiddenBehindSelection, 40, pendingOverrideRowHeight)}>
                        {/* Бокс фиксированного размера для иконок */}
                        <div className="w-5 h-5 flex items-center justify-center">
                          {getIconForType(item.type, pendingOverrideForRow ? pendingOverrideForRow.option.key : item.icon)}
                        </div>
                      </div>
                    </td>
                    <td className={`pr-3 text-sm ${textColor} align-top`} style={getTransportAccentCellStyle('middle')}>
                      <div style={getRowCollapseStyle(isHiddenBehindSelection, 76, pendingOverrideRowHeight)}>
                        {pendingOverrideForRow ? (
                          // Только название нового вида транспорта, без остановок
                          t(LEG_OPTION_LABELS[pendingOverrideForRow.option.key] || pendingOverrideForRow.option.key)
                        ) : isTransport && item.compoundParts ? (
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
                      </div>
                    </td>
                    <td className="pr-3 text-sm text-gray-800 whitespace-nowrap align-top" style={getTransportAccentCellStyle('middle')}>
                      <div style={getRowCollapseStyle(isHiddenBehindSelection, 52, pendingOverrideRowHeight)}>
                        {pendingOverrideForRow ? (
                          <div className="text-gray-400">-</div>
                        ) : isStart ? (
                          <>
                            <div className="text-gray-600">Старт: {item.time}</div>
                            {/* Невидимая вторая строка для одинаковой высоты */}
                            <div className="text-xs invisible">&nbsp;</div>
                          </>
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
                      </div>
                    </td>
                    <td className={`text-sm text-gray-800 whitespace-nowrap align-top ${interactive ? 'pr-3' : ''}`} style={getTransportAccentCellStyle('last')}>
                      <div style={getRowCollapseStyle(isHiddenBehindSelection, 40, pendingOverrideRowHeight)}>
                        {pendingOverrideForRow ? (
                          <span className="text-gray-400">-</span>
                        ) : (
                          collapsedCostLabel && <span>{collapsedCostLabel}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {(isAttraction || isFood || (isTransport && !interactive)) && (() => {
                    // max-height близок к высоте контента
                    const expandTransition = isExpanded
                      ? 'max-height 0.55s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.55s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.45s ease-out'
                      : 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-in-out';
                    const expandStyle = {
                      transition: expandTransition,
                      maxHeight: isExpanded ? '2.75rem' : '0px',
                      minHeight: isExpanded ? '2.75rem' : '0px',
                      opacity: isExpanded ? 1 : 0,
                    };
                    // Фон на контейнере с overflow-hidden
                    return (
                      <tr
                        data-row-id={item.id}
                        onMouseEnter={() => handleRowMouseEnter(item.id)}
                        onMouseLeave={(e) => handleRowMouseLeave(item.id, e)}
                      >
                        <td className="p-0">
                          <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                            &nbsp;
                          </div>
                        </td>
                        <td className="p-0">
                          <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                            {isTransport ? (
                              <div className="pr-3 pb-2">
                                <TransportTimeline item={item} />
                              </div>
                            ) : (
                              <div className="pr-3 pb-2 text-sm">
                                <div className="text-gray-600">
                                  {t('Адрес: ')}{item.address || t('не указан')}
                                </div>
                                {displayedWorkTime(item) && displayedWorkTime(item) !== '-' && (
                                  <div className="text-gray-500 text-xs mt-0.5">
                                    {t('Время работы: ')}{displayedWorkTime(item)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-0">
                          <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                            <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">
                              {isTransport ? transportDurationLabel : visitDurationLabel}
                            </div>
                          </div>
                        </td>
                        <td className="p-0">
                          <div className="overflow-hidden bg-gray-50/50" style={expandStyle}>
                            <div className="pr-3 pb-2 text-sm text-gray-600 whitespace-nowrap">
                              {expandedCostLabel}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {isSelectedLeg && !pickerRevealed && slowFetchHintVisible && (
                    <tr data-row-id={`${item.id}-loading`}>
                      <td colSpan={4} className="p-0">
                        <div className="text-xs text-gray-400 text-center py-2 select-none">
                          {t('Загрузка доступных видов транспорта..')}
                        </div>
                      </td>
                    </tr>
                  )}
                  {isSelectedLeg && (() => {
                    // Панель вариантов монтируется со строкой, раскрывается по pickerRevealed
                    const pickerStyle = {
                      transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_MORPH_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out`,
                      maxHeight: pickerRevealed ? 420 : 0,
                      opacity: pickerRevealed ? 1 : 0,
                    };
                    const taxiCarCount = Math.max(1, Math.ceil(peopleCount / 4));
                    const optionCostLabel = (opt: LegOption) => {
                      if (opt.cost <= 0) return t('Бесплатно');
                      if (opt.key === 'taxi') {
                        return taxiCarCount > 1 ? `~${opt.cost}₽ x ${taxiCarCount}` : `~${opt.cost}₽`;
                      }
                      return `${opt.cost_approximate ? '~' : ''}${opt.cost}₽`;
                    };
                    // Список вариантов не бывает пустым (текущий вариант всегда есть)
                    const currentKey: string = item.icon;
                    const fetched = legOptions || [];
                    const optionsList: (LegOption & { isCurrent?: boolean })[] = fetched.map(o => ({
                      ...o, isCurrent: o.key === currentKey,
                    }));
                    if (!optionsList.some(o => o.key === currentKey)) {
                      optionsList.push({
                        key: currentKey,
                        duration_seconds: (item.travelTime || 0) * 60,
                        distance_m: item.distance ?? null,
                        cost: item.cost || 0,
                        cost_approximate: !!item.costApproximate,
                        legs: item.legs || null,
                        description: item.description,
                        isCurrent: true,
                      });
                    }
                    // Запомненная исходная составная поездка
                    const rememberedOriginal = rememberedOriginalOptions.get(`${item.fromId}-${item.toId}`);
                    if (rememberedOriginal && !optionsList.some(o => o.key === 'transmode')) {
                      optionsList.push({ ...rememberedOriginal, isCurrent: false });
                    }
                    const KEY_ORDER = ['walk', 'metro', 'mcd', 'bus', 'tram', 'taxi_economy', 'taxi_comfort', 'taxi_business', 'ferry', 'transmode'];
                    optionsList.sort((a, b) => KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key));
                    const activeOverrideKey = pendingOverrideForRow ? pendingOverrideForRow.option.key : null;
                    return (
                      <tr data-row-id={`${item.id}-picker`}>
                        <td colSpan={4} className="p-0">
                          <div className="overflow-hidden bg-blue-50/40 border-t border-blue-100" style={pickerStyle}>
                            <div className="p-3">
                              <div className="space-y-1">
                                {optionsList.map((opt, optionIndex) => {
                                  const isActive = activeOverrideKey ? opt.key === activeOverrideKey : !!opt.isCurrent;
                                  return (
                                    <button
                                      key={opt.key}
                                      style={{
                                        // Варианты появляются по очереди
                                        opacity: pickerRevealed ? 1 : 0,
                                        transform: pickerRevealed ? 'translateY(0)' : 'translateY(6px)',
                                        transition: `opacity 320ms ease-out ${optionIndex * OPTION_STAGGER_MS}ms, transform 320ms ${LEG_MORPH_EASE} ${optionIndex * OPTION_STAGGER_MS}ms`,
                                      }}
                                      onClick={() => {
                                        if (opt.isCurrent) {
                                          // Клик по текущему варианту убирает черновик
                                          setPendingLegOverrides(prev => {
                                            if (!prev.has(pendingOverrideKey)) return prev;
                                            const next = new Map(prev);
                                            next.delete(pendingOverrideKey);
                                            return next;
                                          });
                                        } else {
                                          // Запоминаем высоту строки до компактного превью
                                          const rowEl = routeListContainerRef.current?.querySelector(`[data-row-id="${item.id}"]`);
                                          if (rowEl) {
                                            pendingOverrideRowHeights.current.set(pendingOverrideKey, rowEl.getBoundingClientRect().height);
                                          }
                                          setPendingLegOverrides(prev => {
                                            const next = new Map(prev);
                                            next.set(pendingOverrideKey, {
                                              fromId: item.fromId, toId: item.toId,
                                              fromName: item.fromPlace, toName: item.toPlace,
                                              option: opt,
                                            });
                                            return next;
                                          });
                                        }
                                      }}
                                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors select-none ${
                                        isActive ? 'bg-white ring-1 ring-blue-400' : 'hover:bg-white/70'
                                      }`}
                                    >
                                      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                                        {getIconForType('transport', opt.key)}
                                      </div>
                                      <span className={`text-sm flex-shrink-0 ${opt.isCurrent ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                                        {t(LEG_OPTION_LABELS[opt.key] || opt.key)}
                                      </span>
                                      <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                                        {Math.round(opt.duration_seconds / 60)} {t('мин')}{opt.cost > 0 ? ` · ${optionCostLabel(opt)}` : ''}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              {legOptions === undefined && (
                                <div className="text-xs text-gray-400 select-none mt-2 px-2.5">{t('Ищем другие варианты...')}</div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex gap-8">
        <div>
          <span className="text-xs text-gray-400">{t('Общее время:')}</span>
          <span className="ml-2 text-sm font-medium text-gray-800">{duration}</span>
        </div>
        <div>
          <span className="text-xs text-gray-400">{t('Общая стоимость:')}</span>
          <span className="ml-2 text-sm font-medium text-gray-800">{totalCost} ₽</span>
        </div>
      </div>
    </div>
  );
};
