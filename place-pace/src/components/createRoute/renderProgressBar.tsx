import { DEFAULT_CAP_HEADER_HEIGHT, trafficLightZone } from '../layerGeometry';
import { getUiScale } from '../../utils/uiScale';
import TrafficLight from '../TrafficLight';
import React from 'react';

export interface RenderProgressBarContext {
  currentStep: number;
  effectiveFullscreen: boolean;
  labelTimer: number | null;
  onClose: () => void;
  onToggleFullscreen: () => void;
  progressBarRef: React.RefObject<HTMLDivElement | null>;
  setLabelTimer: React.Dispatch<React.SetStateAction<number | null>>;
  setShowLabels: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTrafficLight: React.Dispatch<React.SetStateAction<boolean>>;
  showLabels: boolean;
  showTrafficLight: boolean;
  steps: string[];
}

// Прогресс-бар (и в окне, и на экране ожидания оптимизации)
export const renderProgressBar = (ctx: RenderProgressBarContext, attachRef = false) => {
  const { currentStep, effectiveFullscreen, labelTimer, onClose, onToggleFullscreen, progressBarRef, setLabelTimer, setShowLabels, setShowTrafficLight, showLabels, showTrafficLight, steps } = ctx;
  return (
  <div
    ref={attachRef ? progressBarRef : undefined}
    style={{ height: DEFAULT_CAP_HEADER_HEIGHT, borderBottom: '1px solid #f3f4f6', position: 'relative' }}
    onMouseEnter={() => {
      if (labelTimer) clearTimeout(labelTimer);
      const timer = setTimeout(() => setShowLabels(true), 150);
      setLabelTimer(timer);
    }}
    onMouseMove={(e) => {
      // Зона светофора: кружок шага 1 и левый отступ, не уже светофора
      const rect = e.currentTarget.getBoundingClientRect();
      setShowTrafficLight(e.clientX - rect.left <= trafficLightZone(28, 32 * getUiScale()));
    }}
    onMouseLeave={() => {
      if (labelTimer) {
        clearTimeout(labelTimer);
        setLabelTimer(null);
      }
      setShowLabels(false);
      setShowTrafficLight(false);
    }}
  >
    <div
      className="absolute inset-0 transition-opacity duration-150"
      style={{
        padding: '1.5rem 1.75rem 1rem 1.75rem',
        opacity: showTrafficLight ? 0 : 1,
        transitionDelay: showTrafficLight ? '0ms' : '150ms',
      }}
    >
    <div className="relative flex items-center justify-between">
      <div
        className="absolute top-1/2 left-0 right-0 h-0.5 -translate-y-1/2 transition-opacity duration-150"
        style={{
          backgroundColor: showLabels ? 'transparent' : '#e5e7eb',
          opacity: showLabels ? 0 : 1
        }}
      />

      <div
        className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 transition-opacity duration-150"
        style={{
          width: `${(currentStep / (steps.length - 1)) * 100}%`,
          backgroundColor: showLabels ? 'transparent' : '#007AFF',
          opacity: showLabels ? 0 : 1,
          zIndex: 1
        }}
      />

      <div className="relative flex justify-between w-full" style={{ zIndex: 2 }}>
        {steps.map((step, index) => {
          let color = '#9ca3af';
          if (index === currentStep) color = '#007AFF';
          else if (index < currentStep) color = '#111827';

          return (
            <div key={index} className="flex flex-col items-center">
              <div
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: '50%',
                  position: 'relative',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  whiteSpace: 'nowrap',
                  backgroundColor: 'white'
                }}
              >
                {/* Номер и название шага кроссфейдятся */}
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color,
                    opacity: showLabels ? 0 : 1,
                    transition: showLabels
                      ? 'opacity 0.15s ease, color 0.3s ease'
                      : 'opacity 0.3s ease 0.15s, color 0.3s ease',
                  }}
                >
                  {index + 1}
                </span>
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color,
                    opacity: showLabels ? 1 : 0,
                    transition: showLabels
                      ? 'opacity 0.3s ease 0.15s, color 0.3s ease'
                      : 'opacity 0.15s ease, color 0.3s ease',
                  }}
                >
                  {step}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </div>

    {/* Светофор заменяет всё содержимое прогресс-бара */}
    <div
      className="absolute inset-0 flex items-center transition-opacity duration-150"
      style={{
        paddingLeft: '1.75rem',
        opacity: showTrafficLight ? 1 : 0,
        transitionDelay: showTrafficLight ? '150ms' : '0ms',
        pointerEvents: showTrafficLight ? 'auto' : 'none',
      }}
    >
      <TrafficLight
        onClose={onClose}
        fullscreenAvailable
        isFullscreen={effectiveFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    </div>
  </div>
);
};
