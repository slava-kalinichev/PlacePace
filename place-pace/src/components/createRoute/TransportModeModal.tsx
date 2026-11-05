import React, { useState, useEffect, useRef } from 'react';
import { CarRearFillIcon, InfoCircleIcon } from '../sfSymbols';
import { useMeasuredWidth, useTooltipEdgeOffset, layerBoxShadow, layerScrimOpacity, cardBoxStyle, FULLSCREEN_TRANSITION, FULLSCREEN_Z, DEFAULT_HEADER_HEIGHT, trafficLightZone } from '../layerGeometry';
import TrafficLight from '../TrafficLight';
import { useTranslation } from '../../i18n/LanguageContext';
import { RESTAURANT_ACCENT_BG } from './restaurantModel';
import { SubmodeExpandPanel, SubmodeRow, TransportOptionRow } from './transportModeRows';
import { type TransportModeToggles } from './transportModeTypes';

// Экран "Режим передвижения" (открывается внутри САП)
export const TransportModeModal = ({
  isOpen,
  onClose,
  onRequestFullClose,
  onApply,
  ferryFeasible,
  initialToggles,
  routeTableContent,
  legSelected,
  hasPendingLegOverride,
  zIndex,
  offsetX,
  offsetY,
  isTop,
  depth,
  isFullscreen,
  onToggleFullscreen,
  suspended,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRequestFullClose?: () => void;
  // true - экран закрывается (успех или конфликт)
  onApply: (toggles: TransportModeToggles) => Promise<boolean>;
  ferryFeasible: boolean;
  // Применённое состояние тумблеров (экран открывается с него)
  initialToggles: TransportModeToggles;
  routeTableContent: React.ReactNode;
  // true - перегон выбран, подсказка скрыта
  legSelected: boolean;
  // Есть черновая ручная настройка перегона
  hasPendingLegOverride: boolean;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  isFullscreen: boolean;
  onToggleFullscreen?: () => void;
  suspended?: boolean;
}) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [publicTransit, setPublicTransit] = useState(initialToggles.publicTransit);
  const [publicTransitSubmode, setPublicTransitSubmode] = useState(initialToggles.publicTransitSubmode);
  const [taxi, setTaxi] = useState(initialToggles.taxi);
  const [taxiTariff, setTaxiTariff] = useState(initialToggles.taxiTariff);
  const [includeFerry, setIncludeFerry] = useState(initialToggles.includeFerry);
  const [walkPriority, setWalkPriority] = useState(initialToggles.walkPriority);
  const [noComposite, setNoComposite] = useState(initialToggles.noComposite);
  const [showHeaderTrafficLight, setShowHeaderTrafficLight] = useState(false);
  const [showAutoConfigInfo, setShowAutoConfigInfo] = useState(false);
  const { wrapRef: autoConfigInfoTooltipRef, arrowOffset: autoConfigInfoArrowOffset } = useTooltipEdgeOffset(showAutoConfigInfo);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      // Черновик тумблеров собирается заново при каждом открытии
      setPublicTransit(initialToggles.publicTransit);
      setPublicTransitSubmode(initialToggles.publicTransitSubmode);
      setTaxi(initialToggles.taxi);
      setTaxiTariff(initialToggles.taxiTariff);
      setIncludeFerry(initialToggles.includeFerry);
      setWalkPriority(initialToggles.walkPriority);
      setNoComposite(initialToggles.noComposite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Речной транспорт без фиче-чека отключается
  useEffect(() => {
    if (!ferryFeasible) setIncludeFerry(false);
  }, [ferryFeasible]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(), 300);
  };

  const handleApply = async () => {
    const shouldClose = await onApply({
      publicTransit, publicTransitSubmode, taxi, taxiTariff,
      includeFerry, walkPriority, noComposite,
    });
    if (shouldClose) handleClose();
  };

  const togglePublicTransit = () => setPublicTransit(prev => !prev);
  const toggleTaxi = () => setTaxi(prev => !prev);

  // Есть ли изменения автонастройки (для кнопки "Применить изменения")
  const hasAutoConfigChanges = publicTransit !== initialToggles.publicTransit
    || publicTransitSubmode !== initialToggles.publicTransitSubmode
    || taxi !== initialToggles.taxi
    || taxiTariff !== initialToggles.taxiTariff
    || includeFerry !== initialToggles.includeFerry
    || walkPriority !== initialToggles.walkPriority
    || noComposite !== initialToggles.noComposite;
  const hasChanges = hasAutoConfigChanges || hasPendingLegOverride;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center transition-opacity duration-300 select-none"
      style={{
        opacity: isVisible ? 1 : 0,
        zIndex: isFullscreen && isTop ? FULLSCREEN_Z + 20 : zIndex,
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}
    >
      {/* Невидимый перехватчик кликов под карточкой */}
      <div
        className="absolute inset-0"
        style={{
          pointerEvents: isTop && !suspended ? 'auto' : 'none',
        }}
        onClick={() => onRequestFullClose?.()}
      />
      <div
        className="pp-modal relative bg-white flex flex-col overflow-hidden select-none"
        style={{
          pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
          position: 'absolute',
          top: '50%',
          left: '50%',
          opacity: suspended ? 0 : (isVisible ? 1 : 0),
          boxShadow: layerBoxShadow(depth),
          transition: `${FULLSCREEN_TRANSITION}, box-shadow 0.3s ease`,
          ...cardBoxStyle(isFullscreen && isTop, offsetX, offsetY, isVisible ? 1 : 0.95),
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}
      >
        <div
          className="relative border-b border-gray-100 flex-shrink-0 select-none"
          style={{ height: DEFAULT_HEADER_HEIGHT }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setShowHeaderTrafficLight(e.clientX - rect.left <= trafficLightZone(24, titleWidth));
          }}
          onMouseLeave={() => setShowHeaderTrafficLight(false)}
        >
          <div
            className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150 select-none"
            style={{ opacity: showHeaderTrafficLight ? 0 : 1, transitionDelay: showHeaderTrafficLight ? '0ms' : '150ms' }}
          >
            <h2 ref={titleRef} className="text-xl font-semibold text-gray-800 select-none">{t('Режим передвижения')}</h2>
          </div>
          <div
            className="absolute inset-0 flex items-center pl-6 transition-opacity duration-150"
            style={{
              opacity: showHeaderTrafficLight ? 1 : 0,
              transitionDelay: showHeaderTrafficLight ? '150ms' : '0ms',
              pointerEvents: showHeaderTrafficLight ? 'auto' : 'none',
            }}
          >
            <TrafficLight
              onClose={() => onRequestFullClose?.()}
              fullscreenAvailable
              isFullscreen={isFullscreen && isTop}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        </div>

        {/* Двухколоночная вёрстка как на этапе "Персонализация" */}
        <div className="flex-1 flex gap-6 min-h-0 p-6 overflow-hidden select-none">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
              <h3 className="text-xs font-medium text-gray-400 select-none">{t('Настроить отдельно от точки к точке')}</h3>
            </div>
            {/* Синяя подсказка пропадает, когда перегон выбран */}
            {!legSelected && (
              // Цвет подсказки как в окне "Рестораны и кафе"
              <div
                className="px-4 py-2 mb-2 text-blue-500 text-xs text-center border-b border-blue-100/50 flex-shrink-0 select-none transition-opacity duration-300"
                style={{ backgroundColor: RESTAURANT_ACCENT_BG }}
              >
                {t('Нажмите на поездку, которую хотите настроить')}
              </div>
            )}
            {routeTableContent}
          </div>

          <div className={`flex flex-col flex-shrink-0 overflow-y-auto transition-[width] duration-500 ease-in-out ${isFullscreen && isTop ? 'w-[32.5rem]' : 'w-80'}`}>
            <h3 className="text-xs font-medium text-gray-400 mb-1 select-none">{t('Автонастройка')}</h3>
            <div className="flex flex-col">
              <TransportOptionRow
                label={t('Общественный транспорт')}
                info={t('Разрешить использование общественного транспорта')}
                checked={publicTransit}
                onToggle={togglePublicTransit}
              />
              <SubmodeExpandPanel expanded={publicTransit}>
                <SubmodeRow label={t('Оптимальный')} active={publicTransitSubmode === 'optimal'} onClick={() => setPublicTransitSubmode('optimal')} />
                <SubmodeRow label={t('Только метро')} active={publicTransitSubmode === 'metro_only'} onClick={() => setPublicTransitSubmode('metro_only')} />
                <SubmodeRow label={t('Только наземный')} active={publicTransitSubmode === 'surface_only'} onClick={() => setPublicTransitSubmode('surface_only')} />
              </SubmodeExpandPanel>

              <TransportOptionRow
                label={t('Такси')}
                info={t('Разрешить использование такси при оптимизации')}
                checked={taxi}
                onToggle={toggleTaxi}
              />
              <SubmodeExpandPanel expanded={taxi}>
                <SubmodeRow
                  label={t('Эконом')} active={taxiTariff === 'economy'} onClick={() => setTaxiTariff('economy')}
                  icon={<CarRearFillIcon color={taxiTariff === 'economy' ? '#F59E0B' : '#9CA3AF'} size={16} />}
                />
                <SubmodeRow
                  label={t('Комфорт')} active={taxiTariff === 'comfort'} onClick={() => setTaxiTariff('comfort')}
                  icon={<CarRearFillIcon color={taxiTariff === 'comfort' ? '#B0B8C1' : '#9CA3AF'} size={16} />}
                />
                <SubmodeRow
                  label={t('Бизнес')} active={taxiTariff === 'business'} onClick={() => setTaxiTariff('business')}
                  icon={<CarRearFillIcon color={taxiTariff === 'business' ? '#000000' : '#9CA3AF'} size={16} />}
                />
              </SubmodeExpandPanel>

              {ferryFeasible && (
                <TransportOptionRow
                  label={t('Речной транспорт')}
                  info={t('Добавить прогулку на речном транспорте')}
                  checked={includeFerry}
                  onToggle={() => setIncludeFerry(prev => !prev)}
                />
              )}

              <h4 className="text-xs font-medium text-gray-400 mt-3 mb-1 select-none">{t('Дополнительные опции')}</h4>

              <TransportOptionRow
                label={t('Прогулочный приоритет')}
                info={t('Увеличить лимиты длительности прогулок (3x)')}
                checked={walkPriority}
                onToggle={() => setWalkPriority(prev => !prev)}
              />
              <TransportOptionRow
                label={t('Без составных поездок')}
                info={t('Запретить использование составных поездкок (несколько видов транспорта)')}
                checked={noComposite}
                onToggle={() => setNoComposite(prev => !prev)}
                tooltipPlacement="top"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between px-6 pb-6 pt-3 border-t border-gray-100 flex-shrink-0 select-none">
          <button
            onClick={handleClose}
            className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors select-none"
          >
            {t('Назад')}
          </button>
          {hasChanges && (
            <div className="flex items-center gap-2">
              {hasAutoConfigChanges && (
                // Изменение автонастройки переоптимизирует весь маршрут
                <div className="relative">
                  <button
                    onMouseEnter={() => setShowAutoConfigInfo(true)}
                    onMouseLeave={() => setShowAutoConfigInfo(false)}
                    className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                  >
                    <InfoCircleIcon size={18} />
                  </button>
                  {showAutoConfigInfo && (
                    <div
                      ref={autoConfigInfoTooltipRef}
                      className="pp-tooltip-wrap absolute bottom-full right-0 mb-2 z-10 w-64"
                      style={{ transform: `translateX(${autoConfigInfoArrowOffset}px)` }}
                    >
                      <div className="pp-tooltip">
                        {t('Автонастройка заново оптимизирует маршрут с учетом ваших текущих предпочтений. Индивидуальные настройки транспорта отдельных перегонов будут сброшены.')}
                      </div>
                      <div
                        className="pp-tooltip-arrow pp-tooltip-arrow--bottom"
                        style={{ right: `calc(1rem + ${autoConfigInfoArrowOffset}px)` }}
                      />
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleApply}
                className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors select-none"
              >
                {t('Применить изменения')}
              </button>
            </div>
          )}
        </div>

        {/* Затемнение слоёв глубже верхнего - см. layerScrimOpacity */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
        />
      </div>
    </div>
  );
};

// Рестораны и кафе: минимальная длительность визита, мин
