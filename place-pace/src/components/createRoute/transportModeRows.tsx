import React, { useState } from 'react';
import { InfoCircleIcon } from '../sfSymbols';
import { useTooltipEdgeOffset } from '../layerGeometry';
import { LEG_COLLAPSE_EASE, LEG_MORPH_DURATION_MS } from './transportModeTypes';

// Строка тумблера в "Опции передвижения"
export const TransportOptionRow = ({ label, info, checked, onToggle, tooltipPlacement = 'bottom' }: {
  label: string;
  info: string;
  checked: boolean;
  onToggle: () => void;
  // Где открывается тултип: 'bottom' или 'top'
  tooltipPlacement?: 'top' | 'bottom';
}) => {
  const [showInfo, setShowInfo] = useState(false);
  const { wrapRef, arrowOffset } = useTooltipEdgeOffset(showInfo);
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 select-none">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 select-none">{label}</span>
        <div className="relative">
          <button
            onMouseEnter={() => setShowInfo(true)}
            onMouseLeave={() => setShowInfo(false)}
            className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
          >
            <InfoCircleIcon size={18} />
          </button>
          {showInfo && (
            <div
              ref={wrapRef}
              className={`pp-tooltip-wrap absolute ${tooltipPlacement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-0 z-10 w-64`}
              style={{ transform: `translateX(${arrowOffset}px)` }}
            >
              <div className="pp-tooltip">
                {info}
              </div>
              <div
                className={`pp-tooltip-arrow ${tooltipPlacement === 'top' ? 'pp-tooltip-arrow--bottom' : 'pp-tooltip-arrow--top'}`}
                style={{ left: `calc(1rem - ${arrowOffset}px)` }}
              />
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-[#007AFF]' : 'bg-gray-300'
        }`}
      >
        <div className={`absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all ${checked ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}`} />
      </button>
    </div>
  );
};

// Строка подрежима (радиокнопка внутри тумблера)
export const SubmodeRow = ({ label, icon, active, onClick }: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors select-none ${
      active ? 'bg-white ring-1 ring-blue-400' : 'hover:bg-gray-100'
    }`}
  >
    {icon && <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">{icon}</div>}
    {/* Единое начертание у активного и неактивного подрежима */}
    <span className={`text-sm font-medium ${active ? 'text-blue-600' : 'text-gray-700'}`}>{label}</span>
  </button>
);

// Раскрывающаяся панель подрежимов
export const SubmodeExpandPanel = ({ expanded, children }: { expanded: boolean; children: React.ReactNode }) => (
  <div
    className="overflow-hidden bg-gray-50/70 rounded-lg"
    style={{
      maxHeight: expanded ? 160 : 0,
      opacity: expanded ? 1 : 0,
      marginBottom: expanded ? 8 : 0,
      transition: `max-height ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}, opacity ${LEG_MORPH_DURATION_MS}ms ease-out, margin-bottom ${LEG_MORPH_DURATION_MS}ms ${LEG_COLLAPSE_EASE}`,
    }}
  >
    <div className="p-1.5 space-y-0.5">{children}</div>
  </div>
);
